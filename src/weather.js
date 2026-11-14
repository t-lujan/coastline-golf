import { HEADING } from './course.js';
// Live conditions for the active map's site (Morro Bay, or San Luis Obispo) from Open-Meteo (free, no key). Falls back to typical conditions.
// Every map also reads its nearest NWS station (api.weather.gov): Bishop's wind (speed, gust, direction) comes from the newest KSBP observation with a wind reading (must be < 90 min old) and is used when it's stronger than Open-Meteo's wind; NWS present-weather also confirms live rain, and stands in for the whole report if Open-Meteo is down.
const url = (m) => `https://api.open-meteo.com/v1/forecast?latitude=${m.weatherLat}&longitude=${m.weatherLon}` +
  '&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,visibility,weather_code,is_day' +
  '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles';

const FALLBACK = { tempF: 61, windMph: 10, windFrom: 300, gustMph: 14, cloud: 35, visibility: 16000, code: 2, live: false };

export function compass(deg) { return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]; }

// wind FROM `from` degrees (meteorological) at `mph` -> world vector in m/s (x east-ish, z toward the tee; world -Z points at `heading`)
export function windVector(mph, from, heading = HEADING) {
  const to = (from + 180 - heading) * Math.PI / 180, ms = Math.min(mph, 40) * 0.44704;   // safety cap only for extreme storms
  return { x: Math.sin(to) * ms, z: -Math.cos(to) * ms };
}

// wind relative to the hole's line of play (world -Z): 'into', 'helping', 'L→R', 'R→L' and the in-between quarters
export function windRel(from, heading = HEADING) {
  const a = (((from - heading) % 360) + 360) % 360;
  return ['into', 'into, R→L', 'R→L', 'helping, R→L', 'helping', 'helping, L→R', 'L→R', 'into, L→R'][Math.round(a / 45) % 8];
}

const KMH = 0.621371;
// generous timeout: the game builds terrain on the main thread while these load, which can delay the response handler for several seconds on slower devices
async function getJson(u) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try { const r = await fetch(u, { signal: ctl.signal }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); }
}

// NWS present-weather / text -> { rain, level } (light 0.7, moderate 1.0, heavy 1.35)
function nwsRain(p) {
  if (!p) return { rain: false, level: 0 };
  let level = 0;
  const lv = (s) => (/heavy|\+/.test(s) ? 1.35 : /light|-/.test(s) ? 0.7 : 1.0);
  for (const e of Array.isArray(p.presentWeather) ? p.presentWeather : []) {
    const wx = String(e.weather || '').toLowerCase(), raw = String(e.rawString || '');
    if (wx.includes('snow') || /FZ/.test(raw)) continue;
    if (/rain|drizzle|thunderstorm/.test(wx) || /RA|DZ/.test(raw)) level = Math.max(level, lv(String(e.intensity || '').toLowerCase() || raw.replace(/[^+-]/g, '')));
  }
  const td = String(p.textDescription || '');
  if (!level && /rain|drizzle|shower|thunderstorm/i.test(td) && !/snow/i.test(td)) level = /heavy/i.test(td) ? 1.35 : /light/i.test(td) ? 0.7 : 1.0;
  return { rain: level > 0, level };
}
const wmoLevel = (c) => (c >= 95 || c === 65 || c === 82 || c === 67 || c === 57 ? 1.35 : c === 61 || c === 63 || c === 81 || c === 66 ? 1.0 : 0.7);
const isWmoRain = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;

