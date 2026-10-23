// Coastline Golf · Hole 1 · Morro Rock
import * as THREE from 'three';
import { TEE, CUP, GREEN, PAR, HOLE_M, HOLE_YD, ROCK, STACKS, BOUNDS, HEADING, heightAt, surfaceAt, greenDist } from './course.js';
import { sunPosition, sceneDate, laClock, lookFor } from './sun.js';
import { getWeather, compass } from './weather.js';
import { createSky } from './sky.js';
import { createWater } from './water.js';
import { createTerrain, createHills, bakeDepth } from './terrain.js';
import { createStacks, createFlag, createTeeMarkers, createTeePeg, createBall, createGulls } from './props.js';
import { createRock } from './rock.js';
import { windUniforms, leafUniforms, createGrass, createTrees, createShrubs, createFlowers, createIcePlant, createBeachRocks, createDriftwood, lodScatter } from './vegetation.js';
import { createBoats, createWisps, createMist } from './atmos.js';
import { rimUniforms, tameUniforms } from './noise.js';
import { Ball, BALL_R, CLUBS, SURF, predict } from './physics.js';
import { Ribbon, groundLine, createMarker, Particles, puff, confetti } from './fx.js';
import { QUALITY, createPost } from './post.js';
import { Audio } from './audio.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3;
const YD = 1.09361;
const yd = (m) => Math.round(m * YD);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const errors = [];

// ---------- renderer ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;   // count every pass of the frame, not just the last one
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.15, 6000);
scene.fog = new THREE.FogExp2(0xcfe3ea, 0.001);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.castShadow = true; sun.shadow.intensity = 0.8;
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 1, far: 900 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
const fill = new THREE.DirectionalLight(0xffffff, 0.3);
scene.add(hemi, sun, sun.target, fill, fill.target);

let qMode = params.get('quality') || localStorage.getItem('cg-quality') || 'auto';
if (!['auto', 'high', 'med', 'low'].includes(qMode)) qMode = 'auto';
// auto starts from a guess at the device class, then steps down if the frame rate drops below 48
// iPhone / iPad (iPadOS reports itself as a Mac with touch) / Android phones never start on high: mobile GPUs are
// fill-rate bound at their 2-3x pixel ratios. iOS hides the real core count and memory, so it is not used there.
const UA = navigator.userAgent || '';
const IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const MOBILE = IOS || /Android|Mobile/.test(UA);
function autoTier() {
  const cores = navigator.hardwareConcurrency || 8, mem = navigator.deviceMemory || 8;
  const small = Math.min(screen.width || innerWidth, screen.height || innerHeight) < 600;
  if (IOS) return small && (window.devicePixelRatio || 1) < 2.5 && Math.max(screen.width, screen.height) < 700 ? 'low' : 'med';   // older 2x small iPhones (SE/8) start low
  if (cores <= 2 || mem <= 2 || (touch && (mem <= 3 || cores <= 4))) return 'low';   // very weak
  if (MOBILE || touch || small || cores <= 4 || mem <= 4) return 'med';              // phones, tablets, small laptops
  return 'high';
}
const autoStart = autoTier();
let qLevel = qMode === 'auto' ? autoStart : qMode;
let post = null, W = 1, H = 1, dpr = 1, baseFov = 48;

// ---------- world (filled during loading) ----------
const W0 = {};
const audio = new Audio();
let weather = null, look = null, simDate = null, timeOverride = false;

async function loadStep(label, pct) {
  $('load-step').textContent = label; $('load-bar').style.transform = `scaleX(${pct})`;
  await new Promise((r) => setTimeout(r, 30));
}

async function build() {
  const weatherP = getWeather(params);
  await loadStep('Shaping the coastline', 0.1);
  const big = !touch;
  // mesh detail follows the tier the game starts on (built once; a later tier change keeps these meshes)
  const L = QUALITY[qLevel], ts = qLevel === 'high' && touch ? [230, 238, 70, 205, 90, 75] : L.terrain;
  const depthTex = bakeDepth(512);
  const terrain = createTerrain({ segX: ts[0], segZ: ts[1], paintRes: big ? 1024 : 768, warp: true });
  scene.add(terrain.mesh);
  const corridor = createTerrain({ segX: ts[2], segZ: ts[3], paint: terrain.paint, offset: 1, bounds: { minX: -60, maxX: 80, minZ: -178, maxZ: 232 } });
  const greenPatch = createTerrain({ segX: ts[4], segZ: ts[5], paint: terrain.paint, offset: 2, bounds: { minX: -28, maxX: 32, minZ: -165, maxZ: -115 } });
  corridor.mesh.receiveShadow = greenPatch.mesh.receiveShadow = true;
  scene.add(corridor.mesh, greenPatch.mesh);
  W0.ground = [greenPatch.mesh, corridor.mesh, terrain.mesh];
  W0.water = createWater({ depthTex, bounds: BOUNDS, segments: qLevel === 'high' && touch ? 110 : L.water }); scene.add(W0.water.mesh);
  W0.sky = createSky(); scene.add(W0.sky.mesh);
  scene.add(createHills());
  await loadStep('Raising Morro Rock', 0.35);
  const rock = createRock(qLevel === 'high' && touch ? 'med' : L.rock); W0.crest = rock.userData.crest; W0.rock = rock.children[0]; scene.add(rock); scene.add(createStacks());
  W0.boats = createBoats(); scene.add(W0.boats);
  W0.wisps = createWisps(touch ? 45 : 70); scene.add(W0.wisps.points);
  W0.mist = createMist(depthTex, BOUNDS); scene.add(W0.mist.group);
  // aviation beacons on the stacks
  const bmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2), fog: false });
  W0.beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(1.4, 8, 6), bmat, STACKS.length * 2);
  STACKS.forEach(([x, z], i) => { for (const [j, y, r] of [[0, 137.5, 1], [1, 72, 0.8]]) W0.beacons.setMatrixAt(i * 2 + j, new THREE.Matrix4().compose(new V3(x, heightAt(x, z) + y, z), new THREE.Quaternion(), new V3(r, r, r))); });
  scene.add(W0.beacons); W0.bmat = bmat;
  W0.flag = createFlag(); scene.add(W0.flag.group);
  scene.add(createTeeMarkers());
  W0.peg = createTeePeg(); scene.add(W0.peg);
  W0.gulls = createGulls(touch ? 7 : 11); scene.add(W0.gulls);
  await loadStep('Planting cypress and dune grass', 0.55);
  // scatter is thinned by distance from the camera every few metres it moves (see updateLod); reach: how far each kind
  // carries relative to the tier's near/far distances (bigger plants stay visible further out)
  W0.scatter = { grass: createGrass(touch ? 9000 : 20000, touch ? 650 : 1000), flowers: createFlowers(touch ? 2600 : 5000), ice: createIcePlant(touch ? 1400 : 2600), rocks: createBeachRocks(touch ? 260 : 420), drift: createDriftwood(40), shrubs: createShrubs(touch ? 700 : 1100) };
  W0.reach = { grass: 1, flowers: 0.8, ice: 1.4, rocks: 1.6, drift: 1.6, shrubs: 1.7 };
  for (const m of Object.values(W0.scatter)) { lodScatter(m); scene.add(m); }
  W0.trees = createTrees(qLevel); scene.add(W0.trees);
  // ball, effects
  W0.ballMesh = createBall(); scene.add(W0.ballMesh);
  W0.tracer = new Ribbon(260, 0xf2fbfa, 0.6, 0.003, 0.016); scene.add(W0.tracer.mesh);
  W0.aimLine = new Ribbon(200, 0xe1f5f3, 0.7, 0.0022, 0.03); scene.add(W0.aimLine.mesh);
  W0.marker = createMarker(); scene.add(W0.marker);
  W0.parts = new Particles(900); scene.add(W0.parts.points);
  await loadStep('Reading Morro Bay weather', 0.75);
  weather = await weatherP;
  if (weather.rain) {
    const n = touch ? 900 : 1800, pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = (Math.random() - 0.5) * 70, y = Math.random() * 40, z = (Math.random() - 0.5) * 70; pos.set([x, y, z, x, y - 0.5, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    W0.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.35, depthWrite: false }));
    W0.rain.frustumCulled = false; W0.rainPos = pos; scene.add(W0.rain);
  }
  await loadStep('Lighting the scene', 0.9);
  const sd = sceneDate(params.get('time')); simDate = sd.date; timeOverride = sd.override;
  applyLook();
  resize();
  setQuality(qLevel, false);
  camera.position.set(-260, 60, -470); camera.lookAt(ROCK.x, 60, ROCK.z);
  renderer.compile(scene, camera);
  post.render();
  await loadStep('Ready', 1);
}
// par and yardage come from the course itself (centre-line length, tee -> dogleg corner -> cup)
$('hole-text').textContent = `Hole 1 · Morro Rock · Par ${PAR} · ${HOLE_YD} yd`;
$('fly-sub').textContent = `Par ${PAR} · ${HOLE_YD} yd · carry the inlet`;

