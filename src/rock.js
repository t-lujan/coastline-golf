// Morro Rock: a domed volcanic plug with fractured cliffs, strata, scrub, a dark wet base and boulders at the waterline.
import * as THREE from 'three';
import { ROCK } from './course.js';
import { n3, fbm3, ridged3, GLSL_NOISE, rimUniforms, tameUniforms, GLSL_RIM_DECL } from './noise.js';

function shape(dx, dy, dz, out) {
  // dx,dy,dz: unit direction. Returns a point in metres (rock-local) and a cavity estimate for AO.
  // Morro Rock is a dacite plug: near-vertical jointed flanks, a rounded summit dome, a talus apron at the waterline.
  const hl = Math.hypot(dx, dz) || 1e-6, ux = dx / hl, uz = dz / hl;
  let r, Y;
  if (dy >= 0) {
    r = Math.sqrt(Math.max(0, 1 - Math.pow(dy, 2.4))) * (1 + 0.2 * Math.pow(1 - dy, 4));   // steep walls, rounded summit, talus foot
    Y = dy * ROCK.h;
  } else { r = 1.2 - dy * 0.2; Y = dy * 40; }                                                // keeps widening below the waterline: no undercut
  // asymmetry: the summit sits west of centre, a lower stepped shoulder runs east toward the causeway
  const east = Math.max(0, ux);
  Y *= 1 - 0.2 * east * Math.min(1, Math.max(0, (dy - 0.15) / 0.6));
  r *= 1 + 0.1 * east * (1 - Math.min(1, dy * 1.5));
  let X = ux * r * ROCK.rx - Math.max(0, dy) * 16, Z = uz * r * ROCK.rz;
  // displacement in metres along the horizontal outward direction
  const lobe = fbm3(X / 70 + 2, Y / 90, Z / 70, 3);                             // a few broad buttresses
  const joint = ridged3(X / 15 + 3, Y / 110, Z / 15, 2);                         // vertical columnar ribs, sharp crests
  const ledge = Math.sin(Y / 11 + fbm3(X / 40, Y / 40, Z / 40, 2) * 5) * 0.5;   // faint horizontal ledges
  const fine = fbm3(X / 6, Y / 9, Z / 6, 2);
  const wall = 1 - Math.min(1, Math.max(0, (dy - 0.78) / 0.2)) * 0.75;          // the summit dome is smoother than the walls
  const disp = ((lobe - 0.5) * 18 + (joint - 0.5) * 9 * wall + ledge * 1.2 + (fine - 0.5) * 2.2) * (dy < -0.02 ? 0.4 : 1);
  X += ux * disp; Z += uz * disp; Y += dy > 0.8 ? ((lobe - 0.5) * 10 + (fine - 0.5) * 2) * (dy - 0.8) * 5 : 0;
  out.x = X; out.y = Y; out.z = Z;
  out.cav = (lobe - 0.5) * 1.2 + (joint - 0.5) * 1.1 * wall + ledge * 0.1;
}

