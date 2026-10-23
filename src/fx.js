// Shot tracer ribbon, aim line, landing marker, sand/turf puffs, splash, and the hole-out confetti.
import * as THREE from 'three';
import { heightAt } from './course.js';

const ribbonMat = (color, opacity) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
  vertexShader: `attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor * 1.35, vA * uOpacity); }`,
});

export class Ribbon {
  constructor(max, color, opacity = 1, widthK = 0.0045, minW = 0.06) {
    this.max = max; this.pts = []; this.widthK = widthK; this.minW = minW;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 2 * 3); this.alpha = new Float32Array(max * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aA', new THREE.BufferAttribute(this.alpha, 1));
    const idx = []; for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, ribbonMat(color, opacity)); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    this.fade = 1;
  }
  clear() { this.pts = []; this.fade = 1; }
  push(p) { const l = this.pts[this.pts.length - 1]; if (l && Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z) < 0.4) return; this.pts.push({ x: p.x, y: p.y, z: p.z }); if (this.pts.length > this.max) this.pts.shift(); }
  set(points) { this.pts = points.slice(0, this.max); }
  update(camera, headFade = true) {
    const n = this.pts.length, c = camera.position, P = this.pos, A = this.alpha;
    const g = this.mesh.geometry; g.setDrawRange(0, Math.max(0, (n - 1) * 6)); this.mesh.visible = n > 1;   // no empty draw call
    for (let i = 0; i < n; i++) {
      const p = this.pts[i], q = this.pts[Math.min(n - 1, i + 1)], o = this.pts[Math.max(0, i - 1)];
      let tx = q.x - o.x, ty = q.y - o.y, tz = q.z - o.z; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const vx = c.x - p.x, vy = c.y - p.y, vz = c.z - p.z, d = Math.hypot(vx, vy, vz) || 1;
      let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx; const sl = Math.hypot(sx, sy, sz) || 1;
      const w = Math.max(this.minW, d * this.widthK); sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
      P.set([p.x + sx, p.y + sy, p.z + sz, p.x - sx, p.y - sy, p.z - sz], i * 6);
      const t = i / Math.max(1, n - 1), a = (headFade ? Math.pow(t, 0.6) : 1) * this.fade;
      A[i * 2] = a; A[i * 2 + 1] = a;
    }
    g.attributes.position.needsUpdate = true; g.attributes.aA.needsUpdate = true;
  }
}

export function groundLine(from, yaw, length, step = 1.5) {
  const pts = [], dx = Math.sin(yaw), dz = -Math.cos(yaw);
  for (let s = 0; s <= length; s += step) { const x = from.x + dx * s, z = from.z + dz * s; pts.push({ x, y: Math.max(0.05, heightAt(x, z)) + 0.12, z }); }
  return pts;
}

export function createMarker() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ color: 0xb8e6e6, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  ring.rotation.x = -Math.PI / 2; g.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), ring.material); dot.rotation.x = -Math.PI / 2; g.add(dot);
  g.renderOrder = 6; g.visible = false; return g;
}

