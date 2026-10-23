// Course layout for Hole 1 · Morro Rock. Units are metres. The hole plays along world -Z,
// which points to compass bearing HEADING (WNW, like looking at the rock from the state park).
export const WATER_LEVEL = 0;
export const HEADING = 290;
export const BOUNDS = { minX: -620, maxX: 620, minZ: -720, maxZ: 560 };

export const TEE = { x: 22, z: 205, w: 7, d: 5, h: 7.2, bank: 24 };   // an elevated tee on a dune knoll: the hole is laid out below you
export const CHANNEL = { z: 140, halfW: 17, endX: 88 };        // inlet from the bay you have to carry
// a gentle dogleg left: the landing zone holds the right side, then the fairway turns down to the green
export const FAIRWAY = [[18, 118], [10, 40], [12, -8], [1, -70], [-3, -100], [0, -120]];
export const FAIRWAY_HALF = 13;
export const GREEN = { x: 0, z: -138, rx: 17, rz: 14 };
export const CUP = { x: 4.2, z: -141.5 };
// face: how high the far lip is built up (so the sand shows from where the shot comes in); fx/fz: which way it faces
export const BUNKERS = [
  { x: 19, z: -124, r: 6.5, face: 0.55 },     // greenside, front right
  { x: -15, z: -150, r: 5.2, face: 0.35 },    // greenside, back left
  { x: -17, z: -124, r: 4.4, face: 0.5 },     // greenside pot, front left
  { x: -6.5, z: -2, r: 6.8, face: 1.5 },       // fairway, inside the dogleg (~230 yd carry)
  { x: 30.5, z: -36, r: 8, face: 1.45 },       // fairway, through the corner on the right (~265 yd)
];
// a sandy waste area: the dunes spill in toward the left of the fairway between the inlet and the landing zone
export const WASTE = { x: -13, z: 46, ax: 0.12, len: 25, half: 9 };
export const ROCK = { x: -62, z: -350, rx: 132, rz: 100, h: 176 };
export const CAUSEWAY = [[28, -276], [78, -176]];
export const STACKS = [[330, -440], [352, -432], [374, -424]];
export const PAR = 4;
// playing length along the centre line (tee -> dogleg corner -> cup), as the card measures it
export const HOLE_M = Math.hypot(TEE.x - FAIRWAY[2][0], TEE.z - FAIRWAY[2][1]) + Math.hypot(FAIRWAY[2][0] - CUP.x, FAIRWAY[2][1] - CUP.z);
export const HOLE_YD = Math.round(HOLE_M * 1.09361);

// ---------- small deterministic noise ----------
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; } return s; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
  const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz)));
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t); return Math.hypot(dx, dz);
}
export function fairwayDist(x, z) { let d = 1e9; for (let i = 0; i < FAIRWAY.length - 1; i++) d = Math.min(d, segDist(x, z, ...FAIRWAY[i], ...FAIRWAY[i + 1])); return d; }
export function greenDist(x, z) { const dx = (x - GREEN.x) / GREEN.rx, dz = (z - GREEN.z) / GREEN.rz; return (Math.hypot(dx, dz) - 1) * Math.min(GREEN.rx, GREEN.rz); }
const bunkerEdge = (b, x, z) => Math.hypot(x - b.x, z - b.z) - b.r * (0.85 + 0.3 * vnoise(x * 0.35, z * 0.35));
export function bunkerDist(x, z) { let d = 1e9; for (const b of BUNKERS) d = Math.min(d, bunkerEdge(b, x, z)); return d; }
// bunkers are dug ~0.55 m in, with the far lip (away from the tee / the fairway) built up into a flashed sand face and a
// grassy mound behind it, so they read from a distance
function bunkerShape(x, z) {
  let dh = 0;
  for (const b of BUNKERS) {
    const bd = bunkerEdge(b, x, z); if (bd > 4) continue;
    // shots come in from the tee side (fairway bunkers) or down the fairway (greenside): face away from that point
    const fx = b.z > -100 ? TEE.x : 4, fz = b.z > -100 ? TEE.z : -40, fl = Math.hypot(b.x - fx, b.z - fz);
    const u = ((x - b.x) * (b.x - fx) + (z - b.z) * (b.z - fz)) / fl / b.r;
    dh -= (1 - sstep(-2.5, 1.5, bd)) * 0.55;
    dh += b.face * sstep(-0.9, 0.95, u) * (1 - sstep(0.4, 3.6, bd));
  }
  return dh;
}
export function wasteDist(x, z) {
  const W = WASTE, dx = x - W.x, dz = z - W.z, c = Math.cos(W.ax), s = Math.sin(W.ax);
  const a = dx * c - dz * s, l = dx * s + dz * c;   // a: across, l: along the strip
  const e = Math.hypot(a / W.half, l / W.len);
  const d = (e - 1) * W.half + 2.6 * (vnoise(x * 0.12 + 5, z * 0.12) - 0.5) + 1.2 * (vnoise(x * 0.4, z * 0.4) - 0.5);
  return Math.max(d, FAIRWAY_HALF + 3.2 - fairwayDist(x, z));   // runs right up to the first cut, never into it
}
export function teeDist(x, z) { return Math.max(Math.abs(x - TEE.x) - TEE.w, Math.abs(z - TEE.z) - TEE.d); }