export function createRock(quality = 'high') {
  const [ws, hs] = quality === 'low' ? [140, 70] : quality === 'med' ? [180, 90] : [240, 120];
  const geo = new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const p = geo.attributes.position, ao = new Float32Array(p.count), o = {};
  for (let i = 0; i < p.count; i++) {
    shape(p.getX(i), p.getY(i), p.getZ(i), o);
    p.setXYZ(i, o.x, o.y, o.z);
    const base = Math.min(1, Math.max(0, (o.y + 2) / 30));
    ao[i] = Math.min(1.08, Math.max(0.5, 0.82 + o.cav * 0.4)) * (0.6 + 0.4 * base);
  }
  geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, rimUniforms, tameUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO; varying vec3 vRP; varying vec3 vRN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO; vRP = position; vRN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\n${GLSL_RIM_DECL}\nuniform float uTame, uRelief, uNightK;\nvarying float vAO; varying vec3 vRP; varying vec3 vRN;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 P = vRP; vec3 Nw = normalize(vRN);
        float n1 = mix(0.5, cgN3(P * 0.03), 0.6), n2 = cgN3(P * 0.11 + 7.0), n4 = cgN3(P * 0.5);
        float vs = cgN3(vec3(P.x * 0.12, P.y * 0.012, P.z * 0.12));                 // long vertical streaks
        float vf = cgN3(vec3(P.x * 0.22 + 5.0, P.y * 0.005, P.z * 0.22));            // joint field: nearly constant up the wall
        float up = Nw.y, hy = P.y / ${ROCK.h.toFixed(1)};
        // dacite: cool grey with tan and faint rust weathering, lighter weathered faces
        vec3 c = mix(vec3(0.31, 0.305, 0.30), vec3(0.45, 0.44, 0.42), n1);
        c = mix(c, vec3(0.50, 0.43, 0.35), smoothstep(0.55, 0.8, n2) * 0.5);          // tan / iron-stained patches
        c = mix(c, vec3(0.58, 0.565, 0.53), smoothstep(0.6, 0.85, vs + n4 * 0.15) * 0.55);  // pale weathered faces
        c *= mix(0.86, 1.06, vs) * (0.92 + n4 * 0.16);
        // vertical joints: dark, thin, a little wider low down where the talus starts
        float fis = (1.0 - smoothstep(0.0, 0.03 + (1.0 - hy) * 0.015, abs(vf - 0.5))) * smoothstep(0.35, 0.6, cgN3(vec3(P.x * 0.05, P.y * 0.02, P.z * 0.05)));
        c *= 1.0 - fis * 0.42 * smoothstep(0.8, 0.3, up);
        // sparse scrub on the gentler lower slopes and ledges
        float scrub = smoothstep(0.35, 0.7, up + (n2 - 0.5) * 0.5) * smoothstep(0.45, 0.65, n1 + n4 * 0.2) * (1.0 - smoothstep(0.45, 0.75, hy)) * smoothstep(4.0, 12.0, P.y);
        c = mix(c, mix(vec3(0.12, 0.14, 0.07), vec3(0.22, 0.24, 0.12), n4), scrub * 0.8);
        // guano: whitish ledges and drips down the upper walls (the peregrines and gulls nest up there)
        float drip = smoothstep(0.62, 0.8, cgN3(vec3(P.x * 0.22 + 3.0, P.y * 0.018, P.z * 0.22)));
        float gu = smoothstep(0.5, 0.85, hy + (n2 - 0.5) * 0.25) * max(smoothstep(0.25, 0.6, up) * smoothstep(0.45, 0.7, n2), drip * 0.8);
        c = mix(c, vec3(0.80, 0.79, 0.74), gu * 0.75);
        // dark wet base and a pale barnacle band at the tide line
        c = mix(c, vec3(0.07, 0.068, 0.062), 1.0 - smoothstep(0.6, 6.0, P.y + (n4 - 0.5) * 2.5));
        c = mix(c, vec3(0.36, 0.35, 0.31), smoothstep(1.4, 2.4, P.y) * (1.0 - smoothstep(2.4, 3.6, P.y)) * 0.5);
        c *= vAO;
        diffuseColor.rgb *= c;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float bh = cgN3(vRP * 0.4) * 0.35 + cgN3(vRP * 1.3) * 0.18 + cgN3(vec3(vRP.x * 0.45 + 5.0, vRP.y * 0.01, vRP.z * 0.45)) * 0.5;   // vertical jointing carries the relief
        // relief fades where the surface turns away from the key light, so grazing sun/moonlight doesn't draw bright veins
        #if NUM_DIR_LIGHTS > 0
          float reliefK = mix(0.4, 1.0, smoothstep(0.0, 0.45, dot(normal, directionalLights[0].direction)));
        #else
          float reliefK = 1.0;
        #endif
        normal = cgBump(normal, -vViewPosition, bh, 1.15 * uRelief * reliefK);`)
      .replace('#include <opaque_fragment>', `
        // rim on the true silhouette only: geometric normal, and only on edges that face the key light
        { float rimD = dot(nonPerturbedNormal, normalize(vViewPosition)); float rimF = pow(1.0 - clamp(rimD, 0.0, 1.0), 3.0) * smoothstep(-0.3, 0.1, rimD);
          #if NUM_DIR_LIGHTS > 0
            rimF *= smoothstep(-0.1, 0.35, dot(nonPerturbedNormal, directionalLights[0].direction));
          #endif
          outgoingLight += uRimCol * rimF * uRimK * 0.55; }
        { float rl = dot(outgoingLight, vec3(0.299, 0.587, 0.114)); outgoingLight = mix(outgoingLight, vec3(rl) * vec3(1.06, 1.0, 0.9), uTame * 0.62) * (1.0 - uTame * 0.12) * (1.0 - uNightK * 0.25); }   // grey-tan dacite, still warm
#include <opaque_fragment>`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.position.set(ROCK.x, 0, ROCK.z); m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
  g.add(createBoulders(quality === 'low' ? 70 : 170));
  // a sparse cloud of upper-flank points (world space) so cameras can frame the Rock's real silhouette
  const crest = [];
  for (let i = 0; i < p.count; i += 7) if (p.getY(i) > ROCK.h * 0.55) crest.push(new THREE.Vector3(p.getX(i) + ROCK.x, p.getY(i), p.getZ(i) + ROCK.z));
  g.userData.crest = crest;
  return g;
}

// tumbled boulders around the waterline
function createBoulders(n) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.75 + fbm3(x * 1.7, y * 1.7, z * 1.7, 2) * 0.5; p.setXYZ(i, x * k, y * k * 0.7, z * k); }
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {   // same low-sun taming as the rock, so the boulders stay grey instead of terracotta
    Object.assign(sh.uniforms, tameUniforms);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTame;')
      .replace('#include <opaque_fragment>', `{ float rl = dot(outgoingLight, vec3(0.299, 0.587, 0.114)); outgoingLight = mix(outgoingLight, vec3(rl) * vec3(1.04, 1.0, 0.94), uTame * 0.7); }
#include <opaque_fragment>`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler(), col = new THREE.Color();
  let i = 0;
  for (let t = 0; i < n && t < n * 20; t++) {
    // clustered in tumbles with gaps between them, never an even ring
    const a = Math.random() * Math.PI * 2, rr = 1.13 + Math.random() * Math.random() * 0.2;
    if (fbm3(Math.cos(a) * 3, 0, Math.sin(a) * 3, 2) < 0.42) continue;
    const k = 1 + 0.1 * Math.max(0, Math.cos(a));   // the rock is broader on its east side
    v.set(ROCK.x + Math.cos(a) * ROCK.rx * rr * k, -1 + Math.random() * 1.2, ROCK.z + Math.sin(a) * ROCK.rz * rr * k);
    e.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); q.setFromEuler(e);
    const sc = 1.5 + Math.random() * Math.random() * 10; s.set(sc * (1 + Math.random() * 0.5), sc, sc);
    m.compose(v, q, s); mesh.setColorAt(i, col.setRGB(0.25, 0.245, 0.235).multiplyScalar(0.6 + Math.random() * 0.6)); mesh.setMatrixAt(i++, m);
  }
  mesh.count = i; mesh.receiveShadow = true;
  return mesh;
}
