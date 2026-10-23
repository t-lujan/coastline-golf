// Post-processing chain, scaled by quality level.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const touch = typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1);
export const QUALITY = {
  high: { dpr: 2, bloom: true, bloomScale: touch ? 0.5 : 1, aa: touch ? 'fxaa' : 'smaa', shadow: 2048, grass: 1, post: true },
  med:  { dpr: 1.5, bloom: true, bloomScale: 0.5, aa: 'fxaa', shadow: 1024, grass: 0.6, post: true },
  low:  { dpr: 1, bloom: false, aa: 'none', shadow: 512, grass: 0.35, post: false },
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.32 }, uLift: { value: new THREE.Vector3(0.0, 0.004, 0.012) }, uSat: { value: 1.12 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uSat; uniform vec3 uLift; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb;
      float l = dot(col, vec3(0.299,0.587,0.114)); col = mix(vec3(l), col, uSat) + uLift * (1.0 - l);
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.85)) * 1.25); col *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = vec4(col, c.a); }`,
};

export function createPost(renderer, scene, camera, level, w, h, dpr) {
  const q = QUALITY[level];
  if (!q.post) return { render: () => renderer.render(scene, camera), setSize() {}, dispose() {}, bloom: null };
  const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(dpr); composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(w * q.bloomScale, h * q.bloomScale), 0.38, 0.55, 0.86); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader); composer.addPass(grade);
  let fxaa = null;
  if (q.aa === 'smaa') composer.addPass(new SMAAPass(w * dpr, h * dpr));
  else if (q.aa === 'fxaa') { fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); }
  const setRes = (W, H) => { if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (W * dpr), 1 / (H * dpr)); };
  setRes(w, h);
  return {
    bloom, grade,
    render: () => composer.render(),
    setSize: (W, H) => { composer.setSize(W, H); if (bloom) bloom.resolution.set(W * q.bloomScale, H * q.bloomScale); setRes(W, H); },
    dispose: () => { composer.dispose(); rt.dispose(); },
  };
}
