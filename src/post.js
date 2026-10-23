// Post-processing chain, scaled by quality level.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const touch = typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1);
// scatter keys (grass, flowers, ice, rocks, drift, shrubs) are density fractions; near/far are the distances (m) where
// scatter starts thinning and is gone; treeNear is how close a tree must be to use its full mesh (beyond: a cheap far version)
export const QUALITY = {
  high: { dpr: 2, bloom: true, bloomScale: touch ? 0.5 : 1, mips: 5, aa: touch ? 'fxaa' : 'smaa', shadow: 2048, grass: 1, post: true, flowers: 1, ice: 1, rocks: 1, drift: 1, shrubs: 1,
    near: 1e4, far: 1e4, treeNear: 1e4, terrain: [300, 310, 100, 290, 120, 100], water: 160, rock: 'high', rockShadow: true },
  med:  { dpr: touch ? 2 : 1.5, bloom: true, bloomScale: 0.5, mips: 2, aa: 'fxaa', shadow: 1024, grass: 0.55, post: true, flowers: 0.4, ice: 0.5, rocks: 0.6, drift: 1, shrubs: 0.6,
    near: 55, far: 120, treeNear: 70, terrain: [170, 176, 56, 164, 80, 66], water: 64, rock: 'med', rockShadow: false },
  // low keeps the cheap grade pass (no bloom, no AA) so it still matches the look of the other tiers
  low:  { dpr: touch ? 1.5 : 1, bloom: false, aa: 'none', shadow: 512, grass: 0.35, post: true, flowers: 0, ice: 0.35, rocks: 0.4, drift: 0.5, shrubs: 0.4,
    near: 38, far: 80, treeNear: 50, terrain: [120, 124, 44, 128, 64, 54], water: 48, rock: 'low', rockShadow: false },
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, uVig: { value: 0.28 }, uSat: { value: 1.12 }, uContrast: { value: 0.16 }, uLift: { value: new THREE.Vector3() },
    uShadowTint: { value: new THREE.Vector3(-0.012, 0.004, 0.02) }, uHighTint: { value: new THREE.Vector3(0.018, 0.008, -0.012) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  // tone mapping and the sRGB transfer happen here too (no separate OutputPass): one full-screen pass less
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uSat, uContrast; uniform vec3 uShadowTint, uHighTint, uLift; varying vec2 vUv;
    #include <tonemapping_pars_fragment>
    void main(){ vec4 c = texture2D(tDiffuse, vUv); c.rgb = ACESFilmicToneMapping(c.rgb); c = sRGBTransferOETF(c); vec3 col = c.rgb;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);                 // gentle S-curve
      col += uShadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + uHighTint * smoothstep(0.5, 1.0, l);
      col += uLift * (1.0 - smoothstep(0.0, 0.4, l));                            // lifted (moonlit) shadows
      vec2 d = vUv - 0.5; float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 0.85)) * 1.25); col *= mix(1.0 - uVig, 1.0, v);
      col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;   // dither: no banding in fog and sky gradients
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a); }`,
};

export function createPost(renderer, scene, camera, level, w, h, dpr) {
  const q = QUALITY[level];
  if (!q.post) return { render: () => renderer.render(scene, camera), setSize() {}, dispose() {}, bloom: null };
  const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(dpr); composer.setSize(w, h);
  composer.addPass(new RenderPass(scene, camera));
  let bloom = null;
  if (q.bloom) {
    bloom = new UnrealBloomPass(new THREE.Vector2(w * q.bloomScale, h * q.bloomScale), 0.42, 0.6, 0.9);
    // fewer blur mips on cheaper tiers: two draw calls per mip saved; the unused mips stay black and are tinted out
    if (q.mips < bloom.nMips) { for (let i = q.mips; i < bloom.nMips; i++) bloom.bloomTintColors[i].set(0, 0, 0); bloom.nMips = q.mips; }
    composer.addPass(bloom);
  }
  const grade = new ShaderPass(GradeShader); grade.material.toneMapped = false; composer.addPass(grade);   // tone mapping happens in the grade shader, not again in the renderer
  const exposure = grade.uniforms.toneMappingExposure;
  let fxaa = null;
  if (q.aa === 'smaa') composer.addPass(new SMAAPass(w * dpr, h * dpr));
  else if (q.aa === 'fxaa') { fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); }
  const setRes = (W, H) => { if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / (W * dpr), 1 / (H * dpr)); };
  setRes(w, h);
  return {
    bloom, grade,
    render: () => { exposure.value = renderer.toneMappingExposure; composer.render(); },
    setSize: (W, H) => { composer.setSize(W, H); if (bloom) bloom.resolution.set(W * q.bloomScale, H * q.bloomScale); setRes(W, H); },
    dispose: () => { for (const p of composer.passes) p.dispose(); composer.dispose(); rt.dispose(); },   // passes own their render targets and lookup textures
  };
}