// ---------- light, sky, fog from real time + weather ----------
const sunDir = new V3(), moonDir = new V3(), tmpC = new THREE.Color();
function applyLook() {
  if (!timeOverride) simDate = new Date();
  const sp = sunPosition(simDate), el = sp.elevation * Math.PI / 180, az = (sp.azimuth - HEADING) * Math.PI / 180;
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  const mel = 0.3, maz = -0.4;   // art-directed: the moon hangs front-left of the rock from the tee, so its path lies on the water
  moonDir.set(Math.sin(maz) * Math.cos(mel), Math.sin(mel), -Math.cos(maz) * Math.cos(mel)).normalize();
  look = lookFor(sp.elevation, weather);
  const night = THREE.MathUtils.smoothstep(-sp.elevation, 2, 9); // 0 day → 1 night
  look.nightK = night; look.elev = sp.elevation;
  hemi.color.copy(look.hemiS); hemi.groundColor.copy(look.hemiG); hemi.intensity = look.hemiI * 0.78 * (1 + night * 0.15) * (1 + Math.max(0, Math.min(1, 1 - sp.elevation / 12)) * 0.7 * (1 - night));
  if (night > 0.5) { sun.color.set(0xa4bcff); sun.intensity = 2.1 * (1 - weather.cloud / 170); W0.lightDir = moonDir; }
  else { sun.color.copy(look.sun); sun.intensity = Math.max(0.05, look.sunI * 0.8); W0.lightDir = sunDir; }
  const fogC = look.hor.clone();
  scene.fog.color.copy(fogC);
  // a marine layer: thick enough that the Rock looms as a soft shape at ~550 m, thin enough that the green (~345 m from
  // the tee) still reads as green under the flag
  const base = Math.min(0.0018, Math.max(0.00042, 1.4 / Math.max(300, weather.visibility)));
  scene.fog.density = THREE.MathUtils.lerp(base, 0.00185, weather.fogFactor * 0.85);
  renderer.toneMappingExposure = look.exp * (1 + night * 0.2);
  // grade: moonlight is desaturated with lifted blue shadows; bloom only catches the moon, lights and glints at night
  gradeState.sat = 1.12 - night * 0.36; gradeState.lift.set(0.004, 0.011, 0.03).multiplyScalar(night);
  // fill: opposite the key, warm at golden hour so the foreground reads gold rather than dark
  const low = night > 0.5 ? 0 : 1 - THREE.MathUtils.smoothstep(sp.elevation, 2, 22);
  // a low sun sits in or near the frame: less, tighter bloom so the trees and inlet beside it stay readable
  gradeState.bloomS = night > 0.5 ? 0.55 : 0.36 - low * 0.1; gradeState.bloomT = night > 0.5 ? 0.75 : 1.0 + low * 0.2; gradeState.bloomR = night > 0.5 ? 0.6 : 0.6 - low * 0.2;
  W0.low = low; W0.night = night;
  fill.position.set(-sunDir.x, 0.6, -sunDir.z).normalize().multiplyScalar(100); fill.target.position.set(0, 0, 0);
  if (night > 0.5) { fill.color.set(0x7c94cc); fill.intensity = 0.55; }
  else { fill.color.copy(look.hor).lerp(new THREE.Color(0xffc08a), low * 0.6); fill.intensity = 0.25 + low * 0.75; }
  W0.mist.uniforms.uCol.value.copy(look.hor).lerp(new THREE.Color(1, 1, 1), 0.35);
  const morning = night < 0.5 && sp.azimuth < 180 && sp.elevation < 22 ? 1 : 0;
  W0.mist.uniforms.uAmt.value = Math.max(weather.fogFactor * 0.85, morning * 0.55);
  W0.mist.group.visible = W0.mist.uniforms.uAmt.value > 0.02;
  W0.wisps.uniforms.uCol.value.copy(look.hor).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(night > 0.5 ? 0.35 : 1);
  const s = W0.sky.uniforms;
  s.uZen.value.copy(look.zen); s.uHor.value.copy(look.hor); s.uSunCol.value.copy(look.sun); s.uSunDir.value.copy(sunDir); s.uMoonDir.value.copy(moonDir);
  s.uNight.value = night; s.uCloud.value = look.cloud; s.uFog.value = look.fog;
  const w = W0.water.uniforms;
  w.uSunDir.value.copy(night > 0.5 ? moonDir : sunDir); w.uSunCol.value.copy(night > 0.5 ? new THREE.Color(0x9fb4ff) : look.sun);
  w.uSunI.value = night > 0.5 ? 0.75 * (1 - weather.cloud / 140) : look.sunI; w.uZen.value.copy(look.zen); w.uHor.value.copy(look.hor);
  // what the rock looks like in the bay's reflection: its sky-lit side, a touch of the key
  w.uRockCol.value.setRGB(0.34, 0.33, 0.31).multiply(hemi.color).multiplyScalar(hemi.intensity * 0.85).add(tmpC.copy(sun.color).multiplyScalar(Math.min(2, sun.intensity) * 0.05));
  w.uFogColor.value.copy(fogC); w.uFogDensity.value = scene.fog.density; w.uNight.value = night; w.uLow.value = night > 0.5 ? 0.7 : low;
  const ms = weather.windMph * 0.44704, wl = Math.hypot(weather.wind.x, weather.wind.z) || 1;
  const strength = Math.min(1.3, Math.max(0.15, ms / 8));
  windUniforms.uWind.value.set(weather.wind.x / wl * strength, weather.wind.z / wl * strength);
  windUniforms.uGust.value = 0.6 + Math.min(0.8, (weather.gustMph - weather.windMph) / 15);
  w.uWind.value.set(weather.wind.x / wl, weather.wind.z / wl); s.uWind.value.set(weather.wind.x / wl, weather.wind.z / wl); W0.wisps.uniforms.uWind.value.set(weather.wind.x / wl * Math.min(1.5, 0.3 + ms / 6), weather.wind.z / wl * Math.min(1.5, 0.3 + ms / 6));
  W0.flag.uniforms.uWind.value = Math.min(1.2, ms / 9);
  W0.gulls.visible = night < 0.5 && weather.fogFactor < 0.8;
  W0.ballMesh.material.emissive.set(night > 0.5 ? 0x9fe8e8 : 0x334044); W0.ballMesh.material.emissiveIntensity = night > 0.5 ? 1.4 : 0.25;
  // warm low sun: pull the rock and foliage back toward natural colours; distant trees fade into the haze
  tameUniforms.uTame.value = low * (1 - night); tameUniforms.uNightK.value = night; tameUniforms.uRelief.value = 1 - low * 0.45 - (night > 0.5 ? 0.4 : 0); tameUniforms.uAerial.value = night > 0.5 ? 0.12 : 0.22 + weather.fogFactor * 0.2;
  // light scattered through the canopy: warm at golden hour, cool and faint by moonlight
  leafUniforms.uLeafGlow.value.copy(sun.color).multiplyScalar(Math.min(2.5, sun.intensity) * (night > 0.5 ? 0.06 : 0.1 + low * 0.16));
  applyGrade();
  // HUD
  const clock = laClock(simDate);
  let phase = look.elev < -6 ? 'Moonlit night' : look.elev < 0 ? 'Twilight' : look.elev < 9 ? (sp.azimuth > 180 ? 'Golden hour' : 'Sunrise') : weather.fogFactor > 0.4 ? 'Marine layer' : sp.azimuth < 180 && look.elev < 30 ? 'Morning' : 'Daylight';
  if (weather.rain) phase = look.elev < -6 ? 'Rainy night' : 'Light rain';
  $('wx-text').textContent = `Morro Bay · ${weather.label.replace(/ \w+$/, '')} ${compass(weather.windFrom)} · ${Math.round(weather.tempF)}°F`;
  $('wx-live').textContent = weather.live ? 'Live' : 'Typical';
  $('wx-live').classList.toggle('off', !weather.live);
  $('time-text').textContent = `${phase} · ${clock} PT${timeOverride ? ' (preview)' : ''}`;
}

