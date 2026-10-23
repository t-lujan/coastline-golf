// Terrain mesh (flat-shaded low-poly) with per-pixel course painting from a baked distance map.
import * as THREE from 'three';
import { BOUNDS, heightAt, sandiness, fairwayDist, greenDist, bunkerDist, teeDist, GREEN, ROCK, fbm } from './course.js';

// course painting area (fine distance fields)
export const PAINT = { minX: -110, maxX: 110, minZ: -210, maxZ: 250 };

function bakePaint(res) {
  const w = res, hgt = Math.round(res * (PAINT.maxZ - PAINT.minZ) / (PAINT.maxX - PAINT.minX));
  const data = new Uint8Array(w * hgt * 4);
  const enc = (d) => Math.max(0, Math.min(255, Math.round(128 + d * 24)));   // ±5.3 m range
  for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
    const x = PAINT.minX + (i + 0.5) / w * (PAINT.maxX - PAINT.minX), z = PAINT.minZ + (j + 0.5) / hgt * (PAINT.maxZ - PAINT.minZ);
    const k = (j * w + i) * 4;
    data[k] = enc(fairwayDist(x, z) - 13); data[k + 1] = enc(greenDist(x, z)); data[k + 2] = enc(bunkerDist(x, z)); data[k + 3] = enc(teeDist(x, z));
  }
  const tex = new THREE.DataTexture(data, w, hgt, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

export function bakeDepth(res = 256) {
  const data = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = BOUNDS.minX + (i + 0.5) / res * (BOUNDS.maxX - BOUNDS.minX), z = BOUNDS.minZ + (j + 0.5) / res * (BOUNDS.maxZ - BOUNDS.minZ);
    let h = heightAt(x, z);
    const rr = Math.hypot((x - ROCK.x) / ROCK.rx, (z - ROCK.z) / ROCK.rz); if (rr < 1.02) h = Math.max(h, 2);
    const k = (j * res + i) * 4, v = Math.max(0, Math.min(255, Math.round(-h / 14 * 255)));
    data[k] = v; data[k + 1] = v; data[k + 2] = v; data[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

export function createTerrain({ segX, segZ, paintRes, bounds = BOUNDS, paint: paintIn, offset = 0 }) {
  const B = bounds, W = B.maxX - B.minX, D = B.maxZ - B.minZ;
  const geo = new THREE.PlaneGeometry(W, D, segX, segZ); geo.rotateX(-Math.PI / 2);
  geo.translate((B.minX + B.maxX) / 2, 0, (B.minZ + B.maxZ) / 2);
  const pos = geo.attributes.position, sand = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z)); sand[i] = sandiness(x, z);
  }
  geo.setAttribute('aSand', new THREE.BufferAttribute(sand, 1));
  geo.computeVertexNormals();
  const paint = paintIn || bakePaint(paintRes);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  if (offset) { mat.polygonOffset = true; mat.polygonOffsetFactor = -offset; mat.polygonOffsetUnits = -4 * offset; }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint = { value: paint };
    sh.uniforms.uPaintB = { value: new THREE.Vector4(PAINT.minX, PAINT.minZ, PAINT.maxX - PAINT.minX, PAINT.maxZ - PAINT.minZ) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSand; varying float vSand; varying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSand = aSand; vWP = (modelMatrix * vec4(position,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uPaint; uniform vec4 uPaintB; varying float vSand; varying vec3 vWP;
        float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }
        float edge(float d){ float w = fwidth(d) + 0.04; return 1.0 - smoothstep(-w, w, d); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vWP.xz; float hgt = vWP.y;
        float nz = tn(p * 0.08) * 0.6 + tn(p * 0.5) * 0.4;
        vec3 rough = mix(vec3(0.33, 0.44, 0.20), vec3(0.42, 0.52, 0.24), nz);
        vec3 golden = mix(vec3(0.62, 0.55, 0.30), vec3(0.70, 0.62, 0.36), nz);          // SLO hills in autumn
        vec3 col = mix(rough, golden, smoothstep(9.0, 26.0, hgt + nz * 6.0));
        vec3 sandC = mix(vec3(0.86, 0.78, 0.60), vec3(0.93, 0.86, 0.68), nz);
        vec3 wet = vec3(0.66, 0.58, 0.43), floorC = vec3(0.50, 0.46, 0.36);
        float s = smoothstep(0.35, 0.6, vSand + (nz - 0.5) * 0.25);
        vec3 sc = mix(sandC, wet, smoothstep(0.9, 0.2, hgt));
        sc = mix(sc, floorC, smoothstep(0.0, -1.5, hgt));
        col = mix(col, sc, s);
        vec2 uv = (p - uPaintB.xy) / uPaintB.zw;
        if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
          vec4 P = (texture2D(uPaint, uv) * 255.0 - 128.0) / 24.0;
          // fairway with mowing stripes
          float stripe = step(0.5, fract((p.x * 0.35 + p.y * 0.94) / 9.0));
          vec3 fw = mix(vec3(0.45, 0.66, 0.27), vec3(0.51, 0.72, 0.31), stripe);
          col = mix(col, mix(col, vec3(0.40, 0.56, 0.24), 0.6), edge(P.r - 2.2));   // first cut
          col = mix(col, fw, edge(P.r));
          // tee box
          col = mix(col, mix(vec3(0.47, 0.70, 0.30), vec3(0.52, 0.74, 0.33), step(0.5, fract(p.x / 2.0))), edge(P.a));
          // green, collar and checkerboard sheen
          float chk = step(0.5, fract(p.x / 3.0)) == step(0.5, fract(p.y / 3.0)) ? 1.0 : 0.0;
          col = mix(col, vec3(0.42, 0.64, 0.27), edge(P.g - 1.4));
          col = mix(col, mix(vec3(0.50, 0.75, 0.32), vec3(0.54, 0.79, 0.35), chk), edge(P.g));
          // bunkers with a dark lip
          col = mix(col, vec3(0.40, 0.36, 0.24), edge(P.b - 0.35));
          col = mix(col, mix(vec3(0.93, 0.87, 0.70), vec3(0.97, 0.92, 0.77), nz), edge(P.b));
        }
        diffuseColor.rgb *= col;`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
  return { mesh, paint };
}

// distant hills ring for the horizon (the "Nine Sisters" morros inland)
export function createHills() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const peaks = [[900, 160, 150, 260], [1180, -180, 210, 330], [1500, 330, 250, 380], [1050, 700, 170, 300], [760, 1000, 120, 240], [1750, -520, 300, 420], [1350, -820, 220, 340], [2100, 100, 380, 520]];
  const lo = new THREE.Color('#7f7a52'), hi = new THREE.Color('#a09163'), oak = new THREE.Color('#4f5a37');
  for (const [x, z, h, r] of peaks) {
    const geo = new THREE.IcosahedronGeometry(1, 3); const p = geo.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = Math.max(0, p.getY(i)), vz = p.getZ(i);
      const n = fbm(vx * 2 + x * 0.01, vz * 2 + z * 0.01);
      const prof = Math.pow(vy, 0.8);
      p.setXYZ(i, vx * r * (1 + (n - 0.5) * 0.35), prof * h * (0.8 + n * 0.4), vz * r * (1 + (n - 0.5) * 0.35));
      const c = lo.clone().lerp(hi, prof); if (fbm(vx * 6 + 3, vz * 6) > 0.55 && prof < 0.7) c.lerp(oak, 0.6);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, mat); m.position.set(x, -6, z); g.add(m);
  }
  return g;
}
