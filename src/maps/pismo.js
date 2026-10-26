// Course layout for Hole 3 · Pismo Pier → Oceano Dunes. Units are metres, y is up. A par 5 laid on the backshore of
// Pismo State Beach: the tee sits on the dry sand just south-east of the pier's landward end, the hole plays SSE down the
// beach (ocean on the right), carries the Pismo Creek mouth and finishes bending left into the Oceano foredunes.
//
// Real-world mapping. The world origin is SITE, the pier's landward end (35.13880, -120.64305). World -Z points at compass
// bearing HEADING (163°, the line of the beach from the pier to Pier Ave), world +X at 253° (straight out to sea). Real
// points are resolved into along-shore a (m along 163°) and cross-shore c (m along 253°, + = seaward); the world is
// x = c (true scale across the beach) and z = -S(a), with S an along-shore compression (real → game, m):
//   a <= 60 (pier, tee, Vespera, the pier-head town): true scale            0 → 0, 60 → 60
//   Pismo Creek mouth (35.12867, -120.63924)            a 1179 → 170
//   Grand Ave ramp, Grover Beach (35.1221, -120.6345)   a 2003 → 290
//   Pier Ave ramp, Oceano (35.1056, -120.6305)          a 3864 → 455
//   foredunes at the green (35.1040, -120.6292)         a 3990 → 488, then true scale again past ~a 3990 (the dunes). The green sits ~45 m past that mark (s≈533, real a≈4035, ~45 m
//   south of 35.1040,-120.6292, still in the Oceano foredunes) so the hole plays ~583 yd and is not a two-shotter in calm air
// i.e. the ~3.9 km of beach between the pier and the dunes is squeezed ~8x on average (~10x between the creek and Pier Ave),
// north of the pier and inland it is true. Across the beach the game keeps the real widths measured from the local
// mean-high-water line (backshore ~110-160 m dry, a ~30 m swash band) rather than the real MHW offsets, so the gentle real
// curve of the bay (c from +136 at the pier to -41 at Grover and +153 at Oceano) is straightened to a soft wobble.
// placeReal(lat, lon) → world {x, z} (compressed), worldToLl(x, z) → {lat, lon}: later jobs place landmarks with these.
import { fbm } from './morro.js';

export const ID = 'pismo';
export const HEADING = 163;
export const SITE = { lat: 35.13880, lon: -120.64305 };
export const WATER_LEVEL = 0;
const RAD = Math.PI / 180, M_LAT = 111200, M_LON = 111200 * Math.cos(35.14 * RAD);
const HS = Math.sin(HEADING * RAD), HC = Math.cos(HEADING * RAD);
// along-shore compression table [real a, game s] (piecewise linear, slope 1 outside the table)
export const ALONG = [[0, 0], [60, 60], [1179, 170], [2003, 290], [3864, 455], [3990, 488]];
function interp(T, i, o, v) {
  if (v <= T[0][i]) return T[0][o] + (v - T[0][i]);
  for (let k = 0; k < T.length - 1; k++) if (v <= T[k + 1][i]) { const a = T[k], b = T[k + 1]; return a[o] + (b[o] - a[o]) * (v - a[i]) / (b[i] - a[i]); }
  const L = T[T.length - 1]; return L[o] + (v - L[i]);
}
export const realToGame = (a) => interp(ALONG, 0, 1, a);
export const gameToReal = (s) => interp(ALONG, 1, 0, s);
// local east/north metres from SITE <-> along/cross-shore
const enToAc = (e, n) => ({ a: e * HS + n * HC, c: e * HC - n * HS });
const acToEn = (a, c) => ({ e: a * HS + c * HC, n: a * HC - c * HS });
export function placeReal(lat, lon) { const { a, c } = enToAc((lon - SITE.lon) * M_LON, (lat - SITE.lat) * M_LAT); return { x: c, z: -realToGame(a) }; }
export const llToWorld = placeReal;
export function worldToLl(x, z) { const { e, n } = acToEn(gameToReal(-z), x); return { lat: SITE.lat + n / M_LAT, lon: SITE.lon + e / M_LON }; }

// ---------- helpers ----------
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
const table = (T, s) => interp(T, 0, 1, s);
const clampT = (T, s) => table(T, Math.min(T[T.length - 1][0], Math.max(T[0][0], s)));

// ---------- the beach: water line and dune / town toe (x as a function of s = -z) ----------
const SHORE = [[-400, 175], [0, 136], [100, 122], [170, 112], [300, 106], [420, 112], [560, 122], [1000, 130]];
const TOE = [[-400, -35], [0, -15], [120, -30], [200, -45], [380, -45], [470, -20], [1000, -20]];
// x of the mean water line (h = 0) and of the toe of the town / foredunes
export const shoreX = (z) => clampT(SHORE, -z) + 4 * Math.sin(z * 0.021 + 1.3);
export const toeX = (z) => clampT(TOE, -z) + 6 * (fbm(z * 0.02 + 9, 3.1) - 0.5);
// metres inland of the water line (the real one: the swash band is 0..30, the dry beach runs to the toe)
const shoreD = (x, z) => shoreX(z) - x;