// generic CPU particle system on THREE.Points (soft round sprites)
export class Particles {
  constructor(max, size = 1) {
    this.max = max; this.items = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.sz = new Float32Array(max); this.al = new Float32Array(max); this.rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sz, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.al, 1)); g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 400 * size } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aRot; attribute vec3 color; varying vec3 vC; varying float vA; varying float vR; uniform float uScale;
        void main(){ vC = color; vA = aAlpha; vR = aRot; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      // aRot = 0: soft round puff. aRot != 0: a paper chip spinning in the plane and tumbling (its width flickers)
      fragmentShader: `varying vec3 vC; varying float vA; varying float vR;
        void main(){ vec2 d = gl_PointCoord - 0.5;
          if (vR == 0.0) { float r = length(d); if (r > 0.5) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.2, r)); return; }
          float c = cos(vR), s = sin(vR); vec2 q = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
          float tumble = 0.12 + 0.88 * abs(cos(vR * 1.7));
          if (abs(q.x) > 0.42 || abs(q.y) > 0.26 * tumble) discard;
          gl_FragColor = vec4(vC * (0.75 + 0.25 * tumble), vA); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 7;
  }
  emit(o) { if (this.items.length < this.max) this.items.push({ life: 0, ...o }); }
  update(dt) {
    let n = 0;
    this.items = this.items.filter((p) => (p.life += dt) < p.ttl);
    for (const p of this.items) {
      p.vy -= (p.g ?? 9.8) * dt; const drag = Math.exp(-(p.drag ?? 1.5) * dt); p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor !== undefined && p.y < p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      const t = p.life / p.ttl;
      this.pos.set([p.x, p.y, p.z], n * 3); this.col.set([p.r, p.g2, p.b], n * 3);
      this.sz[n] = p.size * (p.grow ? 1 + t * p.grow : 1); this.al[n] = (p.alpha ?? 1) * (p.hold ? 1 - Math.max(0, t - p.hold) / (1 - p.hold) : 1 - t) * Math.min(1, p.life * 12);
      this.rot[n] = p.spin ? p.ph + p.life * p.spin : 0;
      if (p.flutter) { p.vx += Math.sin(p.life * 5 + p.ph) * p.flutter * dt; p.vz += Math.cos(p.life * 4 + p.ph) * p.flutter * dt; }
      n++;
    }
    const g = this.points.geometry; g.setDrawRange(0, n); this.points.visible = n > 0;   // no empty draw call
    for (const k of ['position', 'color', 'aSize', 'aAlpha', 'aRot']) g.attributes[k].needsUpdate = true;
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);
export function puff(ps, at, surf, strength = 1) {
  const sand = surf === 'sand', water = surf === 'water';
  const base = water ? [0.85, 0.95, 0.97] : sand ? [0.92, 0.85, 0.66] : [0.42, 0.6, 0.27];
  const n = Math.round((water ? 40 : sand ? 34 : 18) * strength);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rnd(0.5, water ? 4.5 : 3) * strength;
    ps.emit({ x: at.x, y: at.y + 0.05, z: at.z, vx: Math.cos(a) * s, vy: rnd(1.5, water ? 7 : 4.5) * strength, vz: Math.sin(a) * s,
      ttl: rnd(0.6, 1.4), size: rnd(0.08, sand || water ? 0.22 : 0.12) * (water ? 1.4 : 1), grow: sand || water ? 1.5 : 0.3, drag: 2.2, g: water ? 9.8 : 6,
      r: base[0] * rnd(0.9, 1.05), g2: base[1] * rnd(0.9, 1.05), b: base[2] * rnd(0.9, 1.05), alpha: 0.95 });
  }
}
// paper confetti in the course palette plus a warm accent, and a quick bloom-bright sparkle burst out of the cup
const PALETTE = [[1, 1, 1], [0.722, 0.902, 0.902], [0.173, 0.416, 0.549], [1, 0.78, 0.32], [0.98, 0.45, 0.38], [0.882, 0.961, 0.953]];
export function confetti(ps, at) {
  for (let i = 0; i < 200; i++) {
    const a = Math.random() * Math.PI * 2, s = rnd(0.8, 4.2), c = PALETTE[(Math.random() * PALETTE.length) | 0];
    ps.emit({ x: at.x + Math.cos(a) * 0.1, y: at.y + 0.15, z: at.z + Math.sin(a) * 0.1, vx: Math.cos(a) * s, vy: rnd(5.5, 10.5), vz: Math.sin(a) * s, ttl: rnd(3.2, 4.6), hold: 0.7,
      size: rnd(0.09, 0.15), drag: 2.2, g: 3.2, flutter: rnd(1.5, 3), spin: rnd(4, 11) * (Math.random() < 0.5 ? -1 : 1), ph: rnd(0, 6.28),
      r: c[0], g2: c[1], b: c[2], alpha: 1, floor: at.y + 0.02 });
  }
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, el = rnd(0.25, 1.35), s = rnd(2.5, 6);
    ps.emit({ x: at.x, y: at.y + 0.08, z: at.z, vx: Math.cos(a) * Math.cos(el) * s, vy: Math.sin(el) * s + 1.5, vz: Math.sin(a) * Math.cos(el) * s, ttl: rnd(0.45, 0.9),
      size: rnd(0.03, 0.06), drag: 3.5, g: 2, r: 3.2, g2: 2.7, b: 1.7, alpha: 1 });
  }
}
