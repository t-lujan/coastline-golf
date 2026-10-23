// Solar position (NOAA approximation) and the time-of-day "look" for the scene.
import { Color } from 'three';

export const LAT = 35.3658, LON = -120.8499; // Morro Rock
const rad = Math.PI / 180;

export function sunPosition(date, lat = LAT, lon = LON) {
  const jd = date.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = ((gmst * 15 + lon) * rad) - ra;
  const la = lat * rad;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { elevation: el / rad, azimuth: ((az / rad) + 360) % 360 };
}

// local wall-clock in Los Angeles, optionally overridden by ?time=sunrise|morning|noon|afternoon|sunset|dusk|night|HH:MM
const PRESETS = { sunrise: '07:25', morning: '08:30', noon: '12:45', midday: '12:45', afternoon: '15:30', golden: '17:55', sunset: '18:05', dusk: '18:50', night: '22:00' };
export function sceneDate(param) {
  const now = new Date();
  if (!param) return { date: now, override: false };
  const hm = PRESETS[param] || (/^\d{1,2}:\d{2}$/.test(param) ? param : null);
  if (!hm) return { date: now, override: false };
  const [h, m] = hm.split(':').map(Number);
  // build "today at h:m in America/Los_Angeles"
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const laNowMin = (+parts.hour % 24) * 60 + +parts.minute;
  const delta = (h * 60 + m - laNowMin) * 60000;
  return { date: new Date(now.getTime() + delta), override: true };
}
export function laClock(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(date);
}

const C = (h) => new Color(h);
// key frames by sun elevation (degrees)
const KEYS = [
  { el: -18, zen: C('#06112c'), hor: C('#1b2c52'), sun: C('#9fb4ff'), sunI: 0.0, hemiS: C('#5a76b0'), hemiG: C('#1c2434'), hemiI: 0.95, exp: 1.12 },
  { el: -6, zen: C('#101a3a'), hor: C('#4c3d5e'), sun: C('#ff8a5c'), sunI: 0.0, hemiS: C('#5d5a8a'), hemiG: C('#211a22'), hemiI: 0.6, exp: 1.0 },
  { el: 0, zen: C('#22356c'), hor: C('#f2925c'), sun: C('#ff7f3a'), sunI: 1.3, hemiS: C('#c99a8a'), hemiG: C('#5a3a26'), hemiI: 0.95, exp: 1.05 },
  { el: 6, zen: C('#2c5598'), hor: C('#f4b27a'), sun: C('#ffad62'), sunI: 2.5, hemiS: C('#e2b89a'), hemiG: C('#6a5232'), hemiI: 1.0, exp: 1.02 },
  { el: 18, zen: C('#1f5cad'), hor: C('#a9cfe2'), sun: C('#ffe9c8'), sunI: 3.0, hemiS: C('#a9c8e6'), hemiG: C('#5a5a32'), hemiI: 0.95, exp: 0.98 },
  { el: 60, zen: C('#174f9e'), hor: C('#9fc8df'), sun: C('#fff8ee'), sunI: 3.2, hemiS: C('#a3c4e4'), hemiG: C('#585a34'), hemiI: 0.95, exp: 0.95 },
];
export function lookFor(elev, weather) {
  let i = 0; while (i < KEYS.length - 2 && elev > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = Math.min(1, Math.max(0, (elev - a.el) / (b.el - a.el)));
  const L = {};
  for (const k of Object.keys(a)) L[k] = a[k] instanceof Color ? a[k].clone().lerp(b[k], t) : a[k] + (b[k] - a[k]) * t;
  const cloud = (weather?.cloud ?? 20) / 100, fog = weather?.fogFactor ?? 0;
  // overcast flattens the sky and dims the sun; marine layer turns it grey
  const grey = new Color('#aeb9bf').multiplyScalar(Math.min(1, 0.35 + Math.max(0, elev + 6) / 30));
  L.zen.lerp(grey, cloud * 0.32 + fog * 0.6); L.hor.lerp(grey.clone().multiplyScalar(1.05), cloud * 0.28 + fog * 0.75);
  L.sunI *= 1 - cloud * 0.35 - fog * 0.4; L.hemiI *= 1 + cloud * 0.12;
  L.night = elev < -6;
  L.cloud = cloud; L.fog = fog;
  return L;
}