const gradeState = { sat: 1.12, lift: new V3(), bloomS: 0.36, bloomT: 1.0, bloomR: 0.6 };
function applyGrade() {
  if (!post) return;
  if (post.grade) { post.grade.uniforms.uSat.value = gradeState.sat; post.grade.uniforms.uLift.value.copy(gradeState.lift); }
  if (post.bloom) { post.bloom.strength = gradeState.bloomS; post.bloom.threshold = gradeState.bloomT; post.bloom.radius = gradeState.bloomR; }
}

// ---------- quality ----------
let tierChanges = 0;
function setQuality(level, persist = true) {
  if (level !== qLevel) tierChanges++;
  qLevel = level; const q = QUALITY[level];
  dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
  if (post) post.dispose();
  post = createPost(renderer, scene, camera, level, W, H, dpr); applyGrade();
  sun.shadow.mapSize.set(q.shadow, q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  if (W0.trees) W0.trees.userData.setQuality(level, q.treeNear);
  if (W0.rock) W0.rock.castShadow = q.rockShadow;
  lodView.force = true;
  leafUniforms.uRagged.value = level === 'low' ? 0 : 1;
  const cap = level[0].toUpperCase() + level.slice(1);
  $('q-label').textContent = qMode === 'auto' ? 'Auto' : cap; $('q-level').textContent = qMode === 'auto' ? ` · ${cap}` : '';
  if (persist) localStorage.setItem('cg-quality', qMode);
  resize();
}
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  camera.aspect = W / H; baseFov = W < H ? 62 : 48; if (G.state !== 'holed' && G.state !== 'end') camera.fov = baseFov; camera.updateProjectionMatrix();
  renderer.setSize(W, H, false); if (post) post.setSize(W, H);
  if (W0.trees) W0.trees.userData.frame(W < H);
  const focal = H / (2 * Math.tan(camera.fov * Math.PI / 360)) * (renderer.getPixelRatio() || 1);
  if (W0.parts) W0.parts.mat.uniforms.uScale.value = focal * 0.21; if (W0.wisps) W0.wisps.uniforms.uScale.value = focal * 0.42;
}
window.addEventListener('resize', resize);

// ---------- game state ----------
const ball = new Ball();
const G = { state: 'loading', strokes: 0, club: 'driver', manualClub: false, yaw: 0, putts: 0, longest: 0, penalties: 0, t: 0, timeScale: 1, hinted: false };
const cam = { pos: new V3(), look: new V3(), from: null, to: null, tt: 0, dur: 1, dir: new THREE.Vector2(0, -1) };
const cupPos = () => new V3(CUP.x, heightAt(CUP.x, CUP.z), CUP.z);
const distToCup = () => Math.hypot(ball.p.x - CUP.x, ball.p.z - CUP.z);
const yawTo = (x, z) => Math.atan2(x - ball.p.x, -(z - ball.p.z));

function autoClub() {
  if (ball.lie === 'green') return 'putter';
  const d = distToCup() * YD;
  // the wedge inside ~100 yd, and out of a bunker anywhere it can reach the green from
  if (d <= 100 || ball.lie === 'sand' && d <= 110) return 'wedge';
  return d > 180 && ball.lie !== 'sand' ? 'driver' : 'iron';
}
function setClub(c, manual = false) {
  G.club = c; G.manualClub = manual;
  for (const b of document.querySelectorAll('#clubs button')) b.setAttribute('aria-pressed', String(b.dataset.club === c));
}
function aimPose(club = G.club, yaw = G.yaw) {
  const putt = club === 'putter', p = ball.p;
  const dist = putt ? 3.4 : club === 'wedge' ? 6 : club === 'iron' ? 7 : 8.5, h = putt ? 1.2 : club === 'wedge' ? 2.1 : club === 'iron' ? 2.3 : 2.7;
  // off the (elevated) tee the camera stands back and a little higher, tipped down so the landing zone and its bunkers read
  const onTee = ball.lie === 'tee' && !putt, back = dist + (onTee ? 2.5 : 0);
  const dx = Math.sin(yaw), dz = -Math.cos(yaw);
  const cx = p.x - dx * back, cz = p.z - dz * back;
  const pos = new V3(cx, Math.max(p.y, heightAt(cx, cz) + 0.6, 0.6) + h + (onTee ? 1.2 : 0), cz);
  const ahead = putt ? Math.max(2.5, Math.min(7, distToCup())) : Math.min(130, Math.max(60, distToCup() * 0.6));
  const lx = p.x + dx * ahead, lz = p.z + dz * ahead;
  const lk = new V3(lx, putt ? heightAt(lx, lz) : Math.max(onTee ? 0 : p.y, heightAt(lx, lz)) + 2.2 + ahead * 0.012, lz);
  return { pos, look: lk };
}
function tweenTo(pose, dur) { cam.from = { pos: camera.position.clone(), look: cam.look.clone() }; cam.to = pose; cam.tt = 0; cam.dur = dur; }

function prepareShot(dur = 1.6) {
  G.yaw = yawTo(CUP.x, CUP.z);
  if (!G.manualClub) setClub(autoClub());
  G.manualClub = false;
  tweenTo(aimPose(), dur);
  G.state = 'aim';
  updateHud();
}
function resetHole() {
  ball.place(TEE.x, TEE.z); ball.p.y += 0.035;
  Object.assign(G, { strokes: 0, putts: 0, longest: 0, penalties: 0, manualClub: false, timeScale: 1, holeT0: null });
  W0.tracer.clear(); W0.tracer.fade = 0; W0.marker.visible = false; W0.aimLine.set([]);
  $('endcard').hidden = true; $('banner').hidden = true;
  updateHud();
}

function updateHud() {
  $('strokes').textContent = G.strokes;
  $('to-pin').textContent = `${yd(distToCup())} yd`;
  $('lie').textContent = SURF[ball.lie]?.label ?? 'Tee box';
}
let toastT = 0;
function toast(msg, ms = 1600) { const t = $('toast'); t.textContent = msg; t.hidden = false; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }

// ---------- shots ----------
function shoot(club, power, yaw) {
  if (G.state !== 'aim') return false;
  G.strokes++; if (club === 'putter') G.putts++;
  G.shotStart = { ...ball.p }; G.shotFromTee = ball.lie === 'tee'; G.cupCheck = false; G.slowmo = false; G.waterHandled = false;
  ball.lipped = false;
  ball.strike(club, power, yaw, weather.wind);
  audio.thwack(club, power);
  if (club !== 'putter') { const sandy = ball.lie === 'sand' || ball.lie === 'waste'; puff(W0.parts, ball.p, sandy ? 'sand' : 'grass', ball.lie === 'sand' ? 1.2 : sandy ? 0.8 : 0.5); }
  W0.tracer.clear(); W0.tracer.push(ball.p);
  W0.aimLine.set([]); W0.marker.visible = false; $('power').hidden = true;
  cam.dir.set(Math.sin(yaw), -Math.cos(yaw));
  cam.to = null;
  G.state = 'flight'; G.t = 0;
  if (!G.hinted) { G.hinted = true; $('hint').hidden = true; }
  updateHud();
  return true;
}

function handleEvents() {
  for (const e of ball.events) {
    if (e.type === 'impact') {
      if (e.speed > 2) puff(W0.parts, e.at, e.surf, Math.min(1.4, e.speed / 14));
      audio.thud(e.surf, e.speed);
      if (!G.landed) { G.landed = true; }
    } else if (e.type === 'water') {
      puff(W0.parts, { ...e.at, y: 0.05 }, 'water', 1.3); audio.splash();
      G.state = 'water'; G.t = 0; toast('Splash! +1 stroke · taking a drop', 1900);
    } else if (e.type === 'lip') {
      toast('Lip out!', 1200);
    } else if (e.type === 'holed') {
      holeOut();
    }
  }
  ball.events.length = 0;
}

function dropPoint() {
  // walk back toward where the shot started until we're on dry, playable ground
  const s = G.shotStart, p = ball.state === 'water' && ball.lastDry && ball.club !== CLUBS.putter ? ball.lastDry : ball.p;
  let x = p.x, z = p.z; const dx = s.x - x, dz = s.z - z, L = Math.hypot(dx, dz) || 1;
  for (let i = 0; i < 400; i++) {
    const surf = surfaceAt(x, z);
    if (surf !== 'water' && heightAt(x, z) > 0.4) break;
    x += dx / L; z += dz / L;
  }
  // two more metres back so the drop isn't on the bank
  for (let i = 0; i < 2; i++) { const nx = x + dx / L, nz = z + dz / L; if (Math.hypot(nx - s.x, nz - s.z) < Math.hypot(x - s.x, z - s.z)) { x = nx; z = nz; } }
  if (surfaceAt(x, z) === 'water') { x = s.x; z = s.z; }
  return { x, z };
}

