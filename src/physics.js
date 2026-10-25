// Ball flight + ground model. Units: metres, seconds.
//   flight : quadratic drag + Magnus lift from a spin vector (back + side), relative-airspeed wind with a height gradient
//   impact : restitution + Coulomb friction impulse that trades tangential speed against spin (backspin bites / checks)
//   roll   : sliding friction until the contact point stops slipping, then rolling resistance (tapering near the end)
//   cup    : speed-dependent capture, deterministic lip-outs
// Everything advances in fixed 1/240 s substeps (see Ball.step), so frame rate never changes the result.
import { heightAt, normalAt, surfaceAt, greenDist, CUP } from './course.js';

export const BALL_R = 0.0214;
export const DT = 1 / 240;
const G = 9.81, MASS = 0.0459, RHO = 1.2, AREA = Math.PI * BALL_R * BALL_R;
const K_AIR = 0.5 * RHO * AREA / MASS;       // ~0.0188 1/m: a = K_AIR * C * v^2
const K_INERTIA = 0.4;                         // solid sphere: I = 0.4 m r^2
const RPM = Math.PI / 30;
// vmax: ball speed (m/s) at full power; launch: degrees; spin: backspin (rad/s) at full power (scales with ball speed); side: sidespin
// (rad/s) at full draw/fade; spinTau: seconds for the spin to fall by 1/e in the air; grab: how hard it checks on a green (see impact)
export const CLUBS = {
  driver: { name: 'Driver', vmax: 72, launch: 11.5, spin: 2500 * RPM, side: 520 * RPM, spinTau: 22, grab: 0.8 },
  iron:   { name: 'Iron',   vmax: 49, launch: 20,   spin: 6800 * RPM, side: 900 * RPM, spinTau: 20, grab: 0.1 },
  wedge:  { name: 'Wedge',  vmax: 36.5, launch: 33.5,   spin: 9200 * RPM, side: 1100 * RPM, spinTau: 18, grab: 0.65 },
  putter: { name: 'Putter', vmax: 5.6, launch: 0,   spin: 0, side: 0, spinTau: 1 },
};
// e: normal restitution; mu: friction at impact; keep: share of the along-ground speed that survives a bounce (turf shear);
// slide: kinetic friction while the ball skids; roll: rolling deceleration (m/s^2), growing by rv per m/s above rt (a fast ball
// ploughs through the blades); label for the HUD
export const SURF = {
  fairway: { e: 0.3,  mu: 0.55, keep: 0.62,  slide: 0.4,  roll: 1.25, rv: 0.09, label: 'Fairway' },
  tee:     { e: 0.3,  mu: 0.55, keep: 0.62,  slide: 0.4,  roll: 1.25, rv: 0.09, label: 'Tee box' },
  rough:   { e: 0.16, mu: 0.9,  keep: 0.58, slide: 0.65, roll: 3.4, rv: 0.05,  label: 'Rough' },
  sand:    { e: 0.04, mu: 1.0,  keep: 0.14, slide: 1.0,  roll: 7.5,  label: 'Bunker' },
  waste:   { e: 0.12, mu: 0.85, keep: 0.45, slide: 0.8,  roll: 4.6,  label: 'Waste sand' },
  green:   { e: 0.12, mu: 0.5,  keep: 0.24, slide: 0.3,  roll: 0.66, rv: 0.4, rt: 3, label: 'Green' },
  path:    { e: 0.55, mu: 0.35, keep: 0.95, slide: 0.35, roll: 0.5,  label: 'Hardpan' },   // cart path / hardpan: lively and hard
  water:   { e: 0, mu: 0, keep: 0, slide: 1, roll: 99, label: 'Water' },
};
// the collar and first cut around the green drag noticeably more than the putting surface
const COLLAR = 3.5, COLLAR_ROLL = 1.9;
const rollFriction = (surf, x, z) => (surf === 'fairway' || surf === 'rough') && greenDist(x, z) < COLLAR ? Math.max(SURF[surf].roll, COLLAR_ROLL) : SURF[surf].roll;
// what each lie does to the swing: share of full speed, launch angle and spin (rough grabs the face: lower, flatter, less spin)
const LIE = {
  tee: { v: 1, l: 1, s: 1 }, fairway: { v: 1, l: 1, s: 1 }, green: { v: 1, l: 1, s: 1 },
  rough: { v: 0.9, l: 0.9, s: 0.7 }, waste: { v: 0.8, l: 0.9, s: 0.6 }, sand: { v: 0.62, l: 1.1, s: 0.4 }, path: { v: 1, l: 1, s: 1 },
};
const WEDGE_LIE = { rough: { v: 0.86, l: 0.95, s: 0.55 }, waste: { v: 0.95, l: 0.95, s: 0.7 }, sand: { v: 0.9, l: 1.15, s: 0.5 } };
const lieOf = (club, lie) => (club === 'wedge' && WEDGE_LIE[lie]) || LIE[lie] || LIE.fairway;
export const liePenalty = (club, lie) => (club === 'putter' ? 1 : lieOf(club, lie).v);

