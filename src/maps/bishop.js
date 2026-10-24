// Course layout for Hole 1 · Bishop Peak (San Luis Obispo). Units are metres, y is up.
//
// Real-world mapping: the hole site is the dogleg corner at SITE (lat/lon) and is the world origin. Every landmark is
// placed at its true compass bearing and true distance from it (equirectangular projection). The hole plays along
// world -Z, which points at compass bearing HEADING (WSW, toward Cerro San Luis and the Madonna Inn); after the corner
// it doglegs right toward Bishop Peak, which rises behind the green. Real elevation comes from a baked Terrarium
// heightmaps (scripts/bake-heightmap.mjs); the playable hole is hand-shaped on top of a smooth fit of the real valley floor.
import { fbm } from './morro.js';
import heightUrl from './bishop-height.png?url';
import heightFarUrl from './bishop-height-far.png?url';

export const ID = 'bishop';
export const HEADING = 228;
export const SITE = { lat: 35.2845, lon: -120.6685 };
export const BASE = 7.0;               // ground height at the site (world y; real ground there is SITE_ELEV metres above sea level)
const RAD = Math.PI / 180, M_LAT = 111200, M_LON = 111200 * Math.cos(35.28 * RAD);
const HC = Math.cos(HEADING * RAD), HS = Math.sin(HEADING * RAD);
// local east/north metres from the site <-> world x/z
export const enToWorld = (e, n) => ({ x: e * HC - n * HS, z: -e * HS - n * HC });
export const worldToEn = (x, z) => ({ e: x * HC - z * HS, n: -x * HS - z * HC });
export const llToWorld = (lat, lon) => enToWorld((lon - SITE.lon) * M_LON, (lat - SITE.lat) * M_LAT);
export const worldToLl = (x, z) => { const { e, n } = worldToEn(x, z); return { lat: SITE.lat + n / M_LAT, lon: SITE.lon + e / M_LON }; };
const along = (bearing, d) => ({ x: Math.sin((bearing - HEADING) * RAD) * d, z: -Math.cos((bearing - HEADING) * RAD) * d });

// ---------- landmarks (verified lat/lon and summit heights) ----------
const LM_DEF = {
  bishop:   { lat: 35.30247, lon: -120.69739, elev: 472 },
  cerro:    { lat: 35.28277, lon: -120.68070, elev: 393 },
  inn:      { lat: 35.26750, lon: -120.67472, elev: 51 },
  chumash:  { lat: 35.30829, lon: -120.70634, elev: 387 },
  romualdo: { lat: 35.31419, lon: -120.72681, elev: 398 },
  hollister:{ lat: 35.34396, lon: -120.78636, elev: 430 },
  // the white "M" (Mission College Prep): about halfway up the east face of Cerro San Luis, a short climb above the
  // M Trail memorial (OSM 35.2825, -120.6731); placed on the east-facing slope at ~236 m on the baked heightmap
  m:        { lat: 35.28351, lon: -120.67665, elev: 236 },
};
export const LM = {};
for (const [k, v] of Object.entries(LM_DEF)) LM[k] = { ...v, ...llToWorld(v.lat, v.lon) };
const SITE_ELEV = 58;                  // real ground elevation at the site (m), from the baked heightmap
// relief above the valley floor is drawn true to life up to ~1.2 km from the hole and x1.2 beyond ~2.8 km (within the
// brief's 1.0-1.3), so the far morros (Bishop Peak, Chumash, Romualdo) still stand up over the near foothills at their true
// distances and bearings; below the site (Laguna Lake, the creek) it is true to life
export const EXAGGERATION = { near: 1.0, far: 1.2 };
const exAt = (r) => EXAGGERATION.near + (EXAGGERATION.far - EXAGGERATION.near) * sstep(1200, 2800, r);
export const yOf = (elev, x = 0, z = 0) => { const d = elev - SITE_ELEV; return BASE + (d > 0 ? d * exAt(Math.hypot(x, z)) : d); };

// the hole's own ground follows the real valley: a least-squares quadratic through the baked heights (smoothed over
// ~200 m) across the hole, tamed to 70 %: the tee shot falls gently to the corner and the approach climbs ~10 m to a
// green set into the foot of Cerro San Luis's north spur (fit by cg-tools/terr/fit.mjs; inputs clamped to the fit area)
const QF = [63.269, 3.822, -5.203, 0.437, -1.837, 1.867], K_LOCAL = 0.7;
const clampF = (v, a, b) => Math.min(b, Math.max(a, v));
const qfit = (x, z) => { const u = clampF(x, -250, 360) / 100, v = clampF(z, -250, 360) / 100; return QF[0] + QF[1] * u + QF[2] * v + QF[3] * u * u + QF[4] * u * v + QF[5] * v * v; };
const Q0 = qfit(0, 0);
export const baseY = (x, z) => BASE + K_LOCAL * (qfit(x, z) - Q0);