const SCORE_NAMES = { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double bogey', 3: 'Triple bogey' };
function relText(n) { return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`; }
function holeOut() {
  G.state = 'holed'; G.t = 0; G.timeScale = 0.35; G.holeT0 = elapsed;
  cupShot(0); pinLay.set = false;
  audio.rattle();
  confetti(W0.parts, cupPos(), W0.night);
  const rel = G.strokes - PAR;
  const name = G.strokes === 1 ? 'Hole in one!' : (SCORE_NAMES[rel] ?? `${relText(rel)}`);
  $('banner-title').textContent = 'Hole out!';
  $('banner-sub').textContent = `${name} · ${G.strokes} stroke${G.strokes === 1 ? '' : 's'}`;
  $('banner').hidden = false;
  updateHud();
}
function showEnd() {
  G.state = 'end'; if (G.holeT0 == null) G.holeT0 = elapsed - 3.2;
  const rel = G.strokes - PAR;
  $('banner').hidden = true;
  $('end-name').textContent = G.strokes === 1 ? 'Hole in one' : (SCORE_NAMES[rel] ?? relText(rel));
  $('end-score').textContent = relText(rel);
  $('end-detail').textContent = `${G.strokes} stroke${G.strokes === 1 ? '' : 's'} on a par ${PAR} · ${HOLE_YD} yd`;
  $('end-stats').innerHTML = `<div><b>${G.longest ? yd(G.longest) : '–'}</b><span>Longest drive (yd)</span></div><div><b>${G.putts}</b><span>Putts</span></div><div><b>${G.penalties}</b><span>Penalties</span></div>`;
  $('end-cond').textContent = `${weather.label} wind · ${Math.round(weather.tempF)}°F · ${$('time-text').textContent}`;
  $('endcard').hidden = false;
}

function shareText() {
  const rel = G.strokes - PAR, s = rel === 0 ? 'even par' : relText(rel);
  return `I shot ${s} at Morro Rock on Tyler's course ⛳`;
}
async function share() {
  const url = location.href.split('?')[0], text = shareText();
  if (navigator.share) { try { await navigator.share({ title: 'Coastline Golf · Morro Rock', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  const full = `${text} ${url}`;
  try { await navigator.clipboard.writeText(full); toast('Copied to clipboard'); }
  catch { const ta = document.createElement('textarea'); ta.value = full; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied to clipboard'); } catch { toast(full, 4000); } ta.remove(); }
}

// ---------- flyover ----------
// a cinematic reveal: in over the bay past the Rock, a slow arc around the green with the flag held in frame, then a
// rising pull-back down the fairway that lands exactly on the tee camera. Position and look target are keyed to the
// same times and run through clamped cubic splines in time (C2: no jumps in velocity or acceleration, still at both
// ends), so the view never whips around or wobbles, whatever the frame rate.
const fly = { path: null, dur: 0, t: 0, endT: -1e9 };
// clamped cubic spline through (ts[i], ys[i]) with zero end velocity: the second derivatives at the knots
function splineM(ts, ys) {
  const n = ts.length, h = [], a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n), d = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) h.push(ts[i + 1] - ts[i]);
  b[0] = 2 * h[0]; c[0] = h[0]; d[0] = 6 * (ys[1] - ys[0]) / h[0];
  a[n - 1] = h[n - 2]; b[n - 1] = 2 * h[n - 2]; d[n - 1] = -6 * (ys[n - 1] - ys[n - 2]) / h[n - 2];
  for (let i = 1; i < n - 1; i++) { a[i] = h[i - 1]; b[i] = 2 * (h[i - 1] + h[i]); c[i] = h[i]; d[i] = 6 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]); }
  for (let i = 1; i < n; i++) { const w = a[i] / b[i - 1]; b[i] -= w * c[i - 1]; d[i] -= w * d[i - 1]; }   // Thomas algorithm
  const M = new Float64Array(n); M[n - 1] = d[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) M[i] = (d[i] - c[i] * M[i + 1]) / b[i];
  return M;
}
// keys: [t, x, y, z, lookX, lookY, lookZ]
function keyPath(keys) {
  const ts = keys.map((k) => k[0]), ch = [];
  for (let j = 1; j < 7; j++) { const ys = keys.map((k) => k[j]); ch.push([ys, splineM(ts, ys)]); }
  return (t, pos, look) => {
    t = Math.max(ts[0], Math.min(ts[ts.length - 1], t));
    let i = 0; while (i < ts.length - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], A = (ts[i + 1] - t) / h, B = 1 - A, ca = (A * A * A - A) * h * h / 6, cb = (B * B * B - B) * h * h / 6;
    const v = ch.map(([ys, M]) => A * ys[i] + B * ys[i + 1] + ca * M[i] + cb * M[i + 1]);
    pos.set(v[0], v[1], v[2]); look.set(v[3], v[4], v[5]);
  };
}
function buildFlyover() {
  G.yaw = yawTo(CUP.x, CUP.z);
  const end = aimPose('driver', G.yaw), e = end.pos, l = end.look;
  const c = cupPos(), R = ROCK, k = 0.9;   // k: overall pace (seconds per key-time unit)
  // the heading only ever turns one way (from the Rock round to the fairway), the view tips down once onto the green
  // and levels out once at the tee, and the camera slows to ~25 m/s while it arcs round the flag 50 m out, 10 m+ above the dunes
  const keys = [
    [0.0, -360, 22, -470, R.x, 68, R.z],
    [2.4, -255, 26, -240, R.x + 30, 44, R.z + 70],   // 75 m+ clear of the Rock's western flank
    [4.4, -90, 22, -108, c.x - 2, 3, c.z - 2],
    [5.7, -34, 16, -110, c.x, c.y, c.z],
    [7.1, -8, 19, -84, c.x + 1, c.y + 1, c.z - 6],
    [8.8, 15, 32, 62, 8, 4, -96],
    [10.6, e.x, e.y, e.z, l.x, l.y, l.z],
  ].map(([t, ...r]) => [t * k, ...r]);
  fly.path = keyPath(keys); fly.dur = keys[keys.length - 1][0];
}
function startFlyover() {
  buildFlyover();
  G.state = 'flyover'; fly.t = 0;
  $('flytitle').hidden = false; $('flytitle').classList.add('show');
}
function endFlyover(quick) {
  fly.endT = performance.now();
  perf.frames = 0; perf.t0 = fly.endT;   // auto quality starts judging the frame rate only now (see trackPerf)
  $('flytitle').hidden = true;
  G.yaw = yawTo(CUP.x, CUP.z); setClub(autoClub());
  tweenTo(aimPose(), quick ? 0.9 : 1.4);
  G.state = 'aim'; $('hud').hidden = false;
  if (!G.hinted) $('hint').hidden = false;
  updateHud();
}

// ---------- input ----------
const drag = { on: false, x0: 0, y0: 0, x: 0, y: 0, id: null };
function dragShot() {
  const dx = drag.x - drag.x0, dy = drag.y - drag.y0, len = Math.hypot(dx, dy);
  const scale = 0.34 * Math.min(W, H);
  const power = Math.min(1, len / scale);
  if (dy < 4 || len < 14) return null;               // need to pull back (down)
  const off = Math.max(-1.05, Math.min(1.05, Math.atan2(-dx, dy)));
  const k = G.club === 'putter' ? 0.32 : 0.45;
  return { power, yaw: G.yaw + off * k };
}
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (G.state === 'flyover') { endFlyover(true); return; }
  if (G.state !== 'aim') return;
  if (!G.hinted) { G.hinted = true; $('hint').hidden = true; }
  drag.on = true; drag.id = e.pointerId; drag.x0 = drag.x = e.clientX; drag.y0 = drag.y = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
  $('dragdot').style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; $('dragdot').hidden = false;
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag.on || e.pointerId !== drag.id) return;
  drag.x = e.clientX; drag.y = e.clientY; updateAim();
});
const endDrag = (fire) => (e) => {
  if (!drag.on || e.pointerId !== drag.id) return;
  drag.on = false; $('dragdot').hidden = true; $('pull').hidden = true;
  const s = dragShot();
  if (fire && s && s.power > 0.04) shoot(G.club, s.power, s.yaw);
  else { W0.aimLine.set([]); W0.marker.visible = false; $('power').hidden = true; }
};
canvas.addEventListener('pointerup', endDrag(true));
canvas.addEventListener('pointercancel', endDrag(false));
let aimCache = 0;
function updateAim() {
  const s = dragShot();
  const pull = $('pull');
  if (!s) { W0.aimLine.set([]); W0.marker.visible = false; $('power').hidden = true; pull.hidden = true; return; }
  // rubber band from touch-down to finger
  const dx = drag.x - drag.x0, dy = drag.y - drag.y0;
  pull.hidden = false; pull.style.transform = `translate(${drag.x0}px, ${drag.y0}px) rotate(${Math.atan2(dy, dx)}rad)`; pull.style.width = `${Math.hypot(dx, dy)}px`;
  $('power').hidden = false; $('power-fill').style.transform = `scaleX(${s.power})`;
  let len, land;
  if (G.club === 'putter') {
    const v = CLUBS.putter.vmax * Math.pow(s.power, 1.6); len = Math.min(40, v * v / (2 * SURF.green.roll));
    $('power-label').textContent = `${Math.round(s.power * 100)}% · ~${Math.round(len * 3.28)} ft`;
    const dx2 = Math.sin(s.yaw), dz2 = -Math.cos(s.yaw); land = { x: ball.p.x + dx2 * len, z: ball.p.z + dz2 * len };
  } else {
    const now = performance.now();
    if (now - aimCache > 40 || !G.lastPred) { aimCache = now; G.lastPred = predict(ball.p, ball.lie, G.club, s.power, s.yaw, { x: 0, z: 0 }); }
    const cp = G.lastPred.carryPt || G.lastPred.end; len = Math.hypot(cp.x - ball.p.x, cp.z - ball.p.z);
    land = { x: ball.p.x + Math.sin(s.yaw) * len, z: ball.p.z - Math.cos(s.yaw) * len };
    $('power-label').textContent = `${CLUBS[G.club].name} · ${Math.round(s.power * 100)}% · carry ${yd(len)} yd`;
  }
  W0.aimLine.set(groundLine(ball.p, s.yaw, len, G.club === 'putter' ? 0.25 : Math.max(0.5, len / 150)));
  W0.marker.visible = true; W0.marker.position.set(land.x, Math.max(0.05, heightAt(land.x, land.z)) + 0.08, land.z);
}
for (const b of document.querySelectorAll('#clubs button')) b.addEventListener('click', () => { if (G.state !== 'aim') return; setClub(b.dataset.club, true); tweenTo(aimPose(), 0.6); });
window.addEventListener('keydown', (e) => {
  if (G.state === 'aim' && !cam.to) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { G.yaw += (e.key === 'ArrowLeft' ? -1 : 1) * (G.club === 'putter' ? 0.01 : 0.02); tweenTo(aimPose(), 0.12); }
    const k = { 1: 'driver', 2: 'iron', 3: 'wedge', 4: 'putter' }[e.key]; if (k) { setClub(k, true); tweenTo(aimPose(), 0.6); }
  }
  if (e.key === 'Escape') { $('info').hidden = true; }
});

