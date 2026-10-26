import { HEADING } from './course.js';
// Live conditions for the active map's site (Morro Bay, or San Luis Obispo) from Open-Meteo (free, no key). Falls back to typical conditions.
// Bishop's wind (speed, gust, direction) comes from the newest KSBP (San Luis Obispo airport) observation with a wind reading from api.weather.gov (last ~30 min, must be < 90 min old), which runs windier than the model; Open-Meteo wind is the fallback.
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
async function getJson(u) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4500);
  try { const r = await fetch(u, { signal: ctl.signal }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); }
}

export async function getWeather(params, map) {
  let w = { ...FALLBACK, windSource: 'fallback' };
  if (params.get('weather') !== 'offline') {
    const [om, obs] = await Promise.all([getJson(url(map)),
      map.windStation ? getJson(`https://api.weather.gov/stations/${map.windStation}/observations?limit=6`) : null]);
    const c = om && om.current;
    if (c) {
      w = { tempF: c.temperature_2m, windMph: c.wind_speed_10m, windFrom: c.wind_direction_10m, gustMph: c.wind_gusts_10m ?? c.wind_speed_10m,
        cloud: c.cloud_cover, visibility: c.visibility ?? 20000, code: c.weather_code, live: true, windSource: 'open-meteo' };
    }
    // KSBP posts every ~5 min and some reports have no wind: take the newest report that has a wind speed
    const f = obs && Array.isArray(obs.features) && obs.features.find((x) => x && x.properties && x.properties.windSpeed && typeof x.properties.windSpeed.value === 'number');
    const p = f && f.properties, sp = p && p.windSpeed.value, age = p ? Date.now() - Date.parse(p.timestamp) : NaN;
    if (typeof sp === 'number' && age > -10 * 60000 && age < 90 * 60000) {
      const mph = sp * KMH, d = p.windDirection && p.windDirection.value, g = p.windGust && p.windGust.value;
      w.windMph = mph; if (typeof d === 'number') w.windFrom = d;
      w.gustMph = typeof g === 'number' ? g * KMH : Math.max(mph, c ? w.gustMph : 0);
      w.windSource = map.windStation;
    }
  }
  // test / showcase overrides
  const o = params.get('weather');
  if (o === 'fog') { w.visibility = 450; w.cloud = 95; w.code = 45; w.windMph = 4; }
  if (o === 'clear') { w.visibility = 30000; w.cloud = 0; w.code = 0; }
  if (o === 'rain') { w.visibility = 6000; w.cloud = 98; w.code = 61; }
  if (o === 'windy') { w.windMph = 24; w.gustMph = 32; }
  const wo = params.get('wind');   // ?wind=mph,fromDeg (test / preview)
  if (wo) { const [m, f] = wo.split(',').map(Number); if (isFinite(m)) { w.windMph = m; w.gustMph = m; } if (isFinite(f)) w.windFrom = f; }
  w.rain = (w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82);
  const fogCodes = w.code === 45 || w.code === 48;
  w.fogFactor = Math.max(fogCodes ? 0.75 : 0, Math.min(1, Math.max(0, (6000 - w.visibility) / 5500)));
  // wind vector in world space (x east, z south): wind blows *toward* windFrom + 180
  w.wind = windVector(w.windMph, w.windFrom);
  w.label = `${Math.round(w.windMph)} mph ${compass(w.windFrom)}`;
  w.rel = windRel(w.windFrom);
  return w;
}
