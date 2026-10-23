// Terrain mesh (flat-shaded low-poly) with per-pixel course painting from a baked distance map.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from './noise.js';
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

// baked ambient occlusion from the height field: hollows and the feet of slopes get darker
function bakeAO(x, z, h) {
  let occ = 0;
  for (const [r, w] of [[2.5, 0.5], [7, 0.35], [18, 0.15]]) {
    let sum = 0;
    for (let k = 0; k < 6; k++) { const a = k * 1.047 + r; sum += Math.max(0, heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) - h) / r; }
    occ += w * sum / 6;
  }
  return Math.max(0.45, 1 - occ * 2.6);
}

export function createTerrain({ segX, segZ, paintRes, bounds = BOUNDS, paint: paintIn, offset = 0, ao = true }) {
  const B = bounds, W = B.maxX - B.minX, D = B.maxZ - B.minZ;
  const geo = new THREE.PlaneGeometry(W, D, segX, segZ); geo.rotateX(-Math.PI / 2);
  geo.translate((B.minX + B.maxX) / 2, 0, (B.minZ + B.maxZ) / 2);
  const pos = geo.attributes.position, sand = new Float32Array(pos.count), aoA = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z);
    pos.setY(i, h); sand[i] = sandiness(x, z); aoA[i] = ao ? bakeAO(x, z, h) : 1;
  }
  geo.setAttribute('aSand', new THREE.BufferAttribute(sand, 1));
  geo.setAttribute('aAO', new THREE.BufferAttribute(aoA, 1));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const paint = paintIn || bakePaint(paintRes);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  if (offset) { mat.polygonOffset = true; mat.polygonOffsetFactor = -offset; mat.polygonOffsetUnits = -4 * offset; }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint = { value: paint };
    sh.uniforms.uPaintB = { value: new THREE.Vector4(PAINT.minX, PAINT.minZ, PAINT.maxX - PAINT.minX, PAINT.maxZ - PAINT.minZ) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSand; attribute float aAO; varying float vSand; varying float vAO; varying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSand = aSand; vAO = aAO; vWP = (modelMatrix * vec4(position,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GLSL_NOISE}
        uniform sampler2D uPaint; uniform vec4 uPaintB; varying float vSand; varying float vAO; varying vec3 vWP;
        float edgeS(float d, float soft){ float w = fwidth(d) + soft; return 1.0 - smoothstep(-w, w, d); }
        float gTurf; float gSandK;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vWP.xz; float hgt = vWP.y;
        float nB = cgN2(p * 0.018), nM = cgN2(p * 0.11), nF = cgN2(p * 0.9), nG = cgN2(p * 3.1);
        float nz = nM * 0.6 + nF * 0.4;
        // rough: deep coastal green with patches of dry golden grass
        vec3 rough = mix(vec3(0.085, 0.17, 0.035), vec3(0.15, 0.24, 0.055), nz);
        rough = mix(rough, vec3(0.30, 0.25, 0.09), smoothstep(0.55, 0.8, nB + nF * 0.2) * 0.55);
        vec3 hills = mix(vec3(0.34, 0.27, 0.10), vec3(0.45, 0.36, 0.15), nz);
        vec3 col = mix(rough, hills, smoothstep(10.0, 30.0, hgt + nz * 8.0));
        // beach sand: warm, darker and wet near the water, sea floor below
        vec3 sandC = mix(vec3(0.62, 0.48, 0.30), vec3(0.74, 0.60, 0.40), nz) * (0.92 + nG * 0.12);
        vec3 wet = vec3(0.33, 0.26, 0.17), floorC = vec3(0.30, 0.27, 0.19);
        float s = smoothstep(0.32, 0.62, vSand + (nz - 0.5) * 0.35);
        vec3 sc = mix(sandC, wet, smoothstep(0.9, 0.15, hgt));
        sc = mix(sc, floorC, smoothstep(0.0, -1.2, hgt));
        // dune grass fringe where sand meets turf
        vec3 duneGrass = mix(vec3(0.24, 0.26, 0.09), vec3(0.36, 0.33, 0.14), nF);
        col = mix(col, duneGrass, smoothstep(0.2, 0.42, vSand) * (1.0 - s));
        col = mix(col, sc, s);
        gTurf = 0.0; gSandK = s;
        vec2 uv = (p - uPaintB.xy) / uPaintB.zw;
        if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
          vec4 P = (texture2D(uPaint, uv) * 255.0 - 128.0) / 24.0;
          float wob = (nF - 0.5) * 0.5;
          // first cut, then fairway with crisp diagonal mowing stripes
          float stripe = smoothstep(0.46, 0.54, abs(fract((p.x * 0.35 + p.y * 0.94) / 10.0) - 0.5) * 2.0);
          vec3 fw = mix(vec3(0.13, 0.33, 0.045), vec3(0.20, 0.43, 0.075), stripe) * (0.94 + nF * 0.1);
          float cut = edgeS(P.r - 2.4 + wob, 0.5);
          col = mix(col, vec3(0.10, 0.25, 0.04) * (0.9 + nF * 0.2), cut);
          float fwk = edgeS(P.r + wob * 0.3, 0.25);
          col = mix(col, fw, fwk);
          // tee box
          float tk = edgeS(P.a, 0.12);
          col = mix(col, mix(vec3(0.15, 0.38, 0.06), vec3(0.21, 0.46, 0.09), step(0.5, fract(p.x / 1.5))), tk);
          // green: collar, then a fine checkerboard sheen
          float chk = abs(step(0.5, fract(p.x / 2.5)) - step(0.5, fract(p.y / 2.5)));
          col = mix(col, vec3(0.12, 0.33, 0.05), edgeS(P.g - 1.5, 0.2));
          col = mix(col, mix(vec3(0.15, 0.39, 0.075), vec3(0.17, 0.42, 0.085), chk) * (0.94 + nF * 0.12), edgeS(P.g, 0.06));
          // bunkers: a dark grassy lip, bright raked sand
          col = mix(col, vec3(0.06, 0.12, 0.03), edgeS(P.b - 0.45, 0.12));
          float bk = edgeS(P.b, 0.06);
          col = mix(col, mix(vec3(0.80, 0.68, 0.48), vec3(0.88, 0.77, 0.56), nF) * (0.95 + 0.05 * sin(p.x * 6.0 + p.y * 2.0)), bk);
          gTurf = max(fwk, max(tk, edgeS(P.g, 0.06))); gSandK = max(gSandK, bk);
        }
        col *= mix(1.0, vAO, 0.85);
        diffuseColor.rgb *= col;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float bmp = (cgN2(vWP.xz * 1.6) * 0.6 + cgN2(vWP.xz * 5.0) * 0.4) * (1.0 - gTurf * 0.85) + gSandK * cgN2(vec2(vWP.x * 2.0, vWP.z * 9.0)) * 0.5;
        normal = cgBump(normal, -vViewPosition, bmp, 0.12);`);
  };
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
  return { mesh, paint };
}

// distant hills ring for the horizon (the "Nine Sisters" morros inland)
export function createHills() {
  // the "Nine Sisters" morros and the Santa Lucia foothills inland: smooth, golden, oak-dotted, one draw call
  const peaks = [[900, 160, 150, 260], [1180, -180, 210, 330], [1500, 330, 250, 380], [1050, 700, 170, 300], [760, 1000, 120, 240], [1750, -520, 300, 420], [1350, -820, 220, 340], [2100, 100, 380, 520], [2300, -900, 420, 700]];
  const lo = new THREE.Color('#5d5a35'), hi = new THREE.Color('#8f7b45'), oak = new THREE.Color('#2f3a1e');
  const geos = [];
  for (const [x, z, h, r] of peaks) {
    let geo = new THREE.IcosahedronGeometry(1, 4); geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo = mergeVertices(geo);
    const p = geo.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = Math.max(0, p.getY(i)), vz = p.getZ(i);
      const n = fbm(vx * 2 + x * 0.01, vz * 2 + z * 0.01);
      const prof = Math.pow(vy, 0.8);
      p.setXYZ(i, x + vx * r * (1 + (n - 0.5) * 0.35), prof * h * (0.8 + n * 0.4) - 6, z + vz * r * (1 + (n - 0.5) * 0.35));
      const c = lo.clone().lerp(hi, prof * 0.8 + n * 0.3); if (fbm(vx * 7 + 3, vz * 7 + x) > 0.56 && prof < 0.75) c.lerp(oak, 0.7);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geos.push(geo);
  }
  const g = mergeGeometries(geos); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}