// UI buttons
const syncSound = () => { $('btn-sound').setAttribute('aria-pressed', String(!audio.muted)); $('btn-sound').setAttribute('aria-label', audio.muted ? 'Sound off' : 'Sound on'); $('snd-on').style.display = audio.muted ? 'none' : ''; $('snd-off').style.display = audio.muted ? '' : 'none'; };
$('btn-sound').addEventListener('click', () => { audio.unlock(); audio.setMuted(!audio.muted); syncSound(); });
syncSound();
$('btn-quality').addEventListener('click', () => {
  const order = ['auto', 'high', 'med', 'low']; qMode = order[(order.indexOf(qMode) + 1) % 4];
  setQuality(qMode === 'auto' ? autoStart : qMode); perf.locked = false; perf.frames = 0; perf.t0 = performance.now();
  toast(`Graphics: ${$('q-label').textContent}${$('q-level').textContent}`, 1100);
});
const openInfo = () => { $('info').hidden = false; };
$('btn-info').addEventListener('click', openInfo); $('end-info').addEventListener('click', openInfo);
$('info-close').addEventListener('click', () => { $('info').hidden = true; });
$('info').addEventListener('click', (e) => { if (e.target === $('info')) $('info').hidden = true; });
$('end-share').addEventListener('click', share);
$('end-replay').addEventListener('click', () => { resetHole(); prepareShot(1.2); $('hint').hidden = G.hinted; });
$('start').addEventListener('click', () => {
  audio.unlock();
  $('loader').classList.add('gone'); setTimeout(() => { $('loader').hidden = true; }, 700);
  if (params.has('nofly')) { endFlyover(true); } else startFlyover();
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------- adaptive quality ----------
const perf = { frames: 0, t0: 0, fps: 60, locked: false, history: [], upd: 0, ren: 0 };
function trackPerf(now) {
  if (!perf.t0) perf.t0 = now;
  perf.frames++;
  const el = now - perf.t0;
  if (el >= 2500) {
    perf.fps = perf.frames * 1000 / el; perf.history.push(Math.round(perf.fps)); perf.frames = 0; perf.t0 = now;
    // never during the intro: a tier change resizes the canvas and rebuilds the post chain and trees, a visible hitch
    if (qMode === 'auto' && !document.hidden && ['aim', 'flight', 'settle'].includes(G.state) && !perf.locked) {
      if (perf.fps < 48 && qLevel !== 'low') { setQuality(qLevel === 'high' ? 'med' : 'low'); perf.frames = 0; perf.t0 = performance.now(); }
      else if (perf.fps > 57) perf.locked = true;   // settled
    }
  }
}

// ---------- frame loop ----------
function logIntro(now, rdt) {
  const L = window.__golf.introLog, p = camera.position, d = camera.getWorldDirection(new V3());
  if (L.length < 5000) L.push({ now, rdt, t: fly.t, s: G.state, p: [p.x, p.y, p.z], d: [d.x, d.y, d.z], fov: camera.fov, q: qLevel, dpr: renderer.getPixelRatio(), w: W, h: H });
}
const tmp = new V3(), pinV = new V3(), shU = new V3(), shV = new V3(), UP = new V3(0, 1, 0);
const ray = new THREE.Raycaster(), DOWN = new V3(0, -1, 0);
let restKey = '', restOff = 0;
function meshOffset() {
  // the visual mesh is a coarser sample of the analytic ground: sit the resting ball on what you can see
  const key = `${ball.p.x.toFixed(3)},${ball.p.z.toFixed(3)}`;
  if (key === restKey) return restOff;
  restKey = key; ray.set(tmp.set(ball.p.x, 400, ball.p.z), DOWN); ray.far = 1000;
  const hit = ray.intersectObjects(W0.ground, false)[0];
  restOff = hit ? Math.max(-0.25, Math.min(0.25, hit.point.y - heightAt(ball.p.x, ball.p.z))) : 0;
  return restOff;
}
// distance LOD for trees and scatter: repacked when the camera has moved a few metres or turned, at most ~8 times a second
const lodView = { x: 1e9, z: 1e9, fx: 0, fz: -1, t: 0, force: true };
function updateLod(rdt) {
  lodView.t += rdt;
  const f = camera.getWorldDirection(tmp), fl = Math.hypot(f.x, f.z) || 1, fx = f.x / fl, fz = f.z / fl, p = camera.position;
  const moved = Math.hypot(p.x - lodView.x, p.z - lodView.z), turned = fx * lodView.fx + fz * lodView.fz;
  if (!lodView.force && (lodView.t < 0.12 || moved < 3 && turned > 0.97)) return;
  Object.assign(lodView, { x: p.x, z: p.z, fx, fz, t: 0, force: false });
  const q = QUALITY[qLevel];
  for (const [k, m] of Object.entries(W0.scatter)) m.userData.lod(p.x, p.z, fx, fz, q[k], q.near * W0.reach[k], q.far * W0.reach[k]);
  W0.trees.userData.update(p.x, p.z, fx, fz);
}
let last = performance.now(), elapsed = 0, lookTimer = 0;
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.state !== 'loading') trackPerf(now);
  const a = performance.now(); update(rdt); const b = performance.now(); renderer.info.reset(); post.render(); const c = performance.now();
  if (TEST && (G.state === 'flyover' || now - fly.endT < 1600)) logIntro(now, rdt);
  perf.upd = perf.upd * 0.95 + (b - a) * 0.05; perf.ren = perf.ren * 0.95 + (c - b) * 0.05;
}
function update(rdt) {
  const dt = rdt * G.timeScale; elapsed += rdt;
  windUniforms.uTime.value = elapsed; W0.water.uniforms.uTime.value = elapsed; W0.sky.uniforms.uTime.value = elapsed; W0.flag.uniforms.uTime.value = elapsed;
  W0.gulls.userData.update(elapsed); W0.boats.userData.update(elapsed);
  W0.wisps.uniforms.uTime.value = elapsed; W0.mist.uniforms.uTime.value = elapsed;
  // the pin is pulled on hole-out so the flagstick never blocks the celebration shot
  updatePinPose(rdt);
  // rim light: strongest when looking toward a low sun (or the moon, cooler and softer)
  { const f = camera.getWorldDirection(tmp), ld = W0.lightDir, k = Math.max(0, (f.x * ld.x + f.z * ld.z) / (Math.hypot(ld.x, ld.z) || 1));
    const amt = W0.night > 0.5 ? (0.1 + k * k * 0.6) * 0.45 : (0.12 + k * k * 0.9) * (0.3 + W0.low);
    rimUniforms.uRimCol.value.copy(sun.color).multiplyScalar(amt * Math.min(1.2, sun.intensity)); rimUniforms.uRimK.value = 1; }
  W0.bmat.color.setRGB(4 * (0.25 + 0.75 * (Math.sin(elapsed * 2.2) > 0.6 ? 1 : 0.15)), 0.25, 0.2);
  lookTimer += rdt; if (lookTimer > 30) { lookTimer = 0; applyLook(); }

  // physics
  if (G.state === 'flight' || G.state === 'holed' && ball.state !== 'holed') {
    const n = Math.ceil(dt / (1 / 240));
    for (let i = 0; i < n; i++) ball.step(dt / n);
    if (ball.state === 'flight') W0.tracer.push(ball.p);
    handleEvents();
  }
  if (G.state === 'flight') {
    G.t += dt;
    // cup-drop slow motion: peek ahead once the ball is rolling close to the hole
    if (ball.state === 'roll' && !G.cupCheck && distToCup() < 3.2) {
      G.cupCheck = true;
      const b = new Ball(); b.p = { ...ball.p }; b.v = { ...ball.v }; b.state = 'roll'; b.club = ball.club; b.wind = ball.wind; b.t = ball.t; b.rollT = ball.rollT; b.bounces = ball.bounces; b.lipped = true;
      for (let i = 0; i < 960 && b.state === 'roll'; i++) b.step(1 / 240);
      if (b.state === 'holed') { G.slowmo = true; G.timeScale = 0.38; }
    }
    if (ball.state === 'rest') {
      const d = Math.hypot(ball.p.x - G.shotStart.x, ball.p.z - G.shotStart.z);
      if (ball.club === CLUBS.driver && d > G.longest) G.longest = d;
      if (ball.club !== CLUBS.putter) toast(`${yd(d)} yd · ${SURF[ball.lie].label}`, 1500);
      else if (distToCup() < 1) toast(`${Math.round(distToCup() * 3.28 * 12)} in. away`, 1200);
      G.state = 'settle'; G.t = 0; W0.tracer.fadeOut = true; updateHud();
    }
  } else if (G.state === 'settle') {
    G.t += rdt; if (G.t > 0.9) { if (G.strokes >= 10) { G.strokes = 10; holeOutPickup(); } else prepareShot(1.6); }
  } else if (G.state === 'water') {
    G.t += rdt;
    if (G.t > 1.5) { const d = dropPoint(); G.strokes++; G.penalties++; ball.place(d.x, d.z); W0.tracer.fadeOut = true; prepareShot(1.2); toast('Drop · next shot is your ' + ordinal(G.strokes + 1), 1600); }
  } else if (G.state === 'holed') {
    G.t += rdt; if (G.t > 0.9) G.timeScale = Math.min(1, G.timeScale + rdt);
    if (G.t > 3.2) showEnd();
  }
  W0.parts.update(dt);
  if (W0.rain) {
    const P = W0.rainPos, c = camera.position, wx = weather.wind.x * 0.06, wz = weather.wind.z * 0.06, fall = 14 * rdt;
    for (let i = 0; i < P.length; i += 6) {
      let y = P[i + 1] - fall; let x = P[i] + wx * fall, z = P[i + 2] + wz * fall;
      if (y < c.y - 12 || Math.abs(x - c.x) > 35 || Math.abs(z - c.z) > 35) { x = c.x + (Math.random() - 0.5) * 70; z = c.z + (Math.random() - 0.5) * 70; y = c.y + 8 + Math.random() * 25; }
      P[i] = x; P[i + 1] = y; P[i + 2] = z; P[i + 3] = x - wx * 0.6; P[i + 4] = y - 0.55; P[i + 5] = z - wz * 0.6;
    }
    W0.rain.geometry.attributes.position.needsUpdate = true;
  }
  if (W0.tracer.fadeOut) { W0.tracer.fade = Math.max(0, W0.tracer.fade - rdt * 0.5); if (W0.tracer.fade === 0) { W0.tracer.fadeOut = false; W0.tracer.clear(); W0.tracer.fade = 0; } }

  // camera
  updateCamera(rdt, dt);
  camera.updateMatrixWorld();

  // ball visual: real-size up close, a little larger far away so it stays readable
  const bm = W0.ballMesh, bd = camera.position.distanceTo(tmp.set(ball.p.x, ball.p.y, ball.p.z));
  const holedK = ball.state === 'holed' ? Math.min(1, G.t / 0.35) : 0;
  const r = Math.max(BALL_R * (1.5 + holedK * 0.9), bd * 0.0045);
  bm.scale.setScalar(r); bm.position.set(ball.p.x, ball.p.y - BALL_R + r * (ball.state === 'flight' ? 1 : 0.92) + (ball.state === 'rest' ? meshOffset() : 0), ball.p.z);
  bm.visible = ball.state !== 'holed' && ball.state !== 'water' || G.state === 'flight';
  if (ball.state === 'holed') {
    const c = cupPos(), k = Math.min(1, G.t / 0.18);
    // drops in and stays nestled in the cup with its crown showing, so the hero shot reads "ball in the hole"
    bm.visible = true;
    bm.position.x += (c.x - bm.position.x) * k; bm.position.z += (c.z - bm.position.z) * k;
    bm.position.y += (c.y + 0.025 - r * 0.05 - bm.position.y) * Math.min(1, G.t / 0.3);
  }
  const onPeg = ball.lie === 'tee' && ball.state === 'rest' && G.strokes === 0;
  W0.peg.visible = onPeg; if (onPeg) { W0.peg.scale.setScalar(r * 0.42); W0.peg.position.set(ball.p.x, bm.position.y - r * 0.98, ball.p.z); }

  // shadow camera follows the action
  // snapped to whole shadow-map texels across the light's view, so a moving camera doesn't make shadow edges crawl
  const f = G.state === 'flyover' ? cam.look : tmp.set(ball.p.x, ball.p.y, ball.p.z), ld = W0.lightDir, sc = sun.shadow.camera;
  const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
  shU.crossVectors(UP, ld); if (shU.lengthSq() < 1e-6) shU.set(1, 0, 0); shU.normalize(); shV.crossVectors(ld, shU);
  const su = Math.round(f.dot(shU) / texel) * texel, sv = Math.round(f.dot(shV) / texel) * texel, sd = f.dot(ld);
  sun.target.position.copy(shU).multiplyScalar(su).addScaledVector(shV, sv).addScaledVector(ld, sd);
  sun.position.copy(sun.target.position).addScaledVector(ld, 400); sun.target.updateMatrixWorld();

  W0.tracer.update(camera); W0.aimLine.update(camera, false);
  if (W0.marker.visible) W0.marker.scale.setScalar(Math.max(0.5, camera.position.distanceTo(W0.marker.position) * 0.028));

  updatePin();
  updateWindArrow();
  updateLod(rdt);
}