// ---------- the hole ----------
export const BOUNDS = { minX: -330, maxX: 440, minZ: -330, maxZ: 420 };
export const PAINT = { minX: -70, maxX: 250, minZ: -125, maxZ: 340 };
export const TEE = { x: 0, z: 292, w: 7, d: 5, h: baseY(0, 292) + 0.9, bank: 24 };
const g0 = along(298, 190);
export const GREEN = { x: Math.round(g0.x * 10) / 10, z: Math.round(g0.z * 10) / 10, rx: 16, rz: 13.5 };
export const CUP = { x: GREEN.x + 3.6, z: GREEN.z - 3.9 };
export const FAIRWAY = [[0, 275], [0, 190], [0, 110], [0, 40], [8, 8], [30, -4], [72, -20], [112, -33], [GREEN.x - 17, GREEN.z + 7]];
export const FAIRWAY_HALF = 14;
export const CORNER = { x: 0, z: 0 };
// the first shot aims here from the tee (the cup is round the corner, behind the trees)
export const AIM_VIA = { x: 0, z: 62, until: 330 };
// from: where the shot into the bunker comes from, so its lip is built up on the far side
export const BUNKERS = [
  { x: -17, z: 68, r: 6.4, face: 1.1, from: [0, 292] },                 // fairway, left of the landing zone (~245 yd carry)
  { x: 23, z: -2, r: 6.6, face: 1.25, from: [0, 90] },                  // inside the dogleg corner
  { x: GREEN.x - 17, z: GREEN.z + 13, r: 5.4, face: 0.5, from: [60, -22] },   // greenside, front right
  { x: GREEN.x + 15, z: GREEN.z - 15, r: 5.0, face: 0.4, from: [60, -22] },   // greenside, back left
];
export const POND = { x: 136, z: -16, rx: 13, rz: 8.5, a: -0.35 };
export const WATER_LEVEL = baseY(POND.x, POND.z) - 2.4;   // the pond surface (there is no sea here)
const GREEN_Y = baseY(GREEN.x, GREEN.z);
export const WASTE = { x: 9999, z: 9999, ax: 0, len: 1, half: 1 };      // no waste area on this hole
export const PAR = 5;
export const HOLE_M = Math.hypot(TEE.x - CORNER.x, TEE.z - CORNER.z) + Math.hypot(CORNER.x - CUP.x, CORNER.z - CUP.z);
export const HOLE_YD = Math.round(HOLE_M * 1.09361);

// ---------- noise, helpers ----------
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az, t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}
export function fairwayDist(x, z) { let d = 1e9; for (let i = 0; i < FAIRWAY.length - 1; i++) d = Math.min(d, segDist(x, z, ...FAIRWAY[i], ...FAIRWAY[i + 1])); return d; }
export function greenDist(x, z) { const dx = (x - GREEN.x) / GREEN.rx, dz = (z - GREEN.z) / GREEN.rz; return (Math.hypot(dx, dz) - 1) * Math.min(GREEN.rx, GREEN.rz); }
const bunkerEdge = (b, x, z) => Math.hypot(x - b.x, z - b.z) - b.r * (0.85 + 0.3 * vnoise(x * 0.35, z * 0.35));
export function bunkerDist(x, z) { let d = 1e9; for (const b of BUNKERS) d = Math.min(d, bunkerEdge(b, x, z)); return d; }
function bunkerShape(x, z) {
  let dh = 0;
  for (const b of BUNKERS) {
    const bd = bunkerEdge(b, x, z); if (bd > 4) continue;
    const [fx, fz] = b.from, fl = Math.hypot(b.x - fx, b.z - fz), u = ((x - b.x) * (b.x - fx) + (z - b.z) * (b.z - fz)) / fl / b.r;
    dh -= (1 - sstep(-2.5, 1.5, bd)) * 0.55;
    dh += b.face * sstep(-0.9, 0.95, u) * (1 - sstep(0.4, 3.6, bd));
  }
  return dh;
}
export function teeDist(x, z) { return Math.max(Math.abs(x - TEE.x) - TEE.w, Math.abs(z - TEE.z) - TEE.d); }
export function pondDist(x, z) {
  const c = Math.cos(POND.a), s = Math.sin(POND.a), dx = x - POND.x, dz = z - POND.z, a = dx * c - dz * s, l = dx * s + dz * c;
  return (Math.hypot(a / POND.rx, l / POND.rz) - 1) * Math.min(POND.rx, POND.rz) + 1.6 * (vnoise(x * 0.2, z * 0.2) - 0.5);
}
// no sea, no dunes: the shared vegetation / terrain code sees an all-inland, sand-free map
export const wasteDist = () => 1e9;
export const inland = () => 500;
export const duneSand = () => 0;
export function sandiness(x, z) { return 1 - sstep(-1.2, 0.9, bunkerDist(x, z)); }
export { fbm };