export async function getWeather(params, map) {
  let w = { ...FALLBACK, windSource: 'fallback' };
  if (params.get('weather') !== 'offline') {
    const station = map.windStation || map.obsStation;
    // don't let a slow Open-Meteo hold up loading: once the NWS station answers, give Open-Meteo 1.5 s more, then go with NWS
    const omP = getJson(url(map));
    const obs = station ? await getJson(`https://api.weather.gov/stations/${station}/observations?limit=6`) : null;
    const om = obs ? await Promise.race([omP, new Promise((r) => setTimeout(() => r(null), 1500))]) : await omP;
    const c = om && om.current;
    const feats = obs && Array.isArray(obs.features) ? obs.features.filter((x) => x && x.properties) : [];
    const fresh = (p) => { const age = Date.now() - Date.parse(p.timestamp); return age > -10 * 60000 && age < 90 * 60000; };
    // newest fresh report that says anything useful
    const fp = (feats.find((x) => fresh(x.properties) && (x.properties.temperature?.value != null || x.properties.windSpeed?.value != null || x.properties.textDescription)) || {}).properties;
    const nr = nwsRain(fp), nVis = fp && typeof fp.visibility?.value === 'number' ? fp.visibility.value : null;
    if (c) {
      w = { tempF: c.temperature_2m, windMph: c.wind_speed_10m, windFrom: c.wind_direction_10m, gustMph: c.wind_gusts_10m ?? c.wind_speed_10m,
        cloud: c.cloud_cover, visibility: c.visibility ?? 20000, code: c.weather_code, live: true, windSource: 'open-meteo' };
      const omRain = isWmoRain(w.code);
      if (omRain || nr.rain) {
        w.rain = true; w.rainLevel = Math.max(omRain ? wmoLevel(w.code) : 0, nr.level);
        if (nr.rain) { w.cloud = Math.max(w.cloud, 85); w.visibility = Math.min(w.visibility, nVis || 6000); }
      }
    } else if (fp) {
      const sp = fp.windSpeed?.value, d = fp.windDirection?.value, g = fp.windGust?.value, t = fp.temperature?.value, td = String(fp.textDescription || '');
      w.live = true; w.windSource = station;
      w.tempF = typeof t === 'number' ? t * 9 / 5 + 32 : 61;
      if (typeof sp === 'number') { w.windMph = sp * KMH; if (typeof d === 'number' && w.windMph > 0) w.windFrom = d; w.gustMph = Math.max(w.windMph, typeof g === 'number' ? g * KMH : 0); }
      w.visibility = nVis ?? (nr.rain ? 5000 : 16000);
      w.rain = nr.rain; w.rainLevel = nr.level;
      w.cloud = nr.rain ? 95 : /cloudy|overcast/i.test(td) ? 75 : 35;
      w.code = nr.rain ? 63 : /overcast/i.test(td) ? 3 : 2;
    }
    // Bishop's wind: newest KSBP report with a wind speed, used when stronger than Open-Meteo's
    if (map.windStation) {
      const f = feats.find((x) => typeof x.properties.windSpeed?.value === 'number');
      const p = f && f.properties, sp = p && p.windSpeed.value, age = p ? Date.now() - Date.parse(p.timestamp) : NaN;
      if (typeof sp === 'number' && age > -10 * 60000 && age < 90 * 60000) {
        const mph = sp * KMH, d = p.windDirection && p.windDirection.value, g = p.windGust && p.windGust.value;
        // use whichever is stronger: the airport can sit calm while it's still breezy at the hole
        if (!c || mph > w.windMph) {
          const omGust = c ? w.gustMph : 0;
          w.windMph = mph; if (typeof d === 'number' && mph > 0) w.windFrom = d;
          w.gustMph = Math.max(mph, typeof g === 'number' ? g * KMH : 0, omGust);
          w.windSource = map.windStation;
        }
      }
    }
  }
  // test / showcase overrides
  const o = params.get('weather');
  if (o === 'fog') { w.visibility = 450; w.cloud = 95; w.code = 45; w.windMph = 4; w.rain = false; }
  if (o === 'clear') { w.visibility = 30000; w.cloud = 0; w.code = 0; w.rain = false; }
  if (o === 'rain') { w.visibility = 5000; w.cloud = 98; w.code = 63; w.rain = true; w.rainLevel = 1; }
  if (o === 'windy') { w.windMph = 24; w.gustMph = 32; }
  const wo = params.get('wind');   // ?wind=mph,fromDeg (test / preview)
  if (wo) { const [m, f] = wo.split(',').map(Number); if (isFinite(m)) { w.windMph = m; w.gustMph = m; } if (isFinite(f)) w.windFrom = f; }
  if (w.rain === undefined) { w.rain = isWmoRain(w.code); w.rainLevel = w.rain ? wmoLevel(w.code) : 0; }
  if (!w.rain) { w.rain = false; w.rainLevel = 0; }
  const fogCodes = w.code === 45 || w.code === 48;
  w.fogFactor = Math.max(fogCodes ? 0.75 : 0, Math.min(1, Math.max(0, (6000 - w.visibility) / 5500)));
  // wind vector in world space (x east, z south): wind blows *toward* windFrom + 180
  w.wind = windVector(w.windMph, w.windFrom);
  w.label = `${Math.round(w.windMph)} mph ${compass(w.windFrom)}`;
  w.rel = windRel(w.windFrom);
  return w;
}
