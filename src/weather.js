// Live conditions for Morro Bay from Open-Meteo (free, no key). Falls back to typical coastal conditions.
const URL = 'https://api.open-meteo.com/v1/forecast?latitude=35.37&longitude=-120.85' +
  '&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,visibility,weather_code,is_day' +
  '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles';

const FALLBACK = { tempF: 61, windMph: 10, windFrom: 300, gustMph: 14, cloud: 35, visibility: 16000, code: 2, live: false };

export function compass(deg) { return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]; }

export async function getWeather(params) {
  let w = { ...FALLBACK };
  if (params.get('weather') !== 'offline') {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4500);
      const r = await fetch(URL, { signal: ctl.signal }); clearTimeout(t);
      if (r.ok) {
        const c = (await r.json()).current;
        w = { tempF: c.temperature_2m, windMph: c.wind_speed_10m, windFrom: c.wind_direction_10m, gustMph: c.wind_gusts_10m ?? c.wind_speed_10m,
          cloud: c.cloud_cover, visibility: c.visibility ?? 20000, code: c.weather_code, live: true };
      }
    } catch (e) { /* offline: keep fallback */ }
  }
  // test / showcase overrides
  const o = params.get('weather');
  if (o === 'fog') { w.visibility = 450; w.cloud = 95; w.code = 45; w.windMph = 4; }
  if (o === 'clear') { w.visibility = 30000; w.cloud = 0; w.code = 0; }
  if (o === 'rain') { w.visibility = 6000; w.cloud = 98; w.code = 61; }
  if (o === 'windy') { w.windMph = 24; w.gustMph = 32; }
  w.rain = (w.code >= 51 && w.code <= 67) || (w.code >= 80 && w.code <= 82);
  const fogCodes = w.code === 45 || w.code === 48;
  w.fogFactor = Math.max(fogCodes ? 0.75 : 0, Math.min(1, Math.max(0, (6000 - w.visibility) / 5500)));
  // wind vector in world space (x east, z south): wind blows *toward* windFrom + 180
  const to = (w.windFrom + 180) * Math.PI / 180, ms = w.windMph * 0.44704;
  w.wind = { x: Math.sin(to) * ms, z: -Math.cos(to) * ms };
  w.label = `${Math.round(w.windMph)} mph ${compass(w.windFrom)}`;
  return w;
}