// ---------- real elevation ----------
// Two baked PNGs (north up, R*256+G = (metres + 100) * 8): NEAR 1024 px over 10 km (~10 m/px, zoom-14 Terrarium tiles)
// covering Bishop Peak, Chumash Peak, Cerro San Luis, Laguna Lake and the Madonna Inn; FAR 256 px over 30 km for the rest
// of the Nine Sisters and the hills fading into haze. Centres / sizes must match scripts/bake-heightmap.mjs.
export const NEAR = { url: heightUrl, ce: -1500, cn: 500, half: 5000, n: 0, data: null };
export const FAR = { url: heightFarUrl, ce: -1500, cn: 500, half: 15000, n: 0, data: null };
async function loadMap(M) {
  const blob = await (await fetch(M.url)).blob(), bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data, n = bmp.width, f = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) f[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 8 - 100;
  M.n = n; M.data = f;
}
export async function loadHeights() {
  if (NEAR.data) return true;
  try { await Promise.all([loadMap(NEAR), loadMap(FAR)]); peakBoost = null; return true; }
  catch (e) { NEAR.data = FAR.data = null; console.warn('heightmap unavailable, shaping the peaks procedurally', e); return false; }
}
export const heightsLoaded = () => !!NEAR.data;
// the same landscape without the files: smooth cones at the landmarks' true positions and heights
function procElev(x, z) {
  let h = 60;
  for (const k of ['bishop', 'cerro', 'chumash', 'romualdo']) { const L = LM[k], r = Math.hypot(x - L.x, z - L.z); h = Math.max(h, 60 + (L.elev - 60) * Math.exp(-((r / (k === 'cerro' ? 520 : 600)) ** 2))); }
  return h + 18 * (fbm(x * 0.0007, z * 0.0007) - 0.5);
}
function sampleMap(M, e, n) {
  const N = M.n, fx = (e - M.ce + M.half) / (2 * M.half) * N - 0.5, fy = (M.cn + M.half - n) / (2 * M.half) * N - 0.5;
  const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy, g = (i, j) => M.data[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  return lerp(lerp(g(ix, iy), g(ix + 1, iy), u), lerp(g(ix, iy + 1), g(ix + 1, iy + 1), u), v);
}
// real elevation (m above sea level) at world (x, z): the fine map inside its square, cross-faded into the far one at the edge
export function elevAt(x, z) {
  if (!NEAR.data) return procElev(x, z);
  const { e, n } = worldToEn(x, z), edge = NEAR.half - Math.max(Math.abs(e - NEAR.ce), Math.abs(n - NEAR.cn));
  if (edge > 400) return sampleMap(NEAR, e, n);
  const far = sampleMap(FAR, e, n);
  return edge <= 0 ? far : lerp(far, sampleMap(NEAR, e, n), edge / 400);
}
// the 10 m heightmap still rounds the very tops off a little: pull each summit up to its surveyed height (the rock outcrops sit on top)
const PEAKS = ['bishop', 'cerro', 'chumash', 'romualdo'].map((k) => ({ k, L: LM[k], r: 70, top: LM[k].elev }));
let peakBoost = null;
function boost(x, z) {
  if (!peakBoost) peakBoost = PEAKS.map((p) => { let m = 0; for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) m = Math.max(m, elevAt(p.L.x + a * 15, p.L.z + b * 15)); return m; });
  let add = 0;
  PEAKS.forEach((p, i) => { const d = Math.hypot(x - p.L.x, z - p.L.z); if (d < p.r * 3) add = Math.max(add, Math.max(0, p.top - peakBoost[i]) * Math.exp(-((d / p.r) ** 2))); });
  return add;
}
export function realY(x, z) { return yOf(elevAt(x, z) + boost(x, z), x, z); }

