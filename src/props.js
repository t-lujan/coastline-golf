// Landmarks and course furniture: Morro Rock, the three stacks, flag + cup, tee markers, ball, gulls.
import * as THREE from 'three';
import { ROCK, STACKS, CUP, TEE, heightAt, fbm } from './course.js';

export function createStacks() {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xd9dcd8, flatShading: true });
  const band = new THREE.MeshLambertMaterial({ color: 0x7c8a8e });
  for (const [x, z] of STACKS) {
    const h = 137, y0 = heightAt(x, z) - 1;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 5.2, h, 10), white); s.position.set(x, y0 + h / 2, z);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 6, 10), band); b.position.set(x, y0 + h - 3, z);
    g.add(s, b);
  }
  const hall = new THREE.Mesh(new THREE.BoxGeometry(90, 26, 40), new THREE.MeshLambertMaterial({ color: 0xbfc3bd, flatShading: true }));
  hall.position.set(352, heightAt(352, -400) + 12, -400); g.add(hall);
  return g;
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
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8), new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }));
  pole.position.y = 1.2; pole.castShadow = true; pin.add(pole);
  const fgeo = new THREE.PlaneGeometry(0.95, 0.6, 12, 6); fgeo.translate(0.475, 0, 0);
  const uniforms = { uTime: { value: 0 }, uWind: { value: 0.5 } };
  const fmat = new THREE.MeshLambertMaterial({ map: flagTexture(), side: THREE.DoubleSide });
  fmat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uWind = uniforms.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime, uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float k = position.x / 0.95;
        transformed.z += sin(position.x * 6.0 - uTime * (4.0 + uWind * 6.0)) * 0.08 * k * (0.4 + uWind);
        transformed.y += sin(position.x * 4.0 - uTime * 5.0) * 0.02 * k;`);
  };
  const flag = new THREE.Mesh(fgeo, fmat); flag.position.y = 2.08; flag.castShadow = true; pin.add(flag);
  const cup = new THREE.Mesh(new THREE.CircleGeometry(0.108, 24), new THREE.MeshBasicMaterial({ color: 0x0a0c12 }));
  cup.rotation.x = -Math.PI / 2; cup.position.y = 0.025; g.add(cup);
  const lip = new THREE.Mesh(new THREE.RingGeometry(0.108, 0.125, 24), new THREE.MeshLambertMaterial({ color: 0xf2f6f6 }));
  lip.rotation.x = -Math.PI / 2; lip.position.y = 0.024; g.add(lip);
  g.position.set(CUP.x, y, CUP.z);
  return { group: g, pin, flag, uniforms };
}
export function createTeeMarkers() {
  // classic mushroom tee markers in the palette, a tee sign, and a ball washer post
  const g = new THREE.Group();
  const mats = [new THREE.MeshLambertMaterial({ color: 0x1d4f8c }), new THREE.MeshLambertMaterial({ color: 0x1d4f8c })];
  const stem = new THREE.CylinderGeometry(0.02, 0.02, 0.04, 6), cap = new THREE.SphereGeometry(0.1, 18, 12);
  [[-4.2, 0], [4.2, 1]].forEach(([dx, mi]) => {
    const y = TEE.h; const s = new THREE.Mesh(stem, mats[mi]); s.position.set(TEE.x + dx, y + 0.06, TEE.z - 1.5);
    const c = new THREE.Mesh(cap, mats[mi]); c.position.set(TEE.x + dx, y + 0.1, TEE.z - 1.5);
    s.castShadow = c.castShadow = true; g.add(s, c);
  });
  // tee sign
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256; const x = cv.getContext('2d');
  x.fillStyle = '#28283F'; x.fillRect(0, 0, 512, 256); x.strokeStyle = '#B8E6E6'; x.lineWidth = 10; x.strokeRect(14, 14, 484, 228);
  x.fillStyle = '#B8E6E6'; x.font = '800 132px system-ui, sans-serif'; x.textBaseline = 'middle'; x.fillText('1', 44, 132);
  x.fillStyle = '#ffffff'; x.font = '700 54px system-ui, sans-serif'; x.fillText('Morro Rock', 150, 100);
  x.fillStyle = '#E1F5F3'; x.font = '500 40px system-ui, sans-serif'; x.fillText('Par 4 · 380 yd', 152, 170);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const wood = new THREE.MeshLambertMaterial({ color: 0x5a4030 });
  const sx = TEE.x - 8.6, sz = TEE.z + 3.2, sy = heightAt(sx, sz);
  const post1 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.1, 0.09), wood); post1.position.set(sx - 0.42, sy + 0.55, sz);
  const post2 = post1.clone(); post2.position.x = sx + 0.42;
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.05), [wood, wood, wood, wood, new THREE.MeshLambertMaterial({ map: tex }), wood]);
  board.position.set(sx, sy + 0.95, sz + 0.05);
  const sign = new THREE.Group(); sign.add(post1, post2, board); sign.rotation.y = 0.5; sign.traverse((o) => { o.castShadow = true; });
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0.25, 0, 0, 0, 0.25, 0, 0, -0.2, 0, 0, 0.25, 1, 0.25, 0, 0, 0, -0.2], 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide });
  const g = new THREE.Group(); const birds = [];
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(geo, mat); b.scale.setScalar(0.9 + Math.random() * 0.5);
    b.userData = { r: 60 + Math.random() * 90, h: 40 + Math.random() * 70, sp: (0.08 + Math.random() * 0.08) * (Math.random() < 0.5 ? 1 : -1), ph: Math.random() * 6.3, cx: ROCK.x + (Math.random() - 0.5) * 60, cz: ROCK.z + 40 };
    g.add(b); birds.push(b);
  }
  g.userData.update = (t) => {
    for (const b of birds) {
      const u = b.userData, a = u.ph + t * u.sp;
      b.position.set(u.cx + Math.cos(a) * u.r, u.h + Math.sin(t * 0.7 + u.ph) * 6, u.cz + Math.sin(a) * u.r);
      b.rotation.set(0, -a + (u.sp > 0 ? 0 : Math.PI), Math.sin(t * 6 + u.ph) * 0.35);
      b.scale.y = 0.6 + 0.4 * Math.abs(Math.sin(t * 5 + u.ph));
    }
  };
  return g;
}
