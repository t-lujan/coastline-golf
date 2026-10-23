// Water: analytic waves, fresnel sky reflection, sun glints, shoreline foam from a baked depth texture.
import * as THREE from 'three';

export function createWater({ depthTex, bounds, segments }) {
  const uniforms = {
    uTime: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSunI: { value: 1 },
    uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color('#0d3f55') }, uShallow: { value: new THREE.Color('#3fa3a2') },
    uDepth: { value: depthTex }, uBounds: { value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) },
    uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0.001 }, uNight: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      uniform float uTime; varying vec3 vW; varying float vDepthV;
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        float a = 0.14;
        w.y += a*sin(w.x*0.045 + uTime*0.9) + a*0.7*sin(w.z*0.06 - uTime*1.1) + a*0.4*sin((w.x+w.z)*0.11 + uTime*1.7);
        vW = w.xyz; vec4 mv = viewMatrix * w; vDepthV = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uSunI, uFogDensity, uNight; uniform vec3 uSunDir, uSunCol, uZen, uHor, uDeep, uShallow, uFogColor;
      uniform sampler2D uDepth; uniform vec4 uBounds; uniform vec2 uWind;
      varying vec3 vW; varying float vDepthV;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      // sum of directional waves -> analytic slope
      vec2 waveSlope(vec2 p, float t){
        vec2 s = vec2(0.0);
        vec2 dirs[6]; dirs[0]=normalize(vec2(1.0,0.35)); dirs[1]=normalize(vec2(0.7,-1.0)); dirs[2]=normalize(vec2(-0.4,1.0));
        dirs[3]=normalize(vec2(1.0,1.0)); dirs[4]=normalize(vec2(-1.0,0.2)); dirs[5]=normalize(uWind + vec2(0.001));
        float fr[6]; fr[0]=0.09; fr[1]=0.16; fr[2]=0.27; fr[3]=0.55; fr[4]=1.05; fr[5]=1.9;
        float am[6]; am[0]=0.16; am[1]=0.09; am[2]=0.05; am[3]=0.025; am[4]=0.012; am[5]=0.007;
        for (int i=0;i<6;i++){ float ph = dot(dirs[i], p)*fr[i] + t*sqrt(9.8*fr[i])*0.9; s += dirs[i] * cos(ph) * fr[i] * am[i] * 6.0; }
        return s;
      }
      void main(){
        vec2 uv = (vW.xz - uBounds.xy) / uBounds.zw;
        float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
        float depth = mix(30.0, texture2D(uDepth, uv).r * 14.0, inside);        // metres below the surface
        vec2 sl = waveSlope(vW.xz, uTime);
        float far = smoothstep(150.0, 1400.0, vDepthV);
        sl *= mix(1.0, 0.35, far);
        vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(uHor, uZen, pow(max(R.y, 0.0), 0.6));
        float shallow = exp(-depth * 0.32);
        vec3 body = mix(uDeep, uShallow, shallow) * (0.55 + 0.45 * max(dot(N, normalize(uSunDir + vec3(0,0.3,0))), 0.0));
        body *= mix(1.0, 0.25, uNight);
        vec3 col = mix(body, sky, fres * 0.85);
        // sun / moon glints
        vec3 L = normalize(uSunDir);
        float spec = pow(max(dot(R, L), 0.0), 420.0) * 30.0 + pow(max(dot(R, L), 0.0), 40.0) * 0.25;
        col += uSunCol * spec * uSunI * step(0.0, L.y);
        // shoreline foam: bands rolling in toward the beach + a bright lip
        float fn = n(vW.xz * 0.35 + uTime * 0.25) * 0.6 + n(vW.xz * 1.3 - uTime * 0.4) * 0.4;
        float band = smoothstep(0.55, 0.95, sin(depth * 4.2 - uTime * 1.6 + fn * 3.0) * 0.5 + 0.5) * smoothstep(2.2, 0.2, depth);
        float lip = smoothstep(0.55, 0.05, depth + (fn - 0.5) * 0.35);
        float foam = clamp(max(band * 0.75, lip) * (0.6 + 0.6 * fn), 0.0, 1.0) * inside;
        col = mix(col, vec3(0.93, 0.97, 0.97) * mix(1.0, 0.3, uNight) * (0.6 + 0.4 * uSunI / 3.0 + 0.3), foam * 0.85);
        // fog
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
