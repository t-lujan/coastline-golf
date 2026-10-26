// Terrain mesh (flat-shaded low-poly) with per-pixel course painting from a baked distance map.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE } from './noise.js';
import { BOUNDS, PAINT, WATER_LEVEL, heightAt, sandiness, fairwayDist, greenDist, bunkerDist, teeDist, ROCK, fbm } from './course.js';

// PAINT (course painting area for the fine distance fields) comes from the active map


// fairway and first cut (the coastal links: crisp edges and stripes)
const FAIRWAY_COAST = `float wob = (nF - 0.5) * 0.5;
          // first cut, then fairway with crisp diagonal mowing stripes
          float stripe = smoothstep(0.46, 0.54, abs(fract((p.x * 0.35 + p.y * 0.94) / 10.0) - 0.5) * 2.0);
          vec3 fw = mix(vec3(0.13, 0.33, 0.045), vec3(0.20, 0.43, 0.075), stripe) * (0.94 + nF * 0.1);
          float cut = edgeS(P.r - 2.4 + wob, 0.5);
          col = mix(col, vec3(0.10, 0.25, 0.04) * (0.9 + nF * 0.2), cut);
          float fwk = edgeS(P.r + wob * 0.3, 0.25);
          col = mix(col, fw, fwk);`;
// ground colours under the course paint: the coastal links (Morro Rock) and the dry inland valley (Bishop Peak)
const PALETTES = {
  coast: { ground: `vec3 rough = mix(vec3(0.085, 0.17, 0.035), vec3(0.15, 0.24, 0.055), nz);
        rough = mix(rough, vec3(0.30, 0.25, 0.09), smoothstep(0.55, 0.8, nB + nF * 0.2) * 0.55);
        vec3 hills = mix(vec3(0.34, 0.27, 0.10), vec3(0.45, 0.36, 0.15), nz);
        vec3 col = mix(rough, hills, smoothstep(10.0, 30.0, hgt + nz * 8.0));` },
  // dry golden grass (straw and tan, greener in the swales), olive chaparral on the steep banks; height-agnostic, the
  // valley floor tilts. The fairway fades out through a first cut and a band of semi-rough instead of a hard edge.
  pismo: { sand: PISMO_SAND, ground: `vec3 rough = mix(vec3(0.085, 0.17, 0.035), vec3(0.15, 0.24, 0.055), nz);
        rough = mix(rough, vec3(0.30, 0.25, 0.09), smoothstep(0.55, 0.8, nB + nF * 0.2) * 0.55);
        vec3 col = rough;` },
  inland: { ground: `vec3 rough = mix(vec3(0.47, 0.36, 0.19), vec3(0.61, 0.48, 0.28), nz) * (0.86 + nG * 0.2) * (0.9 + 0.2 * cgN2(vec2(p.x * 1.7, p.y * 5.3) + nF));
        rough = mix(rough, vec3(0.28, 0.3, 0.13), smoothstep(0.58, 0.85, nB + nF * 0.25) * 0.4);
        vec3 col = rough;
        vec3 sn = normalize(cross(dFdx(vWP), dFdy(vWP)));
        col = mix(col, vec3(0.21, 0.24, 0.12) * (0.8 + nF * 0.4), smoothstep(0.3, 0.6, 1.0 - abs(sn.y)) * 0.65);`,
    // the same, starting from the backdrop's land colour (vBase) so the hole and the hills share one ground
    groundBase: `vec3 col = vBase * (0.86 + nG * 0.2) * (0.9 + 0.2 * cgN2(vec2(p.x * 1.7, p.y * 5.3) + nF)) * (0.88 + 0.24 * nz);
        vec3 sn = normalize(cross(dFdx(vWP), dFdy(vWP)));
        // field texture on the green-gold farmland: faint drill rows and stubble strips, gone on slopes and with distance
        float fieldK = smoothstep(0.0, 0.06, vBase.g - vBase.r) * smoothstep(0.96, 0.99, sn.y) * (1.0 - smoothstep(60.0, 260.0, length(cameraPosition - vWP)));
        float rows = abs(fract(dot(p, vec2(0.94, 0.34)) / 2.6) - 0.5) * 2.0, strip = smoothstep(0.35, 0.65, cgN2(vec2(dot(p, vec2(0.34, -0.94)) * 0.02, 0.5)));
        col *= 1.0 + fieldK * ((smoothstep(0.55, 0.9, rows) - 0.5) * 0.12 + (strip - 0.5) * 0.14);
        col = mix(col, vec3(0.21, 0.24, 0.12) * (0.8 + nF * 0.4), smoothstep(0.3, 0.6, 1.0 - abs(sn.y)) * 0.5);`,
    fairway: `float wob = (nF - 0.5) * 0.35 + (nM - 0.5) * 0.7;
          // the mowed edge fades through a first cut and a few metres of intermediate rough where the green turf thins
          // out into the straw grass: wide, overlapping falloffs, no pasted-on line (P.r saturates at 5.3 m)
          float e = P.r + wob * 0.3;
          float semi = (1.0 - smoothstep(1.6, 5.0, e)) * 0.9;
          col = mix(col, mix(vec3(0.24, 0.29, 0.1), vec3(0.38, 0.37, 0.19), nF * 0.7 + nG * 0.3), semi);
          float cut = 1.0 - smoothstep(0.0, 3.0, e);
          col = mix(col, vec3(0.14, 0.26, 0.06) * (0.9 + nF * 0.2), cut);
          float stripe = smoothstep(0.3, 0.7, abs(fract((p.x * 0.35 + p.y * 0.94) / 11.0) - 0.5) * 2.0);
          vec3 fw = mix(vec3(0.13, 0.28, 0.055), vec3(0.165, 0.33, 0.07), stripe) * (0.94 + nF * 0.1);
          float fwk = 1.0 - smoothstep(-0.9, 0.9, e);
          col = mix(col, fw, fwk);` },
};

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