// cup: a ball whose centre is within CUP_R of the hole drops if it is slow enough for that offset, otherwise it skids over the lip
const CUP_R = 0.075, CUP_V = 1.7;

export class Ball {
  constructor() { this.p = { x: 0, y: 0, z: 0 }; this.v = { x: 0, y: 0, z: 0 }; this.w = { x: 0, y: 0, z: 0 }; this.state = 'rest'; this.events = []; this.acc = 0; }
  place(x, z) { this.p = { x, y: heightAt(x, z) + BALL_R, z }; this.v = { x: 0, y: 0, z: 0 }; this.w = { x: 0, y: 0, z: 0 }; this.state = 'rest'; this.lie = surfaceAt(x, z); }
  // a copy that continues exactly where this ball is (used to peek ahead without disturbing the real one)
  clone() { const b = new Ball(); Object.assign(b, this); b.p = { ...this.p }; b.v = { ...this.v }; b.w = { ...this.w }; b.events = []; return b; }
  // yaw: radians, 0 = north (-z), positive turns east (+x). curve: -1 (full draw) .. +1 (full fade), 0 = straight
  strike(clubKey, power, yaw, wind, curve = 0) {
    const c = CLUBS[clubKey]; this.club = c; this.wind = wind; this.t = 0; this.acc = 0; this.start = { ...this.p };
    const L = lieOf(clubKey, this.lie), putt = clubKey === 'putter';
    const speed = c.vmax * (putt ? Math.pow(power, 1.6) : power) * L.v;
    const la = c.launch * L.l * Math.PI / 180, dx = Math.sin(yaw), dz = -Math.cos(yaw);
    this.v = { x: dx * Math.cos(la) * speed, y: Math.sin(la) * speed, z: dz * Math.cos(la) * speed };
    // backspin axis is horizontal and perpendicular to the line; sidespin axis is vertical (curve > 0: a fade bends right)
    const back = c.spin * L.s * (putt ? 0 : speed / c.vmax), side = -(curve || 0) * c.side * L.s * speed / c.vmax;
    this.w = { x: -dz * back, y: side, z: dx * back };
    if (putt) { this.w = { x: this.v.z / BALL_R, y: 0, z: -this.v.x / BALL_R }; }   // a putt leaves the face already rolling
    this.state = putt ? 'roll' : 'flight';
    this.lastDry = { ...this.p }; this.dryT = 0; this.maxH = this.p.y; this.carry = null; this.events = []; this.bounces = 0; this.rollT = 0;
    this.apex = 0; this.landAngle = null; this.lipped = false; this.rim = 0;
  }
  ground() { return heightAt(this.p.x, this.p.z) + BALL_R; }
  // advance by dt seconds in whole fixed substeps; the remainder carries over so any frame rate gives the same trajectory
  step(dt) {
    this.acc += dt;
    while (this.acc >= DT - 1e-9) {
      this.acc -= DT; this.sub(DT);
      if (this.state === 'rest' || this.state === 'holed' || this.state === 'water') { this.acc = 0; break; }
    }
  }
  sub(dt) {
    if (this.state === 'rest' || this.state === 'holed' || this.state === 'water') return;
    this.t += dt;
    if (this.state === 'flight') this.fly(dt); else this.roll(dt);
  }
  fly(dt) {
    const p = this.p, v = this.v, w = this.w;
    // wind blows harder up high (power-law-ish gradient), and acts through the ball's airspeed
    const h = Math.max(0, p.y - this.ground()), hf = 0.4 + Math.min(1, h / 35) * 0.45;
    const rx = v.x - this.wind.x * hf, ry = v.y, rz = v.z - this.wind.z * hf, sp = Math.hypot(rx, ry, rz) || 1e-6;
    const wm = Math.hypot(w.x, w.y, w.z), S = wm * BALL_R / sp;
    const cd = 0.235 + 0.2 * S + 0.12 * Math.exp(-sp / 12);     // drag coefficient: grows with spin and at low speed
    const cl = 0.33 * (1 - Math.exp(-S / 0.13));                  // lift saturates at high spin ratio
    let ax = -K_AIR * cd * sp * rx, ay = -G - K_AIR * cd * sp * ry, az = -K_AIR * cd * sp * rz;
    if (wm > 1e-3) {
      const m = K_AIR * cl * sp / wm;          // Magnus: along (spin x relative velocity)
      ax += m * (w.y * rz - w.z * ry); ay += m * (w.z * rx - w.x * rz); az += m * (w.x * ry - w.y * rx);
      const d = Math.exp(-dt / this.club.spinTau); w.x *= d; w.y *= d; w.z *= d;
    }
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
    this.maxH = Math.max(this.maxH, p.y);
    this.dryT += dt;
    if (this.dryT > 0.08) { this.dryT = 0; if (surfaceAt(p.x, p.z) !== 'water') this.lastDry = { ...p }; }
    const gy = this.ground();
    if (p.y <= gy && v.y < 0) this.impact(gy);
  }
  roll(dt) {
    const p = this.p, v = this.v, w = this.w, R = BALL_R;
    const surf = this.flat ? 'green' : surfaceAt(p.x, p.z), S = SURF[surf];
    if (surf === 'water') { this.state = 'water'; this.events.push({ type: 'water', at: { ...p } }); return; }
    const n = this.flat ? { x: 0, y: 1, z: 0 } : normalAt(p.x, p.z);
    this.rollT += dt;
    // gravity along the slope (the break on a putt)
    v.x += n.x * n.y * G * dt; v.z += n.z * n.y * G * dt;
    const slope = Math.hypot(n.x, n.z) * G, fr = rollFriction(surf, p.x, p.z);
    // slip of the contact point: forward backspin makes it slide, then the ball grips and rolls
    let ux = v.x + R * w.z, uz = v.z - R * w.x, um = Math.hypot(ux, uz);
    if (um > 0.02) {
      const dv = Math.min(S.slide * G * dt, um * K_INERTIA / (1 + K_INERTIA)), kx = ux / um, kz = uz / um;
      v.x -= dv * kx; v.z -= dv * kz;
      w.x += dv * kz / (K_INERTIA * R); w.z -= dv * kx / (K_INERTIA * R);
    } else {
      const sp = Math.hypot(v.x, v.z);
      // rolling resistance, easing off over the last few cm/s so the ball dies away smoothly
      const dec = fr * (0.55 + 0.45 * Math.min(1, sp / 0.6)) * (1 + (S.rv || 0) * Math.max(0, sp - (S.rt || 0))) * dt;
      if (sp > dec) { v.x -= dec * v.x / sp; v.z -= dec * v.z / sp; }
      else if (slope < fr * 0.9) { v.x = 0; v.z = 0; }
      w.x = v.z / R; w.z = -v.x / R;
    }
    p.x += v.x * dt; p.z += v.z * dt; p.y = this.ground(); v.y = 0;
    if (!this.flat) this.checkCup(Math.hypot(v.x, v.z));
    const sp2 = Math.hypot(v.x, v.z);
    if (this.state === 'roll' && sp2 < 0.04 && slope < fr * 1.02) { v.x = v.z = 0; w.x = w.y = w.z = 0; this.state = 'rest'; this.lie = surf; this.events.push({ type: 'rest' }); }
    if (this.t > 40) { this.state = 'rest'; this.lie = surf; }
  }
  impact(gy) {
    const p = this.p, v = this.v, w = this.w, R = BALL_R, surf = surfaceAt(p.x, p.z);
    if (this.carry === null) {
      this.carry = Math.hypot(p.x - this.start.x, p.z - this.start.z); this.apex = this.maxH - this.start.y;
      this.landAngle = Math.atan2(-v.y, Math.hypot(v.x, v.z)) * 180 / Math.PI;
    }
    if (surf === 'water') { this.state = 'water'; this.events.push({ type: 'water', at: { ...p } }); return; }
    // slam dunk
    const dc = Math.hypot(p.x - CUP.x, p.z - CUP.z);
    if (dc < 0.16 && Math.hypot(v.x, v.y, v.z) < 9) { this.hole(); return; }
    const S = SURF[surf], n = normalAt(p.x, p.z);
    const vn = v.x * n.x + v.y * n.y + v.z * n.z, vin = -vn;
    let tx = v.x - n.x * vn, ty = v.y - n.y * vn, tz = v.z - n.z * vn;
    // on a green the first two bounces also check by the shot: more grab and a steeper descent bite, a flat low one runs on
    const steep = Math.min(1.3, Math.max(0, (Math.atan2(vin, Math.hypot(tx, tz)) * 180 / Math.PI - 12) / 30));
    const chk = this.bounces < 2 && surf === 'green' ? 1.15 - 0.15 * steep - (this.club.grab || 0) * Math.max(0.5, steep) : 1; this.bounces++;
    p.y = gy;
    this.events.push({ type: 'impact', surf, speed: vin, at: { ...p } });
    if (surf === 'sand') {                       // plugs: the ball digs in and barely moves on
      v.x = tx * S.keep; v.y = 0; v.z = tz * S.keep; w.x = w.y = w.z = 0; this.state = 'roll'; return;
    }
    // contact-point slip speed: ball velocity plus spin at the surface (n x w)
    const ux = tx + R * (n.y * w.z - n.z * w.y), uy = ty + R * (n.z * w.x - n.x * w.z), uz = tz + R * (n.x * w.y - n.y * w.x);
    const um = Math.hypot(ux, uy, uz);
    if (um > 1e-6) {
      const j = Math.min(S.mu * (1 + S.e) * vin, um * K_INERTIA / (1 + K_INERTIA)), kx = ux / um, ky = uy / um, kz = uz / um;
      tx -= j * kx; ty -= j * ky; tz -= j * kz;
      const f = j / (K_INERTIA * R);             // spin change from the friction torque (n x k)
      w.x += f * (n.y * kz - n.z * ky); w.y += f * (n.z * kx - n.x * kz); w.z += f * (n.x * ky - n.y * kx);
    }
    tx *= S.keep * chk; ty *= S.keep * chk; tz *= S.keep * chk;
    const eN = S.e * vin;
    if (eN > 1.2) {                              // hops on
      v.x = tx + n.x * eN; v.y = ty + n.y * eN; v.z = tz + n.z * eN; p.y += 0.002;
    } else {
      v.x = tx; v.y = 0; v.z = tz; this.state = 'roll';
    }
  }
  checkCup(sp) {
    const dx = this.p.x - CUP.x, dz = this.p.z - CUP.z, d = Math.hypot(dx, dz);
    if (d >= CUP_R || this.lipped || sp < 1e-3) return;
    // judge the pass once, as the ball reaches the rim: how far from dead-centre its line goes (miss), and how fast it is
    const vx = this.v.x, vz = this.v.z, cross = (dx * vz - dz * vx) / sp, miss = Math.min(CUP_R, Math.abs(cross));
    // slower balls drop; the dead-centre limit is highest and shrinks for off-centre lines
    if (sp < CUP_V * (1 - 0.55 * miss / CUP_R)) { this.hole(); return; }
    // too fast: the ball catches the lip on the side it came in on and is knocked off line, losing some speed
    this.lipped = true;
    const side = Math.sign(cross) || 1, a = side * (0.15 + 0.9 * miss / CUP_R) * Math.min(1, 1.6 / Math.max(sp, 0.5));
    const c = Math.cos(a), s = Math.sin(a), keep = sp > 3 ? 0.9 : 0.75;
    this.v.x = (vx * c - vz * s) * keep; this.v.z = (vx * s + vz * c) * keep;
    this.events.push({ type: 'lip' });
  }
  hole() { this.state = 'holed'; this.v = { x: 0, y: 0, z: 0 }; this.events.push({ type: 'holed' }); }
}

