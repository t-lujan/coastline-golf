// Course layout for Hole 1 · Morro Rock. Units are metres. North is -Z, east is +X.
export const WATER_LEVEL = 0;
export const BOUNDS = { minX: -620, maxX: 620, minZ: -720, maxZ: 560 };

export const TEE = { x: 22, z: 205, w: 7, d: 5, h: 3.4 };
export const CHANNEL = { z: 140, halfW: 17, endX: 88 };        // inlet from the bay you have to carry
export const FAIRWAY = [[18, 118], [10, 40], [0, -40], [-4, -95], [0, -120]];
export const FAIRWAY_HALF = 13;
export const GREEN = { x: 0, z: -138, rx: 17, rz: 14 };
export const CUP = { x: 4.2, z: -141.5 };
export const BUNKERS = [
  { x: 19, z: -124, r: 6.5 },
  { x: -15, z: -150, r: 5.2 },
  { x: 27, z: -18, r: 8 },
];
export const ROCK = { x: -75, z: -310, rx: 118, rz: 82, h: 150 };
export const SPIT = { a: [-30, -178], b: [-62, -262], halfW: 16 };
export const STACKS = [[330, -440], [352, -432], [374, -424]];
export const PAR = 4;

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
export function bunkerDist(x, z) { let d = 1e9; for (const b of BUNKERS) d = Math.min(d, Math.hypot(x - b.x, z - b.z) - b.r * (0.85 + 0.3 * vnoise(x * 0.35, z * 0.35))); return d; }
export function teeDist(x, z) { return Math.max(Math.abs(x - TEE.x) - TEE.w, Math.abs(z - TEE.z) - TEE.d); }

// signed distance inland from the ocean (positive on land)
export function shoreX(z) { return -86 + 14 * Math.sin(z * 0.011 + 0.6) + 6 * Math.sin(z * 0.033); }
export function inland(x, z) {
  const west = x - shoreX(z);
  const north = z - (-186 + 9 * Math.sin(x * 0.02));             // ocean north of the green
  let d = Math.min(west, north + Math.max(0, -x - 60) * 0.0);
  // causeway out to the rock
  const ds = SPIT.halfW - segDist(x, z, ...SPIT.a, ...SPIT.b);
  d = Math.max(d, ds);
  // the rock's footprint sits on a little sandy base
  const rr = Math.hypot((x - ROCK.x) / (ROCK.rx * 1.08), (z - ROCK.z) / (ROCK.rz * 1.08));
  d = Math.max(d, (1 - rr) * 40);
  return d;
}
function channelMask(x, z) { return sstep(CHANNEL.halfW + 9, CHANNEL.halfW - 2, Math.abs(z - CHANNEL.z) + 3 * Math.sin(x * 0.08)) * sstep(CHANNEL.endX + 6, CHANNEL.endX - 22, x); }

export function greenHeight(x, z) {
  // gentle back-to-front tilt with a ridge: putts break
  const lx = x - GREEN.x, lz = z - GREEN.z;
  return 3.1 - lz * 0.015 + lx * 0.009 + 0.35 * Math.exp(-((lx + 5) ** 2 + (lz - 2) ** 2) / 60);
}

// height of the ground (metres). Below WATER_LEVEL is water.
export function heightAt(x, z) {
  const d = inland(x, z);
  const roll = 0.9 * (fbm(x * 0.012, z * 0.012) - 0.5) + 0.35 * (fbm(x * 0.05 + 7, z * 0.05) - 0.5);
  const east = sstep(140, 620, x) * 55 * (0.55 + 0.6 * fbm(x * 0.006, z * 0.006)) + sstep(260, 700, z) * 22;
  let land = 2.9 + roll + east;
  // dunes between beach and course
  const duneBand = sstep(10, 22, d) * (1 - sstep(48, 70, d));
  land += duneBand * (2.5 + 6 * fbm(x * 0.03 + 3, z * 0.03 - 1)) * (1 - sstep(35, 15, fairwayDist(x, z)) * 0.9);
  let h;
  if (d < 0) h = -0.4 + d * 0.11;                                   // sea floor
  else if (d < 14) h = lerp(-0.4, 1.4, d / 14);                     // beach
  else h = lerp(1.4, land, sstep(14, 30, d));
  // course shaping: flatten the playing corridor
  const fw = fairwayDist(x, z), corridor = 1 - sstep(FAIRWAY_HALF + 6, FAIRWAY_HALF + 26, fw);
  h = lerp(h, 2.8 + roll * 0.45, corridor * sstep(16, 28, d));
  // the inlet
  const cm = channelMask(x, z); h = lerp(h, -2.6, cm);
  // tee box
  const td = teeDist(x, z); h = lerp(h, TEE.h, 1 - sstep(0, 4, td));
  // green
  const gd = greenDist(x, z); h = lerp(h, greenHeight(x, z), 1 - sstep(0, 7, gd));
  // bunkers
  const bd = bunkerDist(x, z); if (bd < 1.5) h -= (1 - sstep(-2.5, 1.5, bd)) * 0.55;
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
  const d = inland(x, z);
  if (d < 18 || (d < 60 && sandiness(x, z) > 0.5)) return 'sand';
  if (fairwayDist(x, z) < FAIRWAY_HALF) return 'fairway';
  return 'rough';
}
// how much of a vertex is sand/dune (used for both colouring and physics)
export function sandiness(x, z) {
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
