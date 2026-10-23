// Landmarks and course furniture: Morro Rock, the three stacks, flag + cup, tee markers, ball, gulls.
import * as THREE from 'three';
import { ROCK, STACKS, CUP, TEE, heightAt, fbm } from './course.js';

export function createRock() {
  const geo = new THREE.IcosahedronGeometry(1, 5);
  const p = geo.attributes.position, colors = [];
  const top = new THREE.Color('#a39a8c'), mid = new THREE.Color('#7d746a'), dark = new THREE.Color('#4a433d'), moss = new THREE.Color('#66704a'), guano = new THREE.Color('#d8d2c4');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ang = Math.atan2(z, x);
    const n = fbm(x * 2.6 + 5, z * 2.6 + y * 2) - 0.5, n2 = fbm(x * 8, z * 8 + y * 5) - 0.5;
    const yy = Math.max(y, -0.15);
    const prof = Math.pow(Math.max(yy + 0.15, 0) / 1.15, 0.62);
    // vertical gullies + a few horizontal ledges
    const gully = Math.abs(Math.sin(ang * 9 + n * 5)) ;
    const ledge = Math.sin(prof * 22 + n * 4) * 0.5 + 0.5;
    const r = 1 + n * 0.3 + n2 * 0.07 - (1 - gully) * 0.05 * (0.4 + prof) + ledge * 0.015;
    let px = x * r * ROCK.rx * (1 - prof * 0.42) - prof * 22, pz = z * r * ROCK.rz * (1 - prof * 0.34);
    let py = (prof * ROCK.h * (1 + n * 0.12) + n2 * 5) * (yy > -0.14 ? 1 : 0) - 6;
    if (x > 0.25 && yy < 0.45) py *= 0.78 + 0.1 * n;                 // eastern shoulder (the old quarry side)
    p.setXYZ(i, px, py, pz);
    const t = Math.min(1, Math.max(0, py / ROCK.h));
    const c = dark.clone().lerp(mid, Math.min(1, 0.25 + t * 2.2)).lerp(top, Math.max(0, t - 0.35) * 1.2);
    c.lerp(dark, (1 - gully) * 0.45);
    if (t < 0.3 && n > -0.02) c.lerp(moss, 0.5 * (1 - t / 0.3));
    if (t > 0.7 && n2 > 0.12) c.lerp(guano, 0.45);
    c.multiplyScalar(0.92 + n2 * 0.45);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const g2 = geo.index ? geo.toNonIndexed() : geo; g2.computeVertexNormals();
  const m = new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  m.position.set(ROCK.x, 0, ROCK.z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

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
  const g = new THREE.Group(); const y = heightAt(CUP.x, CUP.z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.4, 8), new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }));
  pole.position.y = 1.2; pole.castShadow = true; g.add(pole);
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
  const flag = new THREE.Mesh(fgeo, fmat); flag.position.y = 2.08; flag.castShadow = true; g.add(flag);
  const cup = new THREE.Mesh(new THREE.CircleGeometry(0.108, 24), new THREE.MeshBasicMaterial({ color: 0x0a0c12 }));
  cup.rotation.x = -Math.PI / 2; cup.position.y = 0.025; g.add(cup);
  const lip = new THREE.Mesh(new THREE.RingGeometry(0.108, 0.125, 24), new THREE.MeshBasicMaterial({ color: 0xf2f6f6 }));
  lip.rotation.x = -Math.PI / 2; lip.position.y = 0.024; g.add(lip);
  g.position.set(CUP.x, y, CUP.z);
  return { group: g, flag, uniforms };
}
export function createTeeMarkers() {
  const g = new THREE.Group();
  const m1 = new THREE.MeshLambertMaterial({ color: 0x2c6a8c }), m2 = new THREE.MeshLambertMaterial({ color: 0xb8e6e6 });
  for (const [dx, m] of [[-4.5, m1], [4.5, m2]]) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), m); s.position.set(TEE.x + dx, TEE.h + 0.1, TEE.z - 1.5); s.castShadow = true; g.add(s);
  }
  return g;
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