export function bakeDepth(res = 256, hasRock = true) {
  // R: water depth (0..14 m). G: land height (0..32 m), box-blurred over ~15 m so the mist can fade out softly
  // wherever the ground (or the rock) rises toward it instead of cutting a hard line through the terrain.
  const data = new Uint8Array(res * res * 4), land = new Float32Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = BOUNDS.minX + (i + 0.5) / res * (BOUNDS.maxX - BOUNDS.minX), z = BOUNDS.minZ + (j + 0.5) / res * (BOUNDS.maxZ - BOUNDS.minZ);
    let h = heightAt(x, z) - WATER_LEVEL;
    const rr = hasRock ? Math.hypot((x - ROCK.x) / ROCK.rx, (z - ROCK.z) / ROCK.rz) : 9; if (rr < 1.2) h = Math.max(h, 2);
    const k = (j * res + i) * 4, v = Math.max(0, Math.min(255, Math.round(-h / 14 * 255)));
    data[k] = v; data[k + 2] = v; data[k + 3] = 255;
    land[j * res + i] = rr < 1.36 ? 32 : Math.max(0, h);   // the rock's waterline bulge and boulders reach past its ellipse
  }
  const R = 6, tmp = new Float32Array(res * res);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass ? tmp : land, dst = pass ? land : tmp;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      let sum = 0, n = 0;
      for (let o = -R; o <= R; o++) { const ii = pass ? i : Math.min(res - 1, Math.max(0, i + o)), jj = pass ? Math.min(res - 1, Math.max(0, j + o)) : j; sum += src[jj * res + ii]; n++; }
      dst[j * res + i] = sum / n;
    }
  }
  for (let q = 0; q < res * res; q++) data[q * 4 + 1] = Math.min(255, Math.round(land[q] / 32 * 255));
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return tex;
}