// quick prediction for the aim readout (carry + total); path: an array to fill with the ground track every ~step metres
// (the putt preview line, so the break on a sloping green shows before the stroke)
// how far a putt of this power rolls on perfectly flat green (no slope, no cup): the straight preview line length
const flatCache = new Map();
export function flatPuttDist(power) {
  const k = Math.round(power * 200);
  if (!flatCache.has(k)) {
    const b = new Ball(); b.flat = true; b.place(0, 0); b.lie = 'green'; b.strike('putter', k / 200, 0, { x: 0, z: 0 }, 0);
    for (let i = 0; i < 240 * 40 && b.state === 'roll'; i++) b.sub(DT);
    flatCache.set(k, Math.hypot(b.p.x, b.p.z));
  }
  return flatCache.get(k);
}
export function predict(start, lie, club, power, yaw, wind, curve = 0, path = null, step = 0.25) {
  const b = new Ball(); b.p = { ...start }; b.lie = lie; b.strike(club, power, yaw, wind, curve);
  let carryPt = null, last = { ...start };
  if (path) path.push({ ...start });
  for (let i = 0; i < 240 * 20 && (b.state === 'flight' || b.state === 'roll'); i++) {
    b.sub(DT);
    if (carryPt === null && b.carry !== null) carryPt = { ...b.p };
    if (path && Math.hypot(b.p.x - last.x, b.p.z - last.z) >= step) { last = { ...b.p }; path.push(last); }
  }
  if (path) path.push({ ...b.p });
  return { carry: b.carry ?? Math.hypot(b.p.x - start.x, b.p.z - start.z), end: { ...b.p }, carryPt, state: b.state, path };
}