// ---------- the hole ----------
export const BOUNDS = { minX: -560, maxX: 560, minZ: -820, maxZ: 340 };
export const PAINT = { minX: -110, maxX: 80, minZ: -620, maxZ: 10 };
export const FAIRWAY = [[25, -42], [22, -150], [8, -300], [-2, -395], [-8, -432], [-30, -472], [-46, -497], [-62, -523], [-72, -540]];
export const FAIRWAY_HALF = 15;
export const CORNER = { x: -8, z: -432 };
export const GREEN = { x: -70, z: -533, rx: 15, rz: 13 };
export const CUP = { x: -76, z: -542 };
// the first shot aims down the beach (the green is round the bend to the left)
export const AIM_VIA = { x: 9, z: -290, until: 300 };
// Pismo Creek: crosses the beach from the lagoon behind it to the surf at the compressed creek-mouth mark
export const CREEK = { s: 170, halfW: 12.5, inX: -150 };
export const BUNKERS = [
  { x: -3, z: -272, r: 6.6, face: 1.1, from: [25, -32] },                     // fairway, left (~260 yd from the tee)
  { x: -10, z: -462, r: 5.4, face: 0.9, from: [-8, -432] },                      // second-shot zone, right (~100 yd short of the green)
  { x: GREEN.x + 17, z: GREEN.z + 4, r: 5.0, face: 0.55, from: [-34, -492] },   // greenside pot, right (seaward)
  { x: GREEN.x - 14, z: GREEN.z - 10, r: 4.6, face: 0.45, from: [-34, -492] },  // greenside pot, back left
];
export const WASTE = { x: 9999, z: 9999, ax: 0, len: 1, half: 1 };   // the whole beach is waste; no separate waste strip
export const wasteDist = () => 1e9;
export const PAR = 5;
const corridorY = (z) => { const s = -z; return 4.3 + 0.35 * Math.sin(s * 0.028) * sstep(40, 120, s) + GREEN_RISE * sstep(440, 525, s); };
// the green sits up on a foredune shelf: the last ~80 m of fairway climbs onto it, so a running approach checks up
const GREEN_RISE = 5.5;
const beachAt = (x, z) => { const d = shoreD(x, z); return d < 0 ? Math.max(-9, d * 0.07 - 0.15) : d < 30 ? d * 0.047 : 1.41 + (d - 30) * 0.032; };
export const TEE = { x: 25, z: -32, w: 6, d: 4.5, h: corridorY(-32) + 1.0, bank: 14 };
export const HOLE_M = Math.hypot(TEE.x - CORNER.x, TEE.z - CORNER.z) + Math.hypot(CORNER.x - CUP.x, CORNER.z - CUP.z);
export const HOLE_YD = Math.round(HOLE_M * 1.09361);
// Morro-only landmarks: none here (kept far away so shared code that still reads them places nothing)
export const ROCK = { x: 1e5, z: 1e5, rx: 1, rz: 1, h: 1 };
export const STACKS = [];
// where the gulls wheel: over the swash south of the pier
export const GULLS = { x: 95, z: -120 };

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
// signed distance across Pismo Creek's channel (< 0 inside), the lagoon widening behind the beach
export function creekDist(x, z) {
  const hw = CREEK.halfW + 10 * sstep(-40, -120, x) - 4 * sstep(60, 110, x);
  const across = Math.abs(-z - CREEK.s - 6 * Math.sin(x * 0.03) - 0.04 * Math.max(0, -x - 40)) - hw;
  return Math.max(across, CREEK.inX - x);
}

// "inland" for the shared coastal scatter (beach rocks, driftwood, ice plant, dune grass), which was tuned for Morro's ~16 m
// beach: the wide Pismo backshore is folded into that 0..16 band, past the toe it is true metres
export function inland(x, z) {
  const d = shoreD(x, z), w = Math.max(20, shoreX(z) - toeX(z));
  return d < 0 ? d : d < w ? 16 * d / w : 16 + (d - w);
}

export function greenHeight(x, z) {
  // two tiers: the back-left (the pin's side) ~18 cm above the front-right, joined by a soft ramp across the green,
  // and a gentle tilt back-to-front toward the beach
  const lx = x - GREEN.x, lz = z - GREEN.z, u = (lz + 0.45 * lx) + 1.5;
  return 4.45 + GREEN_RISE + lz * 0.009 + lx * 0.006 + 0.18 * sstep(3, -3, u) + 0.05 * Math.exp(-((lx - 6) ** 2 + (lz + 4) ** 2) / 35);
}

