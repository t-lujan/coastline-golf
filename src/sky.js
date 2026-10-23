// Custom gradient sky: matches the fog colour at the horizon, real sun direction, soft fbm clouds, stars and moon at night.
import * as THREE from 'three';

export function createSky() {
  const uniforms = {
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uNight: { value: 0 }, uCloud: { value: 0.3 }, uTime: { value: 0 }, uFog: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uZen, uHor, uSunCol, uSunDir, uMoonDir; uniform float uNight, uCloud, uTime, uFog;
      varying vec3 vDir;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*n(p); p*=2.07; a*=.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 col = mix(uHor, uZen, pow(y, 0.55));
        // below the horizon fade into the horizon colour (fog takes over)
        col = mix(col, uHor, smoothstep(0.02, -0.08, d.y));
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.6) * (1.0 - uNight) * (1.0 - uFog*0.6);
        col += uSunCol * smoothstep(0.9993, 0.9997, sd) * 18.0 * (1.0 - uNight) * (1.0 - uFog*0.85);  // disc (blooms)
        // clouds: a thin deck that thickens with cloud cover
        vec2 cp = d.xz / max(d.y + 0.12, 0.05) * 1.6 + vec2(uTime*0.004, uTime*0.0015);
        float c = smoothstep(1.0 - uCloud*0.75 - 0.08, 1.15 - uCloud*0.4, fbm(cp) + fbm(cp*2.3)*0.35);
        vec3 cloudLit = mix(uHor*1.05, vec3(1.0), 0.35) + uSunCol * pow(sd, 3.0) * 0.5;
        if (uNight > 0.5) cloudLit = uHor * 1.6;
        col = mix(col, cloudLit, c * smoothstep(0.0, 0.18, d.y) * 0.85);
        // night: stars + moon
        if (uNight > 0.0) {
          vec2 sp = d.xz / (d.y + 1.0) * 220.0; vec2 cell = floor(sp);
          float st = step(0.992, h(cell)) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5)) * smoothstep(0.05, 0.3, d.y);
          col += vec3(0.9, 0.95, 1.0) * st * uNight * (1.0 - c) * 1.6;
          float md = max(dot(d, normalize(uMoonDir)), 0.0);
          col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99955, 0.99975, md) * 6.0 + pow(md, 200.0) * 0.35) * uNight;
        }
        col += (h(gl_FragCoord.xy) - 0.5) / 255.0;   // dither
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.scale.setScalar(3800); mesh.frustumCulled = false; mesh.renderOrder = -1;
  return { mesh, uniforms };
}