// Pismo's beach (style 'pismo'): pale buff/cream dry sand with wind ripples and tone drift on the dunes, a darker glossy
// wet band over the ~30 m swash face (h 0..~1.4 m), a thin bright foam line at the waterline and an animated swash edge
// that runs up and down the wet sand. The same band thresholds drive pismoSandTransect() for the tests.
export const TERRAIN_TIME = { value: 0 };
const PS = { dry: [0.80, 0.72, 0.56], dry2: [0.88, 0.81, 0.65], wet: [0.40, 0.34, 0.25], foam: [0.90, 0.91, 0.88], wetTop: 1.42, foamH: 0.1 };
const v3 = (c) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;
const PISMO_SAND = `vec3 sandC = mix(${v3(PS.dry)}, ${v3(PS.dry2)}, nz) * (0.93 + nG * 0.1);
        // dry sand: wind ripples (crests across the NW wind) and slow tone drift over the dunes
        float rip = sin(dot(p, vec2(0.42, 0.91)) * 4.2 + nM * 7.0 + nF * 1.5) * 0.5 + 0.5;
        sandC *= 0.95 + 0.08 * rip * smoothstep(1.6, 2.6, hgt);
        sandC = mix(sandC, sandC * vec3(0.93, 0.9, 0.85), smoothstep(0.45, 0.8, nB) * smoothstep(3.0, 6.0, hgt));
        // wet band over the swash face, darker the lower it lies, with a fresh swash film running up and down it
        float wetK = 1.0 - smoothstep(${PS.wetTop - 0.12}, ${PS.wetTop + 0.12}, hgt + (nM - 0.5) * 0.25);
        vec3 wetC = ${v3(PS.wet)} * (0.94 + nF * 0.1) * mix(1.12, 0.92, smoothstep(1.2, 0.2, hgt));
        float run = 0.32 + 0.26 * sin(uTime * 0.42 + p.y * 0.011 + nB * 4.0) + 0.12 * sin(uTime * 1.13 + p.y * 0.031);
        float film = smoothstep(run + 0.04, run - 0.04, hgt);
        wetC = mix(wetC, wetC * vec3(0.82, 0.86, 0.9), film);
        vec3 sc = mix(sandC, wetC, wetK);
        // the swash edge (a broken lacy foam line) and a thin bright foam line at the waterline
        float edge = smoothstep(0.07, 0.0, abs(hgt - run)) * smoothstep(0.35, 0.6, nF + cgN2(p * 0.7 + uTime * 0.2) * 0.4);
        float lineK = smoothstep(${PS.foamH * 1.6}, ${PS.foamH * 0.4}, hgt) * smoothstep(-0.12, 0.0, hgt);
        sc = mix(sc, ${v3(PS.foam)} * (0.92 + nF * 0.08), max(edge * 0.85, lineK * 0.9));
        gWet = wetK * (1.0 - lineK);
        vec3 floorC = vec3(0.36, 0.32, 0.24);
        sc = mix(sc, floorC, smoothstep(-0.1, -1.2, hgt));`;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mixc = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