// height of the ground (m above the sea). Real profile: a ~1:20 swash face to ~1.4 m, then the dry beach rising ~1:30 to
// ~5-6 m at the toe; behind the pier the town climbs to ~10 m (Pomeroy) and ~19 m (upper Price St); south of the creek
// the foredunes stand 6-14 m and the Pismo Dunes Preserve ridge ~20-25 m behind (SSE of) the green
export function heightAt(x, z) {
  const s = -z, t = toeX(z) - x;   // t: metres inland of the toe
  let h = beachAt(x, z);
  if (t > 0) {
    const toeH = beachAt(toeX(z), z);
    const town = 4.5 * sstep(0, 70, t) + 9 * sstep(60, 300, t) + 1.5 * (fbm(x * 0.01, z * 0.01) - 0.5);
    const hum = fbm(x * 0.028 + 3, z * 0.028 - 1), dune = sstep(0, 28, t) * (1.5 + 7.5 * hum) + 2.5 * sstep(60, 200, t) * fbm(x * 0.01 + 5, z * 0.01);
    const kTown = 1 - sstep(90, 150, s), kDune = sstep(185, 260, s) + sstep(-150, -400, s) * 0.6;
    const flat = 0.6 + 2 * hum * sstep(0, 30, t);   // campground / lagoon flats between town and dunes
    h = toeH + town * kTown + dune * Math.min(1, kDune) + flat * Math.max(0, 1 - kTown - kDune);
  }
  // the Pismo Dunes Preserve ridge behind the green
  const rd = segDist(x, z, 30, -650, -260, -600), ridge = 18 * Math.exp(-((rd / 70) ** 2)) * sstep(-10, 30, t) * (0.8 + 0.4 * fbm(x * 0.02, z * 0.02));
  h = Math.max(h, h * 0.4 + ridge + 3.5 * sstep(-10, 30, t));
  // the playing corridor: smooth firm turf laid on the backshore, climbing into the foredunes at the end
  const fw = fairwayDist(x, z), corridor = 1 - sstep(FAIRWAY_HALF + 6, FAIRWAY_HALF + 26, fw);
  h = lerp(h, corridorY(z) + 0.25 * (fbm(x * 0.05 + 7, z * 0.05) - 0.5), corridor);
  // Pismo Creek
  const cd = creekDist(x, z); if (cd < 10) h = lerp(h, -1.1, 1 - sstep(-4, 9, cd));
  const td = teeDist(x, z); h = lerp(h, TEE.h, 1 - sstep(0, TEE.bank, td + Math.max(0, td) * 0.5 * (fbm(x * 0.06 + 2, z * 0.06) - 0.5)));
  const gd = greenDist(x, z); h = lerp(h, greenHeight(x, z), 1 - sstep(3, 11, gd));
  h += bunkerShape(x, z) * sstep(-0.5, 2.5, gd);
  return h;
}

// sand cover (0..1): the beach is all sand, the foredunes are sand with vegetated patches, the town is not
export function duneSand(x, z) {
  const t = toeX(z) - x, s = -z;
  if (t < 0) return 1;
  const kDune = Math.min(1, sstep(150, 230, s) + sstep(-150, -400, s) * 0.6);
  const veg = 0.5 + 0.65 * fbm(x * 0.05, z * 0.05) - 0.25 * sstep(20, 90, t);
  return Math.max(1 - sstep(0, 8, t), kDune * Math.min(1, veg));
}
export function sandiness(x, z) { return Math.max(duneSand(x, z) * (1 - sstep(FAIRWAY_HALF + 1, FAIRWAY_HALF - 1, fairwayDist(x, z))), 1 - sstep(-1.2, 0.9, bunkerDist(x, z))); }

export function surfaceAt(x, z) {
  const h = heightAt(x, z);
  if (h < WATER_LEVEL + 0.03) return 'water';
  if (x < BOUNDS.minX + 40 || x > BOUNDS.maxX - 40 || z < BOUNDS.minZ + 40 || z > BOUNDS.maxZ - 40) return 'water';
  if (greenDist(x, z) < 0) return 'green';
  if (teeDist(x, z) < 0) return 'tee';
  if (bunkerDist(x, z) < 0) return 'sand';
  if (fairwayDist(x, z) < FAIRWAY_HALF) return 'fairway';
  if (duneSand(x, z) > 0.5) return 'waste';
  return 'rough';
}
export function normalAt(x, z, e = 0.35) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx / (2 * e), nz = -hz / (2 * e), l = Math.hypot(nx, 1, nz);
  return { x: nx / l, y: 1 / l, z: nz / l };
}
export { fbm };