// signed distance inland from the ocean (positive on land)
export function shoreX(z) { return -86 + 14 * Math.sin(z * 0.011 + 0.6) + 6 * Math.sin(z * 0.033); }
export function inland(x, z) {
  const west = x - shoreX(z);
  const north = z - (-186 + 9 * Math.sin(x * 0.02));             // ocean north of the green
  let d = Math.min(west, north + Math.max(0, -x - 60) * 0.0);
  // the rock rises out of the bay on a shallow reef (turquoise water + surf around its base)
  const rr = Math.hypot((x - ROCK.x) / ROCK.rx, (z - ROCK.z) / ROCK.rz);
  d = Math.max(d, (1.18 - rr) * 60 - 2.5);   // the rock's talus foot reaches ~1.2x its ellipse
  // the causeway: a low sand-and-riprap spit from the rock's south-east foot back to the shore
  const cw = segDist(x, z, CAUSEWAY[0][0], CAUSEWAY[0][1], CAUSEWAY[1][0], CAUSEWAY[1][1]) + 2.5 * Math.sin(x * 0.07 + z * 0.05);
  d = Math.max(d, Math.min(9, (13 - cw) * 0.9));
  return d;
}
function channelMask(x, z) { return sstep(CHANNEL.halfW + 9, CHANNEL.halfW - 2, Math.abs(z - CHANNEL.z) + 3 * Math.sin(x * 0.08)) * sstep(CHANNEL.endX + 6, CHANNEL.endX - 22, x); }

export function greenHeight(x, z) {
  // gentle back-to-front and right-to-left tilt, and two tiers: the back-right (where the pin is) sits ~16 cm above the
  // front, joined by a soft 7 m ramp running diagonally across the green. Putts up or down it break and need pace.
  const lx = x - GREEN.x, lz = z - GREEN.z;
  const u = (2.4 - 0.3 * lx) - lz;   // > 0: behind the ramp's centre line
  return 3.0 - lz * 0.008 + lx * 0.005 + 0.16 * sstep(-3.5, 3.5, u) + 0.07 * Math.exp(-((lx + 7) ** 2 + (lz - 6) ** 2) / 40);
}
// the fairway climbs gently (~2%) from the inlet through the landing zone, so the landing zone is shown to the tee,
// to a low ridge that crosses at an angle just past the dogleg corner, then runs down (~4%) to the green
export function fairwayShape(x, z) {
  const zz = z + 0.2 * (x - 10);
  return 2.1 * sstep(120, -42, zz) * (1 - 0.95 * sstep(-48, -118, zz));
}

