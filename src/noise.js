import { Color } from 'three';
// Shared noise: JS value noise for baking geometry, plus the GLSL twins used by the shaders.
function h3(x, y, z) { const s = Math.sin(x * 127.1 + y * 269.5 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
export function n3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let xf = x - xi, yf = y - yi, zf = z - zi;
  xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), xf), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), xf), yf),
    l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), xf), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), xf), yf), zf);
}
export function fbm3(x, y, z, o = 4) { let s = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < o; i++) { s += a * n3(x * f, y * f, z * f); t += a; f *= 2.03; a *= 0.5; } return s / t; }
export function ridged3(x, y, z, o = 4) { let s = 0, a = 0.5, f = 1, t = 0; for (let i = 0; i < o; i++) { const v = 1 - Math.abs(2 * n3(x * f, y * f, z * f) - 1); s += a * v * v; t += a; f *= 2.1; a *= 0.5; } return s / t; }

export const GLSL_NOISE = /* glsl */`
  float cgH3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 269.5, 311.7))) * 43758.5453); }
  float cgN3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(cgH3(i), cgH3(i + vec3(1,0,0)), f.x), mix(cgH3(i + vec3(0,1,0)), cgH3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(cgH3(i + vec3(0,0,1)), cgH3(i + vec3(1,0,1)), f.x), mix(cgH3(i + vec3(0,1,1)), cgH3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float cgH2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float cgN2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cgH2(i), cgH2(i + vec2(1,0)), f.x), mix(cgH2(i + vec2(0,1)), cgH2(i + vec2(1,1)), f.x), f.y); }
  // screen-space bump: tilt a view-space normal by the gradient of a height field
  vec3 cgBump(vec3 nrm, vec3 viewPos, float hgt, float k){
    vec3 dpx = dFdx(viewPos), dpy = dFdy(viewPos);
    float dhx = dFdx(hgt), dhy = dFdy(hgt);
    vec3 r1 = cross(dpy, nrm), r2 = cross(nrm, dpx);
    float det = dot(dpx, r1);
    vec3 g = sign(det) * (dhx * r1 + dhy * r2);
    return normalize(abs(det) * nrm - g * k);
  }`;

// uTame 0..1: how hard to pull warm low-sun light back toward natural colours (rock, foliage at golden hour)
// uAerial: how far distant foliage fades toward the haze
// uRelief: scales the rock's fine bump relief (softer under a grazing low sun or moonlight)
// uNightK: 0 day → 1 moonlit night (the pale rock would otherwise read snow-white under the moon key)
export const tameUniforms = { uTame: { value: 0 }, uAerial: { value: 0.25 }, uRelief: { value: 1 }, uNightK: { value: 0 } };
// a shared rim / back light: brightens silhouettes when the camera looks toward the sun
export const rimUniforms = { uRimCol: { value: new Color(0, 0, 0) }, uRimK: { value: 0.0 } };
export const GLSL_RIM_DECL = 'uniform vec3 uRimCol; uniform float uRimK;';
export const GLSL_RIM = /* glsl */`
  { float rimD = dot(normal, normalize(vViewPosition)); float rimF = pow(1.0 - clamp(rimD, 0.0, 1.0), 3.0) * smoothstep(-0.3, 0.1, rimD);
    outgoingLight += uRimCol * rimF * uRimK; }`;