// the pin: on a hole-out it is lifted out and laid on the green just behind the cup, like a caddie would, clear of the
// cup, the banner and the Rock. In play it is drawn larger with distance so it reads from the tee.
const pinQ = new THREE.Quaternion(), pinLay = { pos: new V3(), q: new THREE.Quaternion(), set: false };
const pinMat = new THREE.Matrix4(), pinX = new V3(), pinY = new V3(), pinZ = new V3(0, 1, 0);
function layPin() {
  // laid just behind the cup and running steeply away to the left (foreshortened, inside a portrait frame and clear of
  // the banner on the right); the cloth rests a little proud of the turf, angled toward the camera so its "1" shows
  const c = cupPos(), fx = Math.sin(cup.psi), fz = -Math.cos(cup.psi), rx = -fz, rz = fx;
  const dx = -rx * 0.45 + fx * 0.9, dz = -rz * 0.45 + fz * 0.9;
  const bx = c.x + fx * 0.75 - rx * 0.4, bz = c.z + fz * 0.75 - rz * 0.4;
  const y = (heightAt(bx, bz) + heightAt(bx + dx * 2.4, bz + dz * 2.4)) / 2 - c.y + 0.045;
  pinLay.pos.set(bx - c.x, y, bz - c.z);
  pinY.set(dx, 0, dz).normalize(); pinX.set(pinY.z, 0, -pinY.x); if (pinX.x * fx + pinX.z * fz < 0) pinX.negate();
  pinX.multiplyScalar(Math.cos(0.6)).addScaledVector(pinZ.set(0, 1, 0), Math.sin(0.6)); pinZ.crossVectors(pinX, pinY);
  pinMat.makeBasis(pinX, pinY, pinZ); pinLay.q.setFromRotationMatrix(pinMat);
  pinLay.set = true;
}
function updatePinPose(rdt) {
  const pin = W0.flag.pin, ud = pin.userData, out = G.state === 'holed' || G.state === 'end';
  ud.pull = out ? Math.min(1, (ud.pull || 0) + rdt * 1.6) : 0;
  W0.flag.uniforms.uLie.value = ud.pull > 0.45 ? 1 : 0;
  if (!out) {
    pinLay.set = false; pin.quaternion.identity(); pin.position.set(0, 0, 0);
    const d = Math.hypot(camera.position.x - CUP.x, camera.position.z - CUP.z);
    const k = Math.min(3, Math.max(1, 1 + (d - 70) / 110));
    pin.scale.setScalar(k); W0.flag.pole.scale.set(k, 1, k);   // the pole thickens a little more, so it stays a visible line
    return;
  }
  if (!pinLay.set) { if (cup.psi === undefined) cupShot(0); layPin(); }
  pin.scale.setScalar(1); W0.flag.pole.scale.set(1, 1, 1);
  const up = Math.min(1, ud.pull / 0.3), lay = ease(Math.max(0, (ud.pull - 0.3) / 0.7));
  pin.position.set(0, up * 0.9, 0).lerp(pinLay.pos, lay); pin.position.y += Math.sin(lay * Math.PI) * 0.5;
  pin.quaternion.slerpQuaternions(pinQ.identity(), pinLay.q, lay);
}