// height of the ground (metres). Below WATER_LEVEL is water.
export function heightAt(x, z) {
  const d = inland(x, z);
  const roll = 0.9 * (fbm(x * 0.012, z * 0.012) - 0.5) + 0.35 * (fbm(x * 0.05 + 7, z * 0.05) - 0.5);
  const east = sstep(140, 620, x) * 55 * (0.55 + 0.6 * fbm(x * 0.006, z * 0.006)) + sstep(260, 700, z) * 22;
  let land = 2.9 + roll + east;
  // dunes between beach and course
  const duneBand = sstep(10, 22, d) * (1 - sstep(48, 70, d));
  // keep the dunes low behind the green so the rock stays in view from the putting surface
  const nearGreen = 1 - sstep(30, 85, greenDist(x, z));
  land += duneBand * (2.5 + 6 * fbm(x * 0.03 + 3, z * 0.03 - 1)) * (1 - sstep(35, 15, fairwayDist(x, z)) * 0.9) * (1 - nearGreen * 0.8);
  let h;
  if (d < 0) h = -0.4 + d * 0.11;                                   // sea floor
  else if (d < 14) h = lerp(-0.4, 1.4, d / 14);                     // beach
  else h = lerp(1.4, land, sstep(14, 30, d));
  // course shaping: flatten the playing corridor
  const fw = fairwayDist(x, z), corridor = 1 - sstep(FAIRWAY_HALF + 6, FAIRWAY_HALF + 26, fw);
  h = lerp(h, 2.8 + roll * 0.45 + fairwayShape(x, z), corridor * sstep(16, 28, d));
  // the waste area: a little lower than the rough, with low hummocks
  const wd = wasteDist(x, z); if (wd < 3) h -= (1 - sstep(-3, 3, wd)) * (0.3 - 0.25 * fbm(x * 0.15, z * 0.15));
  // the inlet
  const cm = channelMask(x, z); h = lerp(h, -2.6, cm);
  // tee box
  const td = teeDist(x, z); h = lerp(h, TEE.h, 1 - sstep(0, TEE.bank, td + Math.max(0, td) * 0.5 * (fbm(x * 0.06 + 2, z * 0.06) - 0.5)));
  // green
  const gd = greenDist(x, z); h = lerp(h, greenHeight(x, z), 1 - sstep(3, 11, gd));   // the pad carries on 3 m past the edge so the rim and collar are not sloped
  // bunkers
  h += bunkerShape(x, z) * sstep(-0.5, 2.5, gd);   // bunker lips never cut into the putting surface
  return h;
}

export function surfaceAt(x, z) {
  const h = heightAt(x, z);
  if (h < WATER_LEVEL + 0.03) return 'water';
  if (x < BOUNDS.minX + 40 || x > BOUNDS.maxX - 40 || z < BOUNDS.minZ + 40 || z > BOUNDS.maxZ - 40) return 'water';
  if (Math.hypot((x - ROCK.x) / ROCK.rx, (z - ROCK.z) / ROCK.rz) < 1) return 'water';
  if (greenDist(x, z) < 0) return 'green';
  if (teeDist(x, z) < 0) return 'tee';
  if (bunkerDist(x, z) < 0) return 'sand';
  if (wasteDist(x, z) < 0) return 'waste';
  const d = inland(x, z);
  if (d < 18 || (d < 60 && sandiness(x, z) > 0.5)) return 'waste';
  if (fairwayDist(x, z) < FAIRWAY_HALF) return 'fairway';
  return 'rough';
}
// how much of a vertex is sand/dune (used for both colouring and physics)
export function sandiness(x, z) { return Math.max(duneSand(x, z), 1 - sstep(-2.2, 1.2, wasteDist(x, z))); }
// the natural beach and dune sand alone (without the waste area)
export function duneSand(x, z) {
  const d = inland(x, z);
  const beach = 1 - sstep(14, 22, d);
  const dune = sstep(12, 20, d) * (1 - sstep(40, 62, d)) * (1 - sstep(FAIRWAY_HALF + 20, FAIRWAY_HALF + 6, fairwayDist(x, z)));
  return Math.max(beach, dune * (0.55 + 0.6 * fbm(x * 0.05, z * 0.05)));
}

export function normalAt(x, z, e = 0.35) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx / (2 * e), nz = -hz / (2 * e), l = Math.hypot(nx, 1, nz);
  return { x: nx / l, y: 1 / l, z: nz / l };
}