// ---------- the playable ground ----------
export function greenHeight(x, z) {
  // a receptive green: a gentle back-to-front tilt and one soft swale, nothing that runs a ball off
  const lx = x - GREEN.x, lz = z - GREEN.z;
  return GREEN_Y + 0.25 - lz * 0.0065 + lx * 0.0035 + 0.07 * Math.exp(-((lx + 6) ** 2 + (lz - 4) ** 2) / 45) - 0.05 * Math.exp(-((lx - 5) ** 2 + (lz + 5) ** 2) / 30);
}
export function fairwayShape(x, z) {
  // the fairway rolls a little: a low rise before the corner, then a soft swale on the climb to the green
  return 0.9 * sstep(260, 120, z) * (1 - sstep(60, -30, z)) + 0.5 * Math.sin(z * 0.045) * sstep(240, 100, z) + 0.45 * Math.sin(x * 0.05 + 1) * sstep(30, 90, x) * sstep(GREEN.x - 10, GREEN.x - 40, x);
}
// gentle swells on the valley floor (a metre or two over 60-120 m) and low, rounded rises beside the hole
const rollAt = (x, z) => 1.6 * (fbm(x * 0.009 + 4, z * 0.009) - 0.5) + 0.35 * (fbm(x * 0.05 + 7, z * 0.05) - 0.5);
function localY(x, z) {
  const fw = fairwayDist(x, z), r = Math.hypot(x, z);
  const rise = sstep(24, 110, fw) * (0.8 + 4.2 * sstep(0.35, 0.8, fbm(x * 0.008 + 3, z * 0.008 - 1)));
  return baseY(x, z) + rollAt(x, z) + rise * (1 - 0.85 * sightK(x, z));
}
export function heightAt(x, z) {
  const rr = Math.hypot(x, z), k = sstep(300, 650, rr);
  let h = k <= 0 ? localY(x, z) : k >= 1 ? realY(x, z) : lerp(localY(x, z), realY(x, z), k);
  if (rr > 900) return h;
  h = Math.max(h, baseY(x, z) - 1.4);                       // nothing but the pond dips below the valley floor
  const fw = fairwayDist(x, z), corridor = 1 - sstep(FAIRWAY_HALF + 8, FAIRWAY_HALF + 30, fw);
  h = lerp(h, baseY(x, z) + rollAt(x, z) * 0.4 + fairwayShape(x, z), corridor);
  // the pond: dug well below the water line, with a soft bank
  const pd = pondDist(x, z); if (pd < 6) h = lerp(h, WATER_LEVEL - 1.4, 1 - sstep(-1.5, 5.5, pd));
  const td = teeDist(x, z); h = lerp(h, TEE.h, 1 - sstep(0, TEE.bank, td + Math.max(0, td) * 0.5 * (fbm(x * 0.06 + 2, z * 0.06) - 0.5)));
  const gd = greenDist(x, z); h = lerp(h, greenHeight(x, z), 1 - sstep(3, 11, gd));
  h += bunkerShape(x, z) * sstep(-0.5, 2.5, gd);
  return h;
}
export function surfaceAt(x, z) {
  const pd = pondDist(x, z);
  if (pd < 0 || (pd < 8 && heightAt(x, z) < WATER_LEVEL + 0.03)) return 'water';
  if (greenDist(x, z) < 0) return 'green';
  if (teeDist(x, z) < 0) return 'tee';
  if (bunkerDist(x, z) < 0) return 'sand';
  if (fairwayDist(x, z) < FAIRWAY_HALF) return 'fairway';
  return 'rough';
}
export function normalAt(x, z, e = 0.35) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx / (2 * e), nz = -hz / (2 * e), l = Math.hypot(nx, 1, nz);
  return { x: nx / l, y: 1 / l, z: nz / l };
}

// ---------- sightlines ----------
// 0..1: inside a protected view from the tee to the Madonna Inn and the M, or from the green to Bishop Peak. Trees and
// knolls stay out of these cones so the backdrop is not hidden behind the foreground.
const SIGHTS = [
  // the Inn sits ~2.2 km out, past the far oaks: its cone runs (slightly wider) all the way to the building
  { from: [TEE.x, TEE.z], to: [LM.inn.x, LM.inn.z], hw: 8, far: Math.hypot(LM.inn.x - TEE.x, LM.inn.z - TEE.z) - 60 },
  { from: [TEE.x, TEE.z], to: [LM.cerro.x, LM.cerro.z], hw: 9 },
  { from: [TEE.x, TEE.z], to: [LM.m.x, LM.m.z], hw: 5 },
  { from: [GREEN.x, GREEN.z], to: [LM.m.x, LM.m.z], hw: 5 },
  { from: [GREEN.x, GREEN.z], to: [LM.bishop.x, LM.bishop.z], hw: 17 },
  { from: [GREEN.x, GREEN.z], to: [LM.chumash.x, LM.chumash.z], hw: 12 },
].map((r) => ({ far: 900, ...r })).map((r) => { const dx = r.to[0] - r.from[0], dz = r.to[1] - r.from[1], l = Math.hypot(dx, dz); return { ...r, dx: dx / l, dz: dz / l, cos: Math.cos(r.hw * RAD) }; });
export function sightK(x, z) {
  let k = 0;
  for (const r of SIGHTS) {
    const vx = x - r.from[0], vz = z - r.from[1], d = Math.hypot(vx, vz); if (d < 25 || d > r.far) continue;
    const c = (vx * r.dx + vz * r.dz) / d;                       // cos of the angle off the sightline
    k = Math.max(k, sstep(r.cos - 0.012, r.cos + 0.004, c) * (1 - sstep(r.far - 200, r.far, d)));
  }
  return k;
}