function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'); }
function holeOutPickup() {
  G.state = 'end'; $('end-name').textContent = 'Picked up';
  showEnd(); $('end-name').textContent = 'Picked up';
}

function updateCamera(rdt, dt) {
  if (G.state !== 'holed' && G.state !== 'end') lens(baseFov, damp(4, rdt));
  if (cam.free) { camera.position.set(cam.free[0], cam.free[1], cam.free[2]); camera.lookAt(cam.free[3], cam.free[4], cam.free[5]); return; }
  if (G.state === 'flyover') {
    fly.t += rdt;
    fly.path(fly.t, camera.position, cam.look); camera.lookAt(cam.look);
    if (fly.t > fly.dur) endFlyover(false);
    return;
  }
  if (cam.to) {
    cam.tt += rdt; const u = ease(Math.min(1, cam.tt / cam.dur));
    camera.position.lerpVectors(cam.from.pos, cam.to.pos, u); cam.look.lerpVectors(cam.from.look, cam.to.look, u);
    camera.lookAt(cam.look);
    if (cam.tt >= cam.dur) cam.to = null;
    return;
  }
  const p = ball.p;
  if (G.state === 'flight' || G.state === 'water' || G.state === 'holed') {
    if (G.state === 'holed') {
      cupShot(elapsed - G.holeT0);
      camera.position.lerp(cup.pos, damp(3, rdt)); cam.look.lerp(cup.look, damp(4, rdt)); lens(cup.fov, damp(3, rdt));
      camera.position.y = Math.max(camera.position.y, heightAt(camera.position.x, camera.position.z) + 0.25, 0.4);
      camera.lookAt(cam.look); keepSummit();
      return;
    } else if (G.slowmo) {
      // low and off to the side so the cup sits left of centre and the flagstick never blocks the drop
      const c = cupPos(), d = cam.dir, px = -d.y, pz = d.x;
      camera.position.lerp(tmp.set(c.x - d.x * 1.8 + px * 0.9, c.y + 0.34, c.z - d.y * 1.8 + pz * 0.9), damp(4, rdt));
      cam.look.lerp(tmp.set(c.x - px * 0.55, c.y + 0.12, c.z - pz * 0.55), damp(5, rdt));
    } else if (G.state === 'flight') {
      const hv = Math.hypot(ball.v.x, ball.v.z);
      if (hv > 0.5) { cam.dir.lerp(new THREE.Vector2(ball.v.x / hv, ball.v.z / hv), damp(2, rdt)).normalize(); }
      const putt = ball.club === CLUBS.putter, rolling = ball.state === 'roll';
      const back = putt ? 3.4 : rolling ? 10 : 16, up = putt ? 1.2 : rolling ? 3.5 : 5;
      const side = putt ? 0 : rolling ? 2.5 : 7;
      const want = new V3(p.x - cam.dir.x * back - cam.dir.y * side, 0, p.z - cam.dir.y * back + cam.dir.x * side);
      want.y = Math.max(p.y + up, heightAt(want.x, want.z) + 1.2, 1.2);
      camera.position.lerp(want, damp(putt ? 3 : 2.2, rdt));
      cam.look.lerp(tmp.set(p.x, p.y, p.z), damp(9, rdt));
    }
    camera.position.y = Math.max(camera.position.y, heightAt(camera.position.x, camera.position.z) + 0.25, 0.4);
    camera.lookAt(cam.look);
    return;
  }
  if (G.state === 'end') {
    cupShot(elapsed - G.holeT0);
    camera.position.lerp(cup.pos, damp(1.5, rdt)); cam.look.lerp(cup.look, damp(2, rdt)); lens(cup.fov, damp(2, rdt)); camera.lookAt(cam.look); keepSummit();
    return;
  }
  camera.lookAt(cam.look);
}

// hole-out hero framing. The Rock's summit is ~38 deg above the horizon from the green, so no normal lens can hold
// both it and the cup: solve for the lens. The cup sits in the lower-left third, the summit upper-right with sky above,
// the field of view is whatever puts both there (wide at first, narrowing as the camera pushes out and rises).
const SUMMIT = new V3(), rockSpan = { mid: 0 };
// the point of the Rock's outline that stands highest in view from p (the near shoulder of the dome, not the true summit),
// and the azimuth of the middle of its upper flanks so the whole massif can be centred
function rockTop(p) {
  let best = -1, lo = 9, hi = -9; const a0 = Math.atan2(ROCK.x - p.x, -(ROCK.z - p.z));
  for (const q of W0.crest) {
    const e = (q.y - p.y) / Math.hypot(q.x - p.x, q.z - p.z); if (e > best) { best = e; SUMMIT.copy(q); }
    const a = Math.atan2(q.x - p.x, -(q.z - p.z)) - a0; if (a < lo) lo = a; if (a > hi) hi = a;
  }
  SUMMIT.y += 4; rockSpan.mid = a0 + (lo + hi) / 2;
}
const cup = { pos: new V3(), look: new V3(), fov: 60, psi: undefined };
const heroFrame = () => camera.aspect < 1
  ? { cx: -0.4, cy: -0.4, sx: 0.04, sy: 0.5, maxT: 1.35 }       // portrait: cup above the bottom HUD, summit below the top chips
  : { cx: -0.44, cy: -0.42, sx: 0.1, sy: 0.78, maxT: 1.0 };
