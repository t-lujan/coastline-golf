// Ball flight + ground model. Units: metres, seconds.
import { heightAt, normalAt, surfaceAt, greenDist, CUP } from './course.js';

export const BALL_R = 0.0214;
// spin: backspin that bites on a green (see impact); check: how much of the ball's along-ground speed survives the first bounces (backspin bites); bite: extra
// rolling friction (m/s^2) while that spin wears off over the first second on the ground
export const CLUBS = {
  driver: { name: 'Driver', vmax: 76, launch: 12.5, lift: 0.0024, spinDecay: 7, check: 1, bite: 0, spin: 0 },
  iron:   { name: 'Iron',   vmax: 49, launch: 23,   lift: 0.0026, spinDecay: 5, check: 1, bite: 0, spin: 0.1 },
  wedge:  { name: 'Wedge',  vmax: 35, launch: 33,   lift: 0.0030, spinDecay: 4, check: 0.4, bite: 2.2, spin: 0.65 },
  putter: { name: 'Putter', vmax: 6.5, launch: 0,    lift: 0,      spinDecay: 1, check: 1, bite: 0 },
};
export const SURF = {
  fairway: { e: 0.32, keep: 0.72, roll: 1.25, label: 'Fairway' },
  tee:     { e: 0.30, keep: 0.70, roll: 1.25, label: 'Tee box' },
  rough:   { e: 0.18, keep: 0.48, roll: 3.4,  label: 'Rough' },
  sand:    { e: 0.04, keep: 0.14, roll: 7.5,  label: 'Bunker' },
  waste:   { e: 0.12, keep: 0.4,  roll: 4.6,  label: 'Waste sand' },
  green:   { e: 0.13, keep: 0.4,  roll: 0.85, label: 'Green' },
  water:   { e: 0, keep: 0, roll: 99, label: 'Water' },
};
const G = 9.81, DRAG = 0.0048;
// the collar and first cut around the green drag noticeably more than the putting surface
const COLLAR = 3.5, COLLAR_ROLL = 1.9;
const rollFriction = (surf, x, z) => (surf === 'fairway' || surf === 'rough') && greenDist(x, z) < COLLAR ? Math.max(SURF[surf].roll, COLLAR_ROLL) : SURF[surf].roll;
// share of full speed you get out of each lie; the wedge's wide sole splashes out of sand and cuts through rough
const LIE_PENALTY = { tee: 1, fairway: 1, green: 1, rough: 0.86, waste: 0.8, sand: 0.62 };
const WEDGE_LIE = { tee: 1, fairway: 1, green: 1, rough: 0.94, waste: 0.95, sand: 0.9 };
export const liePenalty = (club, lie) => (club === 'putter' ? 1 : ((club === 'wedge' ? WEDGE_LIE : LIE_PENALTY)[lie] ?? 1));

