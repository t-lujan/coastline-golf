// Course layout for Hole 4 · Field of Light (Sensorio, Paso Robles). Units are metres, y is up.
//
// Real-world mapping: the world origin is SITE, the centre of Bruce Munro's Field of Light installation at Sensorio,
// ~7 km east of downtown Paso Robles. Everything is true scale (equirectangular projection). The hole plays along world
// -Z, which points at compass bearing HEADING (NNE): from a tee on the south-west knoll, ~5 m down across the rolling,
// oak-dotted field of glowing spheres to a green just south of the big path loop. The ground is the real elevation
// (Terrarium tiles sampled on a 50 m grid, sensorio-elev.json), smoothed, with the tee, a short apron and the green hand-shaped.
import { fbm } from './morro.js';
import ELEV from './sensorio-elev.json';

export const ID = 'sensorio';
export const HEADING = 22;
export const SITE = { lat: 35.65333, lon: -120.62548 };
const RAD = Math.PI / 180, M_LAT = 111200, M_LON = 111200 * Math.cos(35.653 * RAD);
const HC = Math.cos(HEADING * RAD), HS = Math.sin(HEADING * RAD);
export const enToWorld = (e, n) => ({ x: e * HC - n * HS, z: -e * HS - n * HC });
export const worldToEn = (x, z) => ({ e: x * HC - z * HS, n: -x * HS - z * HC });
export const llToWorld = (lat, lon) => enToWorld((lon - SITE.lon) * M_LON, (lat - SITE.lat) * M_LAT);
export const worldToLl = (x, z) => { const { e, n } = worldToEn(x, z); return { lat: SITE.lat + n / M_LAT, lon: SITE.lon + e / M_LON }; };

// world y = metres above sea level minus ELEV0 (the field sits ~255-264 m up); there is no sea or pond on this hole
const ELEV0 = 250;
export const WATER_LEVEL = -80;

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az, t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

// ---------- real elevation ----------
// bilinear over the 50 m grid (rows = north from n0, cols = east from e0), clamped at its edges
const GR = ELEV.grid, NR = GR.length, NC = GR[0].length;
function gridElev(e, n) {
  const fx = Math.min(NC - 1.001, Math.max(0, (e - ELEV.e0) / ELEV.step)), fy = Math.min(NR - 1.001, Math.max(0, (n - ELEV.n0) / ELEV.step));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  return lerp(lerp(GR[j][i], GR[j][i + 1], u), lerp(GR[j + 1][i], GR[j + 1][i + 1], u), v);
}
// a small blur takes the grid's creases out, so the hills roll
export function elevAt(x, z) {
  const { e, n } = worldToEn(x, z); let s = 0;
  for (const [a, b] of [[0, 0], [22, 0], [-22, 0], [0, 22], [0, -22]]) s += gridElev(e + a, n + b) * (a || b ? 0.15 : 0.4);
  return s;
}
export const realY = (x, z) => elevAt(x, z) - ELEV0;

// ---------- the hole ----------
export const BOUNDS = { minX: -420, maxX: 420, minZ: -380, maxZ: 460 };
export const PAINT = { minX: -120, maxX: 60, minZ: -60, maxZ: 230 };
const T0 = enToWorld(-100, -160), G0 = enToWorld(-40, -10);
export const TEE = { x: Math.round(T0.x * 10) / 10, z: Math.round(T0.z * 10) / 10, w: 5, d: 4, h: realY(T0.x, T0.z) + 0.6, bank: 12 };
export const GREEN = { x: Math.round(G0.x * 10) / 10, z: Math.round(G0.z * 10) / 10, rx: 15, rz: 13 };
export const CUP = { x: GREEN.x + 2.5, z: GREEN.z - 2 };
// a short approach apron in front of the green; the rest of the play is over the sphere field (rough)
export const FAIRWAY = [[GREEN.x + 0.4, GREEN.z + 48], [GREEN.x + 0.1, GREEN.z + 10]];
export const FAIRWAY_HALF = 11;
export const CORNER = { x: TEE.x, z: TEE.z };
export const AIM_VIA = null;
export const BUNKERS = [];
export const WASTE = { x: 9999, z: 9999, ax: 0, len: 1, half: 1 };
export const PAR = 3;
export const HOLE_M = Math.hypot(TEE.x - CUP.x, TEE.z - CUP.z);
export const HOLE_YD = Math.round(HOLE_M * 1.09361);
// no Rock, stacks or sea; the gulls (not drawn here) would wheel over the green
export const ROCK = { x: 1e5, z: 1e5, rx: 1, rz: 1, h: 1 };
export const STACKS = [];
export const GULLS = { x: GREEN.x, z: GREEN.z };