function cupShot(t) {
  const c = cupPos(), f = heroFrame(), asp = camera.aspect, te = Math.max(0, t - 3.2);
  const hd = 2.3 + Math.min(t, 3.2) * 0.12 + Math.min(te, 14) * 0.32, h = 0.62 + Math.min(t, 3.2) * 0.03 + Math.min(te, 14) * 0.07;
  rockTop(cup.pos.lengthSq() ? cup.pos : c);
  let T = Math.tan(cup.fov * Math.PI / 360), psi = 0, p = 0, cyaw = rockSpan.mid;
  const P = cup.pos;
  for (let k = 0; k < 5; k++) {
    P.set(c.x - Math.sin(cyaw) * hd, c.y + h, c.z + Math.cos(cyaw) * hd);
    // vertical angles of the Rock's top and the cup in the camera's forward plane
    const azS = Math.atan2(SUMMIT.x - P.x, -(SUMMIT.z - P.z)), dS = Math.hypot(SUMMIT.x - P.x, SUMMIT.z - P.z);
    const thS = Math.atan2(SUMMIT.y - P.y, dS * Math.cos(azS - psi)), thC = Math.atan2(c.y - P.y, hd * Math.cos(cyaw - psi));
    // tan(thS - p) = sy*T and tan(thC - p) = cy*T  ->  bisect T; past maxT the top may climb to 0.93, then the cup drops
    let lo = 0.2, hi = f.maxT;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (Math.atan(f.sy * m) - Math.atan(f.cy * m) < thS - thC) lo = m; else hi = m; }
    T = (lo + hi) / 2; p = Math.max(thC - Math.atan(f.cy * T), thS - Math.atan(0.93 * T));
    const phM = Math.atan(f.sx * T * asp * Math.cos(thS - p) / Math.cos(thS)), phC = Math.atan(f.cx * T * asp * Math.cos(thC - p) / Math.cos(thC));
    psi = rockSpan.mid + te * 0.006 - phM; cyaw = psi + phC;
  }
  P.set(c.x - Math.sin(cyaw) * hd, c.y + h, c.z + Math.cos(cyaw) * hd);
  cup.fov = Math.atan(T) * 360 / Math.PI; cup.psi = psi;
  cup.look.set(P.x + Math.sin(psi) * Math.cos(p) * 10, P.y + Math.sin(p) * 10, P.z - Math.cos(psi) * Math.cos(p) * 10);
}
// the camera and lens ease into the hero pose, and part-way there the lens can be too tight for the Rock: widen it
// whenever the top of the Rock (seen from where the camera really is) would leave the frame, with a little sky above
function keepSummit() {
  rockTop(camera.position); camera.updateMatrixWorld();
  const v = tmp.copy(SUMMIT).applyMatrix4(camera.matrixWorldInverse); if (v.z >= -1) return;
  const need = v.y / -v.z / 0.9;
  if (need > Math.tan(camera.fov * Math.PI / 360)) { camera.fov = Math.min(110, Math.atan(need) * 360 / Math.PI); camera.updateProjectionMatrix(); }
}
function lens(fov, k) { if (Math.abs(camera.fov - fov) > 0.01) { camera.fov += (fov - camera.fov) * k; camera.updateProjectionMatrix(); } }

function updatePin() {
  const el = $('pin');
  if (!['aim', 'settle'].includes(G.state) || ball.lie === 'green' && distToCup() < 12) { el.hidden = true; return; }
  pinV.set(CUP.x, heightAt(CUP.x, CUP.z) + 2.75 * W0.flag.pin.scale.y, CUP.z).project(camera);   // just above the (distance-scaled) flag
  if (pinV.z > 1 || Math.abs(pinV.x) > 1.05 || Math.abs(pinV.y) > 1.05) { el.hidden = true; return; }
  el.hidden = false;
  el.style.transform = `translate(${(pinV.x * 0.5 + 0.5) * W}px, ${(-pinV.y * 0.5 + 0.5) * H}px)`;
  $('pin-yd').textContent = `${yd(distToCup())} yd`;
}
function updateWindArrow() {
  const fwd = camera.getWorldDirection(tmp);
  const camYaw = Math.atan2(fwd.x, -fwd.z), windYaw = Math.atan2(weather.wind.x, -weather.wind.z);
  $('wind-arrow').style.transform = `rotate(${windYaw - camYaw}rad)`;
}

// ---------- test hooks ----------
if (TEST) {
  window.__golf = {
    get state() { return G.state; }, get strokes() { return G.strokes; }, get ball() { return { ...ball.p, state: ball.state, lie: ball.lie }; },
    get fps() { return perf.fps; }, get fpsHistory() { return perf.history.slice(); }, get frameMs() { return { update: +perf.upd.toFixed(2), render: +perf.ren.toFixed(2) }; }, info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles }), get quality() { return qLevel; }, get tierChanges() { return tierChanges; }, autoStart, get weather() { return weather; }, errors,
    get yaw() { return G.yaw; }, get club() { return G.club; }, W0, camera, renderer, scene,
    hole: { par: PAR, yd: HOLE_YD, m: HOLE_M },
    surfaceAt, autoClub: () => autoClub(),
    // put the ball down anywhere and set up the shot (auto club) as if it had come to rest there
    place: (x, z) => { ball.place(x, z); G.manualClub = false; prepareShot(0.2); cam.tt = cam.dur; return { lie: ball.lie, club: G.club }; },
    // a windless shot from (x, z) with a given lie: carry / total / roll in yards
    sim: (club, power, x, z, lie) => {
      const b = new Ball(); b.place(x, z); if (lie) b.lie = lie; b.strike(club, power, 0, { x: 0, z: 0 });
      for (let i = 0; i < 240 * 60 && (b.state === 'flight' || b.state === 'roll'); i++) b.step(1 / 240);
      const tot = Math.hypot(b.p.x - x, b.p.z - z);
      return { carry: b.carry * YD, total: tot * YD, roll: (tot - b.carry) * YD, end: surfaceAt(b.p.x, b.p.z), x: b.p.x, z: b.p.z };
    },
    // the green's own geometry and a ball released at (x, z) with a tiny nudge: does gravity alone carry it off?
    green: GREEN, greenDist,
    settle: (x, z) => {
      const b = new Ball(); b.place(x, z); b.lie = 'green'; b.club = CLUBS.putter; b.wind = { x: 0, z: 0 }; b.t = 0; b.rollT = 0; b.v.x = 0.001; b.state = 'roll';
      for (let i = 0; i < 240 * 30 && b.state === 'roll'; i++) b.step(1 / 240);
      return { end: surfaceAt(b.p.x, b.p.z), moved: Math.hypot(b.p.x - x, b.p.z - z) };
    },
    shoot: (club, power, angleDeg = 0) => { if (club) setClub(club, true); return shoot(G.club, power, G.yaw + angleDeg * Math.PI / 180); },
    freeCam: (...a) => { cam.free = a.length ? a : null; update(1 / 30); post.render(); },
    advance: (sec, step = 1 / 30) => { for (let t = 0; t < sec; t += step) update(step); post.render(); },
    flyAt: (sec) => { fly.t = sec; },
    // the intro path sampled at n even time steps: [x, y, z, lookX, lookY, lookZ, ground height under the camera]
    flyPath: (n = 240) => {
      if (!fly.path) buildFlyover();
      const p = new V3(), l = new V3(), pts = [];
      for (let i = 0; i <= n; i++) { fly.path(fly.dur * i / n, p, l); pts.push([p.x, p.y, p.z, l.x, l.y, l.z, heightAt(p.x, p.z)]); }
      return { dur: fly.dur, pts, cup: cupPos() };
    },
    // what the camera actually did, frame by frame, while the intro played (see frame())
    introLog: [],
    skip: () => { if (G.state === 'flyover') endFlyover(true); },
    finishMove: () => { if (cam.to) { cam.tt = cam.dur; } },
    placeNearCup: (d = 0.9) => {
      const a = Math.atan2(TEE.x - CUP.x, TEE.z - CUP.z);
      ball.place(CUP.x + Math.sin(a) * d, CUP.z + Math.cos(a) * d); prepareShot(0.3); setClub('putter', true); tweenTo(aimPose(), 0.3);
    },
    forceHoleOut: () => {
      window.__golf.placeNearCup(0.8);
      setTimeout(() => { cam.to = null; G.state = 'aim'; shoot('putter', 0.42, yawTo(CUP.x, CUP.z)); }, 400);
    },
  };
}
window.addEventListener('error', (e) => errors.push(String(e.message)));

// ---------- boot ----------
(async () => {
  try {
    await build();
    resetHole();
    G.state = 'ready';
    $('start').disabled = false; $('start').textContent = 'Tap to tee off';
    $('load-step').textContent = weather.live ? `Live: ${weather.label}, ${Math.round(weather.tempF)}°F in Morro Bay` : 'Weather offline · using typical Morro Bay conditions';
    renderer.setAnimationLoop(frame);
    if (params.has('autostart')) $('start').click();
  } catch (e) {
    console.error(e); errors.push(String(e));
    $('load-step').textContent = 'Something went wrong loading the course. WebGL 2 is required.';
  }
})();