export class Ball {
  constructor() { this.p = { x: 0, y: 0, z: 0 }; this.v = { x: 0, y: 0, z: 0 }; this.state = 'rest'; this.events = []; }
  place(x, z) { this.p = { x, y: heightAt(x, z) + BALL_R, z }; this.v = { x: 0, y: 0, z: 0 }; this.state = 'rest'; this.lie = surfaceAt(x, z); }
  // yaw: radians, 0 = north (-z), positive turns east (+x)
  strike(clubKey, power, yaw, wind) {
    const c = CLUBS[clubKey]; this.club = c; this.wind = wind; this.t = 0; this.start = { ...this.p };
    const lp = liePenalty(clubKey, this.lie);
    const speed = c.vmax * (clubKey === 'putter' ? Math.pow(power, 1.6) : power) * lp;
    const la = c.launch * Math.PI / 180, dx = Math.sin(yaw), dz = -Math.cos(yaw);
    this.v = { x: dx * Math.cos(la) * speed, y: Math.sin(la) * speed, z: dz * Math.cos(la) * speed };
    this.state = clubKey === 'putter' ? 'roll' : 'flight';
    this.lastDry = { ...this.p }; this.dryT = 0; this.maxH = this.p.y; this.carry = null; this.events = []; this.bounces = 0; this.rollT = 0;
  }
  ground() { return heightAt(this.p.x, this.p.z) + BALL_R; }
  step(dt) {
    if (this.state === 'rest' || this.state === 'holed' || this.state === 'water') return;
    this.t += dt;
    const p = this.p, v = this.v;
    if (this.state === 'flight') {
      const hf = 0.55 + Math.min(1, Math.max(0, (p.y - this.ground()) / 25)) * 0.7;
      const rx = v.x - this.wind.x * hf, ry = v.y, rz = v.z - this.wind.z * hf, sp = Math.hypot(rx, ry, rz);
      let ax = -DRAG * sp * rx, ay = -G - DRAG * sp * ry, az = -DRAG * sp * rz;
      // backspin lift, perpendicular to the relative velocity in the vertical plane
      const lift = this.club.lift * Math.exp(-this.t / this.club.spinDecay) * sp * sp;
      const hs = Math.hypot(rx, rz) || 1e-6;
      ax += lift * (-ry * rx / hs) / sp; ay += lift * hs / sp; az += lift * (-ry * rz / hs) / sp;
      v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
      p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      this.maxH = Math.max(this.maxH, p.y);
      this.dryT += dt;
      if (this.dryT > 0.08) { this.dryT = 0; if (surfaceAt(p.x, p.z) !== 'water') this.lastDry = { ...p }; }
      const gy = this.ground();
      if (p.y <= gy && v.y < 0) this.impact(gy);
    } else if (this.state === 'roll') {
      const surf = surfaceAt(p.x, p.z), S = SURF[surf];
      if (surf === 'water') { this.state = 'water'; this.events.push({ type: 'water', at: { ...p } }); return; }
      const n = normalAt(p.x, p.z);
      // gravity along the slope
      const gn = -G * n.y; let ax = -(0 - n.x * gn), az = -(0 - n.z * gn);
      ax = n.x * n.y * G; az = n.z * n.y * G;
      const sp = Math.hypot(v.x, v.z);
      // backspin keeps biting for a moment after the ball lands (wedges stop quickly)
      this.rollT += dt;
      const fr = rollFriction(surf, p.x, p.z) + (surf === 'water' ? 0 : this.club.bite * Math.exp(-this.rollT / 0.5));
      if (sp > 1e-4) { ax -= fr * v.x / sp; az -= fr * v.z / sp; }
      const nvx = v.x + ax * dt, nvz = v.z + az * dt;
      // friction can't reverse motion
      if (sp > 1e-4 && (nvx * v.x + nvz * v.z) < 0 && Math.hypot(n.x, n.z) * G < fr) { v.x = 0; v.z = 0; }
      else { v.x = nvx; v.z = nvz; }
      p.x += v.x * dt; p.z += v.z * dt; p.y = this.ground(); v.y = 0;
      this.checkCup(Math.hypot(v.x, v.z));
      const sp2 = Math.hypot(v.x, v.z);
      if (this.state === 'roll' && sp2 < 0.05 && Math.hypot(n.x, n.z) * G < fr * 1.02) { v.x = v.z = 0; this.state = 'rest'; this.lie = surf; this.events.push({ type: 'rest' }); }
      if (this.t > 40) { this.state = 'rest'; this.lie = surf; }
    }
  }
  impact(gy) {
    const p = this.p, v = this.v, surf = surfaceAt(p.x, p.z);
    if (this.carry === null) this.carry = Math.hypot(p.x - this.start.x, p.z - this.start.z);
    if (surf === 'water') { this.state = 'water'; this.events.push({ type: 'water', at: { ...p } }); return; }
    // slam dunk
    const dc = Math.hypot(p.x - CUP.x, p.z - CUP.z);
    if (dc < 0.16 && Math.hypot(v.x, v.y, v.z) < 9) { this.hole(); return; }
    const S = SURF[surf], n = normalAt(p.x, p.z);
    // spin checks the ball on its first two bounces (on soft sand it plugs anyway)
    const vn = v.x * n.x + v.y * n.y + v.z * n.z;
    const tx = v.x - n.x * vn, ty = v.y - n.y * vn, tz = v.z - n.z * vn;
    // on a green the check comes from the shot: more spin and a steeper descent grab, a flat low-spin one runs on
    const steep = Math.min(1.3, Math.max(0, (Math.atan2(-vn, Math.hypot(tx, tz)) * 180 / Math.PI - 12) / 30));
    const chk = this.bounces < 2 ? (surf === 'green' ? 1.15 - (this.club.spin + 0.15) * steep : this.club.check) : 1; this.bounces++;
    p.y = gy;
    this.events.push({ type: 'impact', surf, speed: -vn, at: { ...p } });
    if (-vn > 1.6 && surf !== 'sand') {
      v.x = tx * S.keep * chk - n.x * vn * S.e; v.y = ty * S.keep * chk - n.y * vn * S.e; v.z = tz * S.keep * chk - n.z * vn * S.e;
      p.y += 0.002;
    } else {
      const keep = surf === 'sand' ? 0.12 : S.keep * chk;
      v.x = tx * keep; v.z = tz * keep; v.y = 0; this.state = 'roll';
    }
  }
  checkCup(sp) {
    const dx = this.p.x - CUP.x, dz = this.p.z - CUP.z, d = Math.hypot(dx, dz);
    if (d < 0.1 && sp < 1.7) this.hole();
    else if (d < 0.055 && sp < 2.6) this.hole();
    else if (d < 0.12 && sp >= 1.7 && !this.lipped) {      // lip-out: deflect and slow
      this.lipped = true; const a = (Math.random() - 0.5) * 1.2, c = Math.cos(a), s = Math.sin(a);
      const vx = this.v.x, vz = this.v.z; this.v.x = (vx * c - vz * s) * 0.75; this.v.z = (vx * s + vz * c) * 0.75;
      this.events.push({ type: 'lip' });
    }
  }
  hole() { this.state = 'holed'; this.v = { x: 0, y: 0, z: 0 }; this.events.push({ type: 'holed' }); }
}

// quick prediction for the aim readout (carry + total)
export function predict(start, lie, club, power, yaw, wind) {
  const b = new Ball(); b.p = { ...start }; b.lie = lie; b.strike(club, power, yaw, wind);
  let carryPt = null;
  for (let i = 0; i < 2400 && (b.state === 'flight' || b.state === 'roll'); i++) {
    b.step(1 / 120);
    if (carryPt === null && b.carry !== null) carryPt = { ...b.p };
  }
  return { carry: b.carry ?? Math.hypot(b.p.x - start.x, b.p.z - start.z), end: { ...b.p }, carryPt, state: b.state };
}
