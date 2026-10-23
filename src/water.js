// Water: layered analytic waves with crisp ripples, fresnel sky reflection, depth-based colour (deep blue to
// turquoise shallows), sparkling sun/moon glints with a wide glitter path at low sun, and surf that rolls up the beach.
import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';

export function createWater({ depthTex, bounds, segments }) {
  const uniforms = {
    uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSunI: { value: 1 },
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color('#042540') }, uMid: { value: new THREE.Color('#0a4f6e') }, uShallow: { value: new THREE.Color('#1aa9a6') }, uSandy: { value: new THREE.Color('#5fc4b0') },
    uDepth: { value: depthTex }, uBounds: { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) },
    uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.001 }, uNight: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) }, uLow: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      uniform float uTime; varying vec3 vW; varying float vDepthV;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        float a = 0.12;
        w.y += a*sin(w.x*0.045 + uTime*0.9) + a*0.7*sin(w.z*0.06 - uTime*1.1) + a*0.4*sin((w.x+w.z)*0.11 + uTime*1.7);
        vW = w.xyz; vec4 mv = viewMatrix * w; vDepthV = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uSunI, uFogDensity, uNight, uLow; uniform vec3 uSunDir, uSunCol, uZen, uHor, uDeep, uMid, uShallow, uSandy, uFogColor;
      uniform sampler2D uDepth; uniform vec4 uBounds; uniform vec2 uWind;
      varying vec3 vW; varying float vDepthV;
      ${GLSL_NOISE}
      vec2 waveSlope(vec2 p, float t, float detail){
        vec2 s = vec2(0.0);
        for (int i = 0; i < 10; i++){
          float fi = float(i);
          float ang = fi * 2.399 + 0.6;
          vec2 dir = normalize(mix(vec2(cos(ang), sin(ang)), normalize(uWind + vec2(0.001)), 0.35));
          float fr = 0.07 * pow(1.42, fi);
          float am = 0.15 * pow(0.66, fi) * (i > 5 ? detail : 1.0);
          float ph = dot(dir, p) * fr + t * sqrt(9.8 * fr) * 0.85 + fi * 1.3;
          s += dir * cos(ph) * fr * am * 6.0;
        }
        return s;
      }
      void main(){
        vec2 uv = (vW.xz - uBounds.xy) / uBounds.zw;
        float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
        float depth = mix(30.0, texture2D(uDepth, uv).r * 14.0, inside);
        float far = smoothstep(120.0, 1500.0, vDepthV);
        float detail = 1.0 - smoothstep(60.0, 500.0, vDepthV);
        vec2 sl = waveSlope(vW.xz, uTime, detail) * mix(1.0, 0.3, far);
        // fine ripples close to the camera
        vec2 rp = vW.xz * 1.7 + uWind * uTime * 0.6;
        sl += (vec2(cgN2(rp), cgN2(rp + 17.0)) - 0.5) * 0.18 * detail;
        sl *= mix(0.55, 1.0, smoothstep(0.0, 3.0, depth));            // calmer in the shallows
        vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 L = normalize(uSunDir);
        vec3 sky = mix(uHor, uZen, pow(max(R.y, 0.0), 0.5));
        sky += uSunCol * pow(max(dot(R, L), 0.0), 6.0) * 0.35 * (0.3 + uLow) * (1.0 - uNight);
        // body colour: deep blue offshore, turquoise over sand, glassy near the beach
        float dd = depth;
        vec3 body = mix(uDeep, uMid, exp(-dd * 0.08));
        body = mix(body, uShallow, exp(-dd * 0.35));
        body = mix(body, uSandy, exp(-dd * 1.4) * 0.8);
        float sunLit = 0.55 + 0.45 * max(dot(N, normalize(L + vec3(0.0, 0.4, 0.0))), 0.0);
        body *= sunLit * mix(1.0, 0.16, uNight) * mix(1.0, 0.7, uLow);
        // light through wave crests in the shallows, and caustics dancing on the sand just off the beach
        body += uShallow * max(sl.x + sl.y, 0.0) * 0.5 * exp(-dd * 0.25) * (1.0 - uNight);
        vec2 cq = vW.xz * 0.9 + sl * 2.0;
        float cau = pow(1.0 - abs(cgN2(cq + uTime * 0.35) - cgN2(cq * 1.3 - uTime * 0.28)), 6.0);
        body += vec3(0.55, 0.75, 0.62) * cau * 0.35 * smoothstep(2.2, 0.3, dd) * smoothstep(0.05, 0.4, dd) * detail * (1.0 - uNight) * (0.4 + uSunI * 0.2);
        vec3 col = mix(body, sky, fres * 0.9);
        // glints: a tight sparkle, a broader sheen, and a wide glitter path when the sun or moon is low
        float rl = max(dot(R, L), 0.0);
        float sparkle = step(0.72, cgN2(vW.xz * 2.3 + uTime * 1.3)) * pow(rl, 900.0) * mix(140.0, 10.0, uNight);
        float spec = pow(rl, 260.0) * mix(14.0, 1.6, uNight) + pow(rl, 40.0) * 0.35 + sparkle * detail;
        // the wide glitter path; by moonlight it breaks into a shimmer of small flecks instead of a solid streak
        float fleck = mix(1.0, 0.15 + 1.3 * step(0.58, cgN2(vW.xz * vec2(2.6, 1.1) + uTime * vec2(0.9, 0.4))), uNight);
        spec += pow(rl, 14.0) * uLow * 1.1 * (0.6 + 0.8 * cgN2(vW.xz * 0.9 + uTime)) * fleck;
        col += uSunCol * spec * uSunI * step(0.0, L.y);
        // surf: bands rolling toward the beach and a bright lip at the waterline
        float fn = cgN2(vW.xz * 0.35 + uTime * 0.25) * 0.6 + cgN2(vW.xz * 1.3 - uTime * 0.4) * 0.4;
        // foam lines: a sharp leading edge rolling toward the beach with a soft, broken trail behind it
        float roll = (depth * 3.6 + uTime * 1.5 + fn * 2.5) / 6.2832;
        float ph = fract(roll);
        float band = smoothstep(0.0, 0.05, ph) * (1.0 - smoothstep(0.05, 0.42, ph)) * smoothstep(0.3, 0.6, fn + 0.25) * smoothstep(2.4, 0.25, depth);
        float lip = smoothstep(0.5, 0.04, depth + (fn - 0.5) * 0.3);
        float lace = smoothstep(0.45, 0.75, cgN2(vW.xz * 2.2 + uTime * 0.3)) * smoothstep(1.2, 0.2, depth);
        float foam = clamp(max(max(band * 0.85, lip), lace * 0.45) * (0.55 + 0.65 * fn), 0.0, 1.0) * inside;
        vec3 foamC = vec3(0.92, 0.96, 0.97) * mix(1.0, 0.22, uNight) * (0.55 + 0.25 * uSunI / 3.0 + 0.25);
        col = mix(col, foamC, foam * 0.9);
        float f = 1.0 - exp(-pow(uFogDensity * vDepthV, 2.0));
        col = mix(col, uFogColor, f);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(7000, 7000, segments, segments); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat); mesh.position.set(0, 0, -100); mesh.receiveShadow = false;
  return { mesh, uniforms };
}
