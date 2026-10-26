// Landmarks and course furniture: Morro Rock, the three stacks, flag + cup, tee markers, ball, gulls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GULLS, STACKS, CUP, TEE, PAR, HOLE_YD, MAP_ID, heightAt, fbm } from './course.js';
import { MAP } from './maps/index.js';

export function createStacks() {
  // the three power-plant stacks and the turbine hall, merged into one vertex-coloured, flat-shaded mesh (one draw call)
  const parts = [];
  const tint = (geo, hex) => { geo = geo.toNonIndexed(); const c = new THREE.Color(hex), n = geo.attributes.position.count; geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3)); geo.deleteAttribute('uv'); return geo; };
  for (const [x, z] of STACKS) {
    const h = 137, y0 = heightAt(x, z) - 1;
    parts.push(tint(new THREE.CylinderGeometry(3.4, 5.2, h, 10).translate(x, y0 + h / 2, z), 0xd9dcd8));
    parts.push(tint(new THREE.CylinderGeometry(3.5, 3.5, 6, 10).translate(x, y0 + h - 3, z), 0x7c8a8e));
  }
  parts.push(tint(new THREE.BoxGeometry(90, 26, 40).translate(352, heightAt(352, -400) + 12, -400), 0xbfc3bd));
  return new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

function flagTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160; const x = c.getContext('2d');
  x.fillStyle = '#B8E6E6'; x.fillRect(0, 0, 256, 160);
  x.fillStyle = '#28283F'; x.font = '700 110px "Schibsted Grotesk", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('1', 128, 86);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function createFlag() {
  // the pin (pole + flag) is its own group so it can be pulled on a hole-out while the cup stays put
  const g = new THREE.Group(), pin = new THREE.Group(); const y = heightAt(CUP.x, CUP.z); g.add(pin);
  // uLie: 1 once the pin is laid on the green (the cloth stops flapping); the pin is fogged less than the scene so
  // it still reads from the tee in a marine layer
  const uniforms = { uTime: { value: 0 }, uWind: { value: 0.5 }, uLie: { value: 0 } };
  const lessFog = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', THREE.ShaderChunk.fog_fragment.replace('vFogDepth * vFogDepth', 'vFogDepth * vFogDepth * 0.3')); };
  const pmat = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }); pmat.onBeforeCompile = lessFog;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8), pmat);
  pole.position.y = 1.2; pole.castShadow = true; pin.add(pole);
  const fgeo = new THREE.PlaneGeometry(0.95, 0.6, 12, 6); fgeo.translate(0.475, 0, 0);
  // a faint self-light keeps the cloth's colour and its number legible in a marine layer and by moonlight
  const ftex = flagTexture(), fmat = new THREE.MeshLambertMaterial({ map: ftex, emissiveMap: ftex, emissive: 0x3a4646, side: THREE.DoubleSide });
  fmat.onBeforeCompile = (sh) => {
    lessFog(sh);
    sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uWind = uniforms.uWind; sh.uniforms.uLie = uniforms.uLie;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uWind, uLie;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float k = position.x / 0.95 * (1.0 - uLie * 0.85);
        transformed.z += sin(position.x * 6.0 - uTime * (4.0 + uWind * 6.0)) * 0.08 * k * (0.4 + uWind);
        transformed.y += sin(position.x * 4.0 - uTime * 5.0) * 0.02 * k;`);
  };
  const flag = new THREE.Mesh(fgeo, fmat); flag.position.y = 2.08; flag.castShadow = true; pin.add(flag);
  // cup and its white liner lip: one vertex-coloured mesh, one draw call
  const tint = (geo, c) => { geo = geo.toNonIndexed(); geo.deleteAttribute('uv'); geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: geo.attributes.position.count * 3 }, (_, i) => c[i % 3]), 3)); return geo; };
  const cupGeo = mergeGeometries([tint(new THREE.CircleGeometry(0.108, 24), [0.004, 0.005, 0.008]), tint(new THREE.RingGeometry(0.108, 0.125, 24), [0.89, 0.92, 0.92])]);
  cupGeo.rotateX(-Math.PI / 2); cupGeo.translate(0, 0.025, 0);
  g.add(new THREE.Mesh(cupGeo, new THREE.MeshLambertMaterial({ vertexColors: true })));
  g.position.set(CUP.x, y, CUP.z);
  return { group: g, pin, pole, flag, uniforms };
}
export function createTeeMarkers() {
  // classic mushroom tee markers in the palette, a tee sign, and a ball washer post
  const g = new THREE.Group();
  // both markers (stem + cap) merged into one mesh: one draw call, one shadow call
  const parts = [];
  for (const dx of [-4.2, 4.2]) {
    parts.push(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6).translate(TEE.x + dx, TEE.h + 0.06, TEE.z - 1.5), new THREE.SphereGeometry(0.1, 18, 12).translate(TEE.x + dx, TEE.h + 0.1, TEE.z - 1.5));
  }
  const markers = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), new THREE.MeshLambertMaterial({ color: 0x4f9fc4 }));
  markers.castShadow = true; g.add(markers);
  // tee sign: posts and board are one mesh with one texture (the wood is a strip at the bottom of the sign canvas),
  // so it costs one draw and one shadow draw instead of eight
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 288; const x = cv.getContext('2d');
  x.fillStyle = '#28283F'; x.fillRect(0, 0, 512, 256); x.strokeStyle = '#B8E6E6'; x.lineWidth = 10; x.strokeRect(14, 14, 484, 228);
  x.fillStyle = '#B8E6E6'; x.font = '800 132px system-ui, sans-serif'; x.textBaseline = 'middle'; x.fillText('1', 44, 132);
  x.fillStyle = '#ffffff'; x.font = '700 54px system-ui, sans-serif'; x.fillText(MAP_ID === 'morro' ? 'Morro Rock' : MAP.name, 150, 100);
  x.fillStyle = '#E1F5F3'; x.font = '500 40px system-ui, sans-serif'; x.fillText(MAP_ID === 'morro' ? 'Par 4 · 380 yd' : `Par ${PAR} · ${HOLE_YD} yd`, 152, 170);
  x.fillStyle = '#5a4030'; x.fillRect(0, 260, 512, 28);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const wood = (geo) => { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 14 / 288); return geo; };
  const board = new THREE.BoxGeometry(1.1, 0.55, 0.05), buv = board.attributes.uv;
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z (4 vertices each); only the front (+z) face shows the sign
  for (let i = 0; i < buv.count; i++) { if (i >= 16 && i < 20) buv.setY(i, 1 - (1 - buv.getY(i)) * 256 / 288); else buv.setXY(i, 0.5, 14 / 288); }
  const sx = TEE.x - 8.6, sz = TEE.z + 3.2, sy = heightAt(sx, sz);
  const signGeo = mergeGeometries([wood(new THREE.BoxGeometry(0.09, 1.1, 0.09).translate(-0.42, 0.55, -0.05)), wood(new THREE.BoxGeometry(0.09, 1.1, 0.09).translate(0.42, 0.55, -0.05)), board.translate(0, 0.95, 0)].map((g) => { g.clearGroups(); return g.toNonIndexed(); }));
  const sign = new THREE.Mesh(signGeo, new THREE.MeshLambertMaterial({ map: tex }));
  sign.position.set(sx, sy, sz + 0.05); sign.rotation.y = 0.5; sign.castShadow = true;
  g.add(sign);
  return g;
}
export function createTeePeg() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.35, 2.6, 10), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  m.geometry.translate(0, -1.3, 0); m.castShadow = true; return m;
}
export function createBall() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0x334044, emissiveIntensity: 0.25 }));
  m.castShadow = true; return m;
}
export function createGulls(n) {
  // one instanced draw for the whole flock
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0.25, 0, 0, 0, 0.25, 0, 0, -0.2, 0, 0, 0.25, 1, 0.25, 0, 0, 0, -0.2], 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, n); mesh.frustumCulled = false;
  const birds = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    birds.push({ s: 0.9 + Math.random() * 0.5, r: 60 + Math.random() * 90, h: 40 + Math.random() * 70, sp: (0.08 + Math.random() * 0.08) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * 6.3, cx: GULLS.x + (Math.random() - 0.5) * 60, cz: GULLS.z + 40 });
  }
  mesh.userData.update = (t) => {
    birds.forEach((u, i) => {
      const a = u.ph + t * u.sp;
      p.set(u.cx + Math.cos(a) * u.r, u.h + Math.sin(t * 0.7 + u.ph) * 6, u.cz + Math.sin(a) * u.r);
      q.setFromEuler(e.set(0, -a + (u.sp > 0 ? 0 : Math.PI), Math.sin(t * 6 + u.ph) * 0.35));
      s.set(u.s, u.s * (0.6 + 0.4 * Math.abs(Math.sin(t * 5 + u.ph))), u.s);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  mesh.userData.update(0);
  return mesh;
}
