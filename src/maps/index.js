// The playable maps and which one is active. The choice is made once per page load (the course data is bound at import
// time): ?map=morro|bishop wins, then the last pick saved in localStorage, then Morro Rock.
import * as morro from './morro.js';
import * as bishop from './bishop.js';

export const MAPS = {
  morro: {
    id: 'morro', name: 'Morro Rock', course: morro, place: 'Morro Bay', lat: morro.SITE.lat, lon: morro.SITE.lon, weatherLat: 35.37, weatherLon: -120.85,
    blurb: 'Par 4 on the coast, played to the foot of the Rock.', short: 'Par 4 · links', fogScale: 1,
    cap: 'carry the inlet', loaderSub: 'Par 4 on the San Luis Obispo coast, played under live Morro Bay weather.',
  },
  bishop: {
    id: 'bishop', name: 'Bishop Peak', course: bishop, place: 'San Luis Obispo', lat: bishop.SITE.lat, lon: bishop.SITE.lon, weatherLat: bishop.SITE.lat, weatherLon: bishop.SITE.lon,
    blurb: 'Par 4 in the valley below Bishop Peak, with Cerro San Luis and the Madonna Inn across the way.', short: 'Par 4 · valley', fogScale: 0.3,
    cap: 'dogleg right toward Bishop Peak', loaderSub: 'Par 4 in the San Luis Obispo valley, played under live San Luis Obispo weather.',
  },
};
export const MAP_KEYS = Object.keys(MAPS);
const norm = (s) => { s = String(s || '').toLowerCase(); return s.startsWith('bishop') ? 'bishop' : s.startsWith('morro') ? 'morro' : null; };
function pick() {
  let q = null, saved = null;
  try { q = norm(new URLSearchParams(location.search).get('map')); } catch (e) { /* no URL */ }
  try { saved = norm(localStorage.getItem('cg-map')); } catch (e) { /* storage blocked */ }
  return q || saved || 'morro';
}
export const MAP_ID = pick();
export const MAP = MAPS[MAP_ID];
export function rememberMap(id) { try { localStorage.setItem('cg-map', id); } catch (e) { /* storage blocked */ } }