export function fairwayDist(x, z) { let d = 1e9; for (let i = 0; i < FAIRWAY.length - 1; i++) d = Math.min(d, segDist(x, z, ...FAIRWAY[i], ...FAIRWAY[i + 1])); return d; }
export function greenDist(x, z) { const dx = (x - GREEN.x) / GREEN.rx, dz = (z - GREEN.z) / GREEN.rz; return (Math.hypot(dx, dz) - 1) * Math.min(GREEN.rx, GREEN.rz); }
export const bunkerDist = () => 1e9;
export function teeDist(x, z) { return Math.max(Math.abs(x - TEE.x) - TEE.w, Math.abs(z - TEE.z) - TEE.d); }
export const wasteDist = () => 1e9;
export const inland = () => 500;
export const duneSand = () => 0;
export const sandiness = () => 0;
export { fbm };

// the green keeps the real fall of the hill (a plane through the smoothed ground under it, softened to ~1.5 %) plus one soft swale
const GREEN_Y = realY(GREEN.x, GREEN.z);
const GSX = (realY(GREEN.x + 12, GREEN.z) - realY(GREEN.x - 12, GREEN.z)) / 24, GSZ = (realY(GREEN.x, GREEN.z + 12) - realY(GREEN.x, GREEN.z - 12)) / 24;
const gcap = (s) => Math.max(-0.015, Math.min(0.015, s * 0.5));
export function greenHeight(x, z) {
  const lx = x - GREEN.x, lz = z - GREEN.z;
  return GREEN_Y + 0.2 + lx * gcap(GSX) + lz * gcap(GSZ) + 0.06 * Math.exp(-((lx + 5) ** 2 + (lz - 3) ** 2) / 40);
}
// small humps and hollows on the field between the big rolls
const rollAt = (x, z) => 0.9 * (fbm(x * 0.03 + 4, z * 0.03) - 0.5);
export function heightAt(x, z) {
  let h = realY(x, z) + rollAt(x, z);
  const fw = fairwayDist(x, z); h = lerp(h, realY(x, z) + rollAt(x, z) * 0.3, 1 - sstep(FAIRWAY_HALF, FAIRWAY_HALF + 14, fw));
  const td = teeDist(x, z); h = lerp(h, TEE.h, 1 - sstep(0, TEE.bank, td + Math.max(0, td) * 0.5 * (fbm(x * 0.06 + 2, z * 0.06) - 0.5)));
  const gd = greenDist(x, z); h = lerp(h, greenHeight(x, z), 1 - sstep(3, 11, gd));
  return h;
}
export function surfaceAt(x, z) {
  if (greenDist(x, z) < 0) return 'green';
  if (teeDist(x, z) < 0) return 'tee';
  if (fairwayDist(x, z) < FAIRWAY_HALF) return 'fairway';
  return 'rough';
}
export function normalAt(x, z, e = 0.35) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx / (2 * e), nz = -hz / (2 * e), l = Math.hypot(nx, 1, nz);
  return { x: nx / l, y: 1 / l, z: nz / l };
}

// ---------- the Field of Light ----------
// installation outline (OSM way 1223627307), local east/north metres from SITE; the real field spreads well past it over the hills
const OUTLINE = [[208, 58], [210, 111], [185, 154], [103, 200], [-69, 256], [-166, 251], [-355, 207], [-360, 134], [-322, 80], [-229, 84], [-190, 25], [-179, -88], [-80, -213], [39, -159], [125, -106], [177, -26], [204, 38]]
  .map(([e, n]) => enToWorld(e, n));
function inOutline(x, z) {
  let c = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const a = OUTLINE[i], b = OUTLINE[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}
// sphere-field density 0..1 at world (x, z): full inside the installation and fading out over ~120 m past it, never on the
// tee, green or apron (job 40 plants the glowing spheres from this)
export function sphereField(x, z) {
  if (teeDist(x, z) < 4 || greenDist(x, z) < 3 || fairwayDist(x, z) < FAIRWAY_HALF + 1) return 0;
  if (inOutline(x, z)) return 1;
  let d = 1e9; for (let i = 0; i < OUTLINE.length; i++) { const a = OUTLINE[i], b = OUTLINE[(i + 1) % OUTLINE.length]; d = Math.min(d, segDist(x, z, a.x, a.z, b.x, b.z)); }
  return 1 - sstep(10, 120, d);
}
// a few valley oaks on the hills, clear of the tee-to-green line (en metres, then to world)
export const OAKS = [[-170, -120, 1.1], [-150, -40, 1.0], [-200, 30, 1.2], [40, -120, 0.95], [70, -40, 1.05], [10, 60, 1.0], [-120, 90, 1.1], [-260, -60, 1.15], [120, 40, 1.0], [-60, -230, 1.1], [60, 160, 0.95]]
  .map(([e, n, sc]) => ({ ...enToWorld(e, n), sc }))
  .filter((t) => segDist(t.x, t.z, TEE.x, TEE.z, GREEN.x, GREEN.z) > 35);
