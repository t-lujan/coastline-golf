// Sky: believable gradient matched to the fog at the horizon, the real sun (big soft disc low on the horizon),
// two cloud layers lit from the sun's side, and stars plus a moon at night.
import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';

export function createSky() {
  const uniforms = {
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uNight: { value: 0 }, uCloud: { value: 0.3 }, uTime: { value: 0 }, uFog: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uZen, uHor, uSunCol, uSunDir, uMoonDir; uniform float uNight, uCloud, uTime, uFog; uniform vec2 uWind;
      varying vec3 vDir;
      ${GLSL_NOISE}
      float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a * cgN2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        vec3 L = normalize(uSunDir);
        float y = d.y, yy = max(y, 0.0);
        float sd = dot(d, L), sdp = max(sd, 0.0);
        float low = 1.0 - smoothstep(0.0, 0.4, L.y);            // 1 near sunrise/sunset
        float day = 1.0 - uNight;
        // gradient: deep zenith, a soft bright band at the horizon
        vec3 col = mix(uZen, uHor, pow(1.0 - yy, 3.2));
        col += uSunCol * pow(sdp, 3.0) * 0.28 * (0.25 + low) * day;           // warm sun side
        col *= 1.0 - 0.14 * max(-sd, 0.0) * day;                               // cooler opposite the sun
        col = mix(col, uHor, smoothstep(0.0, -0.06, y));
        // clouds
        float cov = clamp(uCloud, 0.0, 1.0);
        vec2 cp = d.xz / (yy + 0.09);
        vec2 drift = uWind * uTime * 0.0035;
        vec2 b1 = cp * 0.55 + drift;
        vec2 warp = vec2(fbm(b1 * 0.7 + 3.1), fbm(b1 * 0.7 - 1.7)) - 0.5;
        float dens = fbm(b1 + warp * 0.8);
        float c1 = smoothstep(0.6 - cov * 0.36, 0.78 - cov * 0.22, dens);
        float toward = fbm(b1 + warp * 0.8 + L.xz * 0.09);
        float lit = clamp((dens - toward) * 5.0 + 0.55, 0.0, 1.0);
        vec3 shadowC = mix(uHor, uZen, 0.35) * mix(0.82, 0.62, cov);
        vec3 litC = mix(vec3(1.0), uSunCol * 1.25, 0.25 + low * 0.6) * (0.9 + 0.2 * (1.0 - cov));
        vec3 cloudC = mix(shadowC, litC, lit * (1.0 - cov * 0.55));
        cloudC += uSunCol * pow(sdp, 10.0) * (1.0 - c1) * 1.6 * day;          // silver lining near the sun
        // high wispy cirrus
        vec2 b2 = vec2(cp.x * 0.25 + cp.y * 0.1, cp.y * 1.4 - cp.x * 0.2) * 0.6 + drift * 1.6;
        float c2 = smoothstep(0.55, 0.85, fbm(b2 * 1.3 + 5.0)) * 0.45 * (1.0 - cov * 0.5);
        float mdc = max(dot(d, normalize(uMoonDir)), 0.0);
        if (uNight > 0.5) {   // moonlit clouds: dim blue-grey bodies, silver edges toward the moon
          cloudC = mix(uHor * 1.3, vec3(0.3, 0.34, 0.44), 0.3) * (0.75 + 0.5 * lit) + vec3(0.55, 0.6, 0.72) * pow(mdc, 10.0) * (0.25 + 0.6 * (1.0 - c1));
          litC = cloudC;
        }
        float hfade = smoothstep(0.0, 0.14 + uFog * 0.3, y);                    // in a marine layer the clouds melt into the haze
        col = mix(col, mix(litC, uSunCol, low * 0.4), c2 * hfade * day);
        col = mix(col, cloudC, c1 * hfade * 0.95);
        float cloudAll = max(c1, c2) * hfade;
        // sun: glow and a disc that swells near the horizon (blooms)
        float vis = smoothstep(-0.02, 0.01, y) * (1.0 - uFog * 0.85);
        float glow = pow(sdp, 18.0) * 0.38 + pow(sdp, 220.0) * 1.5;
        float rad = mix(0.0105, 0.02, low);
        float disc = smoothstep(cos(rad), cos(rad * 0.82), sd);
        col += uSunCol * (glow * (0.5 + low) * (1.0 - c1 * 0.6) + disc * 22.0 * (1.0 - c1 * 0.9)) * day * vis;
        // night sky
        if (uNight > 0.0) {
          vec2 sp = d.xz / (d.y + 1.0) * 260.0; vec2 cell = floor(sp);
          float tw = 0.65 + 0.35 * sin(uTime * 2.0 + cgH2(cell) * 40.0);
          float st = step(0.9915, cgH2(cell)) * smoothstep(0.45, 0.0, length(fract(sp) - 0.5)) * smoothstep(0.03, 0.25, d.y) * tw;
          col += vec3(0.9, 0.95, 1.0) * st * uNight * (1.0 - cloudAll) * 1.8;
          col += vec3(0.25, 0.28, 0.4) * smoothstep(0.65, 0.9, fbm(vec2(d.x * 3.0 + d.z, d.z * 1.2) * 2.0)) * 0.05 * uNight * smoothstep(0.1, 0.6, d.y);
          float md = max(dot(d, normalize(uMoonDir)), 0.0);
          float moon = smoothstep(0.99955, 0.99972, md);
          float maria = cgN2(d.xz * 260.0) * 0.6 + cgN2(d.xz * 900.0) * 0.4;      // a hint of the darker maria
          col += vec3(0.92, 0.94, 1.0) * (moon * (6.0 - 2.6 * maria) * (1.0 - cloudAll * 0.7) + pow(md, 90.0) * 0.3 + pow(md, 8.0) * 0.08) * uNight;
          col += vec3(0.1, 0.13, 0.22) * pow(md, 2.5) * 0.35 * uNight;              // the sky brightens toward the moon
        }
        col = mix(col, uHor, (1.0 - smoothstep(-0.02, 0.22, y)) * uFog * 0.85);  // fogged hills sit in matching haze
        col += (cgH2(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.scale.setScalar(3800); mesh.frustumCulled = false; mesh.renderOrder = -1;
  return { mesh, uniforms };
}
