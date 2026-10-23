// Life and atmosphere: sailboats on the bay, wisps from the stacks, low morning mist over the water.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STACKS, heightAt } from './course.js';
import { GLSL_NOISE } from './noise.js';

const tint = (g, c) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); const a = []; for (let i = 0; i < g.attributes.position.count; i++) a.push(...c); g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)); return g; };
const tri = (pts, c) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)); return tint(g, c); };

export function createBoats() {
  const hull = new THREE.BoxGeometry(1.6, 0.7, 6, 1, 1, 3); const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i), y = p.getY(i); const k = z < -1 ? 1 - (-z - 1) / 2.2 : 1; p.setX(i, p.getX(i) * Math.max(0.05, k) * (y < 0 ? 0.7 : 1)); }
  hull.computeVertexNormals();
  const parts = [
    tint(hull, [0.92, 0.93, 0.92]),
    tint(new THREE.BoxGeometry(1.62, 0.12, 5.2).translate(0, 0.1, 0.35), [0.16, 0.16, 0.25]),
    tint(new THREE.CylinderGeometry(0.06, 0.08, 9, 5).translate(0, 4.8, 0.2), [0.8, 0.8, 0.78]),
    tri([[0, 0.9, 0.35], [0, 9.0, 0.25], [0, 0.9, 3.0]], [1, 1, 0.97]),
    tri([[0, 0.9, 0.35], [0, 0.9, 3.0], [0, 9.0, 0.25]], [1, 1, 0.97]),
    tri([[0, 0.8, -2.6], [0, 8.4, 0.1], [0, 0.8, 0.0]], [0.72, 0.9, 0.9]),
    tri([[0, 0.8, -2.6], [0, 0.8, 0.0], [0, 8.4, 0.1]], [0.72, 0.9, 0.9]),
  ];
  const geo = mergeGeometries(parts);
  const boats = [{ x: -300, z: -430, r: 60, sp: 0.012, ph: 0 }, { x: -420, z: -170, r: 90, sp: -0.009, ph: 2 }, { x: 150, z: -520, r: 70, sp: 0.01, ph: 4 }];
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), boats.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1.6, 1.6, 1.6);
  mesh.userData.update = (t) => {
    boats.forEach((b, i) => {
      const a = b.ph + t * b.sp;
      v.set(b.x + Math.cos(a) * b.r, 0.15 + Math.sin(t * 1.3 + i) * 0.12, b.z + Math.sin(a) * b.r);
      e.set(Math.sin(t * 0.9 + i) * 0.04, -a + (b.sp > 0 ? Math.PI : 0), 0.12 + Math.sin(t * 1.1 + i * 2) * 0.05); q.setFromEuler(e);
      m.compose(v, q, s); mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  mesh.userData.update(0); mesh.frustumCulled = false;
  return mesh;
}

// soft rising wisps from the three stacks (one draw call)
export function createWisps(n = 60) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { const st = STACKS[i % 3]; pos.set([st[0], heightAt(st[0], st[1]) + 137, st[1]], i * 3); seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) }, uScale: { value: 800 }, uCol: { value: new THREE.Color(0.9, 0.9, 0.9) }, uAmt: { value: 0.3 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: `attribute float aSeed; uniform float uTime, uScale; uniform vec2 uWind; varying float vA;
      void main(){ float t = fract(uTime * 0.025 + aSeed); vec3 p = position + vec3(uWind.x, 0.0, uWind.y) * t * 160.0 + vec3(0.0, t * 70.0, 0.0);
        p.x += sin(aSeed * 40.0 + uTime * 0.3) * 6.0 * t; vA = smoothstep(0.0, 0.12, t) * (1.0 - t);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = (8.0 + t * 46.0) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uAmt; varying float vA;
      void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(uCol, vA * uAmt * smoothstep(0.5, 0.0, r)); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 3;
  return { points: pts, uniforms };
}

// two thin layers of drifting mist hugging the water and the beach
export function createMist(depthTex, bounds) {
  const uniforms = { uTime: { value: 0 }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(1, 1, 1) }, uDepth: { value: depthTex },
    uBounds: { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${GLSL_NOISE}
      uniform float uTime, uAmt; uniform vec3 uCol; uniform sampler2D uDepth; uniform vec4 uBounds; varying vec3 vW;
      void main(){
        vec2 uv = (vW.xz - uBounds.xy) / uBounds.zw;
        float d = texture2D(uDepth, uv).r * 14.0;
        float overWater = smoothstep(0.0, 1.5, d) + 0.35;
        vec2 p = vW.xz * 0.012 + vec2(uTime * 0.006, uTime * 0.002);
        float n = cgN2(p) * 0.6 + cgN2(p * 2.7 + 3.0) * 0.3 + cgN2(p * 7.0) * 0.1;
        float dist = length(cameraPosition - vW);
        float a = smoothstep(0.35, 0.8, n) * overWater * smoothstep(12.0, 90.0, dist) * (1.0 - smoothstep(900.0, 1600.0, dist));
        vec3 vd = normalize(vW - cameraPosition); a *= smoothstep(0.02, 0.12, abs(vd.y));   // no hard line when seen edge-on
        gl_FragColor = vec4(uCol, clamp(a * uAmt, 0.0, 0.75));
      }`,
  });
  const g = new THREE.Group();
  for (const [y, s] of [[1.6, 1], [5.5, 0.6]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), mat); m.position.set(0, y, -100); m.renderOrder = 4; m.scale.setScalar(s + 0.4); g.add(m); }
  g.visible = false;
  return { group: g, uniforms };
}