// static paint of the Pismo beach (no noise, no swash film) along a transect across the beach at z
export function pismoSandTransect(z = -120, shoreX = null) {
  const out = [];
  for (let d = -6; d <= 80; d += 2) {
    const x = (shoreX ? shoreX(z) : 0) - d, h = heightAt(x, z);
    const dry = mixc(PS.dry, PS.dry2, 0.5), wetK = 1 - ss(PS.wetTop - 0.12, PS.wetTop + 0.12, h);
    let c = mixc(dry, PS.wet.map((v) => v * (0.99 * (1.12 + (0.92 - 1.12) * ss(1.2, 0.2, h)))), wetK);
    const lineK = ss(PS.foamH * 1.6, PS.foamH * 0.4, h) * ss(-0.12, 0, h); c = mixc(c, PS.foam, lineK * 0.9);
    out.push({ d, h: +h.toFixed(2), lum: +lum(c).toFixed(3), band: lineK > 0.5 ? 'foam' : wetK > 0.5 ? 'wet' : 'dry' });
  }
  return out;
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

export function createTerrain({ segX, segZ, paintRes, bounds = BOUNDS, paint: paintIn, offset = 0, ao = true, warp = false, style = 'coast', baseColor = null }) {
  const PL = PALETTES[style];
  const B = bounds, W = B.maxX - B.minX, D = B.maxZ - B.minZ, cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2;
  const geo = new THREE.PlaneGeometry(W, D, segX, segZ); geo.rotateX(-Math.PI / 2);
  geo.translate(cx, 0, cz);
  const pos = geo.attributes.position, sand = new Float32Array(pos.count), aoA = new Float32Array(pos.count);
  // warp: pull the grid toward the middle (about twice as dense around the course and shore, sparser at the hazy edges)
  const wp = (v, c, half) => { const u = (v - c) / half; return c + half * (0.45 * u + 0.55 * u * u * u); };
  for (let i = 0; i < pos.count; i++) {
    if (warp) { pos.setX(i, wp(pos.getX(i), cx, W / 2)); pos.setZ(i, wp(pos.getZ(i), cz, D / 2)); }
    const x = pos.getX(i), z = pos.getZ(i), h = heightAt(x, z);
    pos.setY(i, h); sand[i] = sandiness(x, z); aoA[i] = ao ? bakeAO(x, z, h) : 1;
  }
  // a map can hand in the land colour its backdrop uses (vec3 per vertex), so the playable ground and the hills around it are one surface
  if (baseColor) { const c = new Float32Array(pos.count * 3), o = [0, 0, 0]; for (let i = 0; i < pos.count; i++) { baseColor(pos.getX(i), pos.getZ(i), o); c.set(o, i * 3); } geo.setAttribute('aBase', new THREE.BufferAttribute(c, 3)); }
  geo.setAttribute('aSand', new THREE.BufferAttribute(sand, 1));
  geo.setAttribute('aAO', new THREE.BufferAttribute(aoA, 1));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const paint = paintIn || bakePaint(paintRes);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  if (offset) { mat.polygonOffset = true; mat.polygonOffsetFactor = -offset; mat.polygonOffsetUnits = -4 * offset; }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint = { value: paint }; if (PL.sand) sh.uniforms.uTime = TERRAIN_TIME;
    sh.uniforms.uPaintB = { value: new THREE.Vector4(PAINT.minX, PAINT.minZ, PAINT.maxX - PAINT.minX, PAINT.maxZ - PAINT.minZ) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aSand; attribute float aAO; varying float vSand; varying float vAO; varying vec3 vWP;${baseColor ? '\nattribute vec3 aBase; varying vec3 vBase;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSand = aSand; vAO = aAO; vWP = (modelMatrix * vec4(position,1.0)).xyz;${baseColor ? ' vBase = aBase;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GLSL_NOISE}
        uniform sampler2D uPaint; uniform vec4 uPaintB; varying float vSand; varying float vAO; varying vec3 vWP;${baseColor ? ' varying vec3 vBase;' : ''}
        float edgeS(float d, float soft){ float w = fwidth(d) + soft; return 1.0 - smoothstep(-w, w, d); }
        float gTurf; float gSandK; float gWet = 0.0;${PL.sand ? '\n        uniform float uTime;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vWP.xz; float hgt = vWP.y;
        float nB = cgN2(p * 0.018), nM = cgN2(p * 0.11), nF = cgN2(p * 0.9), nG = cgN2(p * 3.1);
        float nz = nM * 0.6 + nF * 0.4;
        // rough: deep coastal green with patches of dry golden grass
        ${baseColor && PL.groundBase ? PL.groundBase : PL.ground}
        // beach sand: warm, darker and wet near the water, sea floor below
        ${PL.sand || `vec3 sandC = mix(vec3(0.62, 0.48, 0.30), vec3(0.74, 0.60, 0.40), nz) * (0.92 + nG * 0.12);
        vec3 wet = vec3(0.33, 0.26, 0.17), floorC = vec3(0.30, 0.27, 0.19);
        vec3 sc = mix(sandC, wet, smoothstep(0.9, 0.15, hgt));
        sc = mix(sc, floorC, smoothstep(0.0, -1.2, hgt));`}
        float s = smoothstep(0.32, 0.62, vSand + (nz - 0.5) * 0.35);
        // dune grass fringe where sand meets turf
        vec3 duneGrass = mix(vec3(0.24, 0.26, 0.09), vec3(0.36, 0.33, 0.14), nF);
        col = mix(col, duneGrass, smoothstep(0.2, 0.42, vSand) * (1.0 - s));
        col = mix(col, sc, s);
        gTurf = 0.0; gSandK = s;
        vec2 uv = (p - uPaintB.xy) / uPaintB.zw;
        if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) {
          vec4 P = (texture2D(uPaint, uv) * 255.0 - 128.0) / 24.0;
          ${PL.fairway || FAIRWAY_COAST}
          // tee box
          float tk = edgeS(P.a, 0.12);
          col = mix(col, mix(vec3(0.15, 0.38, 0.06), vec3(0.21, 0.46, 0.09), step(0.5, fract(p.x / 1.5))), tk);
          // green: collar, then a fine checkerboard sheen
          float chk = abs(step(0.5, fract(p.x / 2.5)) - step(0.5, fract(p.y / 2.5)));
          // close up (the hole-out shot) the turf needs grain: fine mottling on the green, a coarser, darker collar
          float grain = cgN2(p * 9.0) * 0.6 + cgN2(p * 23.0) * 0.4;
          col = mix(col, vec3(0.11, 0.30, 0.045) * (0.88 + grain * 0.24), edgeS(P.g - 1.5, 0.2));
          col = mix(col, mix(vec3(0.14, 0.37, 0.07), vec3(0.18, 0.44, 0.09), chk) * (0.94 + nF * 0.12) * (0.92 + grain * 0.16), edgeS(P.g, 0.06));
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
    if (PL.sand) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // wet sand is glossy: a fresnel sheen of the sky haze over the swash face
        #ifdef USE_FOG
        float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
        totalEmissiveRadiance += fogColor * gWet * gSandK * (0.06 + 0.5 * fres);
        #endif`);
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
