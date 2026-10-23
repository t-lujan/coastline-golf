// Morro Rock: a domed volcanic plug with fractured cliffs, strata, scrub, a dark wet base and boulders at the waterline.
import * as THREE from 'three';
import { ROCK } from './course.js';
import { n3, fbm3, ridged3, GLSL_NOISE, rimUniforms, GLSL_RIM_DECL, GLSL_RIM } from './noise.js';

function shape(dx, dy, dz, out) {
  // dx,dy,dz: unit direction. Returns a point in metres (rock-local) and a cavity estimate for AO.
  const hl = Math.hypot(dx, dz) || 1e-6, ux = dx / hl, uz = dz / hl;
  let r, Y;
  if (dy >= 0) {
    r = Math.pow(Math.max(0, 1 - Math.pow(dy, 2.1)), 0.46) * (1 + 0.12 * (1 - dy) * (1 - dy));   // steep flanks, rounded dome
    Y = dy * ROCK.h;
  } else { r = 1.02 - dy * 0.15; Y = dy * 40; }
  // asymmetry: summit leans west, a lower stepped shoulder to the east, a long ridge to the north-west
  const east = Math.max(0, ux);
  Y *= 1 - 0.32 * east * Math.min(1, Math.max(0, (dy - 0.15) / 0.6));
  r *= 1 + 0.16 * east * (1 - Math.min(1, dy * 1.6));
  let X = ux * r * ROCK.rx - Math.max(0, dy) * 14, Z = uz * r * ROCK.rz;
  // displacement in metres along the horizontal outward direction (and a bit vertically on the cap)
  const big = ridged3(X / 46, Y / 52, Z / 46, 4);
  const cols = n3(X / 11 + 3, Y / 70, Z / 11);                 // vertical fracture columns
  const strata = Math.sin(Y / 9 + fbm3(X / 30, Y / 30, Z / 30, 2) * 6) * 0.25;
  const fine = fbm3(X / 7, Y / 7, Z / 7, 3);
  const flank = dy < 0.93 ? 1 : 0.4;
  const disp = ((big - 0.45) * 15 + (cols - 0.5) * 10 + strata * 1.2 + (fine - 0.5) * 3.2) * flank * (dy < -0.02 ? 0.4 : 1);
  X += ux * disp; Z += uz * disp; Y += (dy > 0.75 ? (big - 0.45) * 12 + (fine - 0.5) * 3 : 0) * (dy > 0 ? 1 : 0);
  out.x = X; out.y = Y; out.z = Z;
  out.cav = (big - 0.45) * 1.4 + (cols - 0.5) * 0.9 + strata * 0.12;
}

export function createRock(quality = 'high') {
  const [ws, hs] = quality === 'low' ? [140, 70] : quality === 'med' ? [180, 90] : [240, 120];
  const geo = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const p = geo.attributes.position, ao = new Float32Array(p.count), o = {};
  for (let i = 0; i < p.count; i++) {
    shape(p.getX(i), p.getY(i), p.getZ(i), o);
    p.setXYZ(i, o.x, o.y, o.z);
    const base = Math.min(1, Math.max(0, (o.y + 2) / 30));
    ao[i] = Math.min(1.1, Math.max(0.28, 0.72 + o.cav * 0.55)) * (0.55 + 0.45 * base);
  }
  geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, rimUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO; varying vec3 vRP; varying vec3 vRN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO; vRP = position; vRN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${GLSL_RIM_DECL}\nvarying float vAO; varying vec3 vRP; varying vec3 vRN;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 P = vRP; vec3 Nw = normalize(vRN);
        float n1 = cgN3(P * 0.035), n2 = cgN3(P * 0.19 + 7.0), n4 = cgN3(P * 0.6);
        float colv = cgN3(vec3(P.x * 0.11, P.y * 0.014, P.z * 0.11));
        float strata = cgN3(vec3(P.x * 0.16, P.y * 0.02, P.z * 0.16));   // vertical streaking
        vec3 c = mix(vec3(0.19, 0.185, 0.18), vec3(0.34, 0.325, 0.30), n1);          // dacite grey-brown
        c = mix(c, vec3(0.44, 0.40, 0.35), smoothstep(0.55, 0.85, n2) * 0.45);        // tan weathering
        c *= mix(0.7, 1.08, strata);
        c *= mix(0.72, 1.08, colv);
        c *= 0.86 + n4 * 0.28;
        // scrub and grass on the ledges and gentler slopes, more of it low down
        float up = Nw.y;
        float scrub = smoothstep(0.22, 0.6, up + (n2 - 0.5) * 0.6) * smoothstep(0.38, 0.58, n1 + n4 * 0.25) * (1.0 - smoothstep(110.0, 150.0, P.y)) * smoothstep(5.0, 10.0, P.y);
        c = mix(c, mix(vec3(0.07, 0.11, 0.045), vec3(0.17, 0.21, 0.09), n4), scrub * 0.92);
        // pale lichen / guano streaks near the summit
        c = mix(c, vec3(0.62, 0.60, 0.54), smoothstep(0.5, 0.85, up) * smoothstep(0.6, 0.78, n2) * smoothstep(70.0, 130.0, P.y) * 0.55);
        // dark wet base and a barnacle band at the tide line
        c = mix(c, vec3(0.06, 0.06, 0.055), 1.0 - smoothstep(0.4, 5.5, P.y + (n4 - 0.5) * 2.0));
        c = mix(c, vec3(0.28, 0.27, 0.24), smoothstep(1.2, 2.2, P.y) * (1.0 - smoothstep(2.2, 3.4, P.y)) * 0.6);
        c *= vAO;
        diffuseColor.rgb *= c;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float bh = cgN3(vRP * 0.45) * 0.55 + cgN3(vRP * 1.4) * 0.25 + cgN3(vec3(vRP.x * 0.5, vRP.y * 0.06, vRP.z * 0.5)) * 0.45;
        normal = cgBump(normal, -vViewPosition, bh, 1.4);`)
      .replace('#include <opaque_fragment>', `${GLSL_RIM}\n#include <opaque_fragment>`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.position.set(ROCK.x, 0, ROCK.z); m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
  g.add(createBoulders(quality === 'low' ? 40 : 90));
  return g;
}

// tumbled boulders around the waterline
function createBoulders(n) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.75 + fbm3(x * 1.7, y * 1.7, z * 1.7, 2) * 0.5; p.setXYZ(i, x * k, y * k * 0.7, z * k); }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x2b2824 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.1, rr = 1.0 + Math.random() * 0.12;
    v.set(ROCK.x + Math.cos(a) * ROCK.rx * rr, -0.6 + Math.random() * 0.8, ROCK.z + Math.sin(a) * ROCK.rz * rr);
    e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); q.setFromEuler(e);
    const sc = 1.5 + Math.random() * Math.random() * 7; s.set(sc, sc, sc);
    m.compose(v, q, s); mesh.setMatrixAt(i, m);
  }
  mesh.receiveShadow = true;
  return mesh;
}
