// Coastline Golf · Morro Rock / Bishop Peak / Pismo Pier (the active map is chosen in maps/index.js)
import * as THREE from 'three';
import { TEE, CUP, GREEN, PAR, HOLE_M, HOLE_YD, ROCK, STACKS, BOUNDS, HEADING, MAP_ID, WATER_LEVEL, BUNKERS, heightAt, surfaceAt, greenDist, normalAt, fairwayDist } from './course.js';
import { MAP, MAPS, MAP_KEYS, HOLE_NO, rememberMap } from './maps/index.js';
import * as bishop from './maps/bishop.js';
import * as pismo from './maps/pismo.js';
import * as sensorio from './maps/sensorio.js';
import { createSensorioScene } from './sensorio-scene.js';
import { landColor, createBackdrop, createBishopKnobs, createCerroM, createMadonnaInn, createInnSign, createDryGrass, createChaparral, createGranite, createFarOaks } from './bishop-scene.js';
import { sunPosition, sceneDate, laClock, lookFor } from './sun.js';
import { getWeather, compass, windVector } from './weather.js';
import { createSky } from './sky.js';
import { createWater } from './water.js';
import { createTerrain, createHills, bakeDepth, TERRAIN_TIME, pismoSandTransect } from './terrain.js';
import { createStacks, createFlag, createTeeMarkers, createTeePeg, createBall, createGulls } from './props.js';
import { createRock } from './rock.js';
import { windUniforms, leafUniforms, createGrass, createTrees, createShrubs, createFlowers, createIcePlant, createBeachRocks, createDriftwood, lodScatter } from './vegetation.js';
import { createBoats, createWisps, createMist } from './atmos.js';
import { rimUniforms, tameUniforms } from './noise.js';
import { Ball, BALL_R, CLUBS, SURF, DT, predict, flatPuttDist } from './physics.js';
import { Ribbon, groundLine, createMarker, Particles, puff, confetti } from './fx.js';
import { QUALITY, createPost } from './post.js';
import { createPismoScene, setPismoNight, PIER_AXIS } from './pismo-scene.js';
import { plantGrass, plantIce, plantScrub, plantStats, townTreeSpots, createPismoBackdrop } from './pismo-veg.js';
import { Audio } from './audio.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const BISHOP = MAP_ID === 'bishop';
// every non-Bishop map is a coastal one (ocean, surf, gulls, coastal planting); only Morro Rock has the Rock, its stacks,
// beacons, wisps and boats. Pismo Pier is coastal without them.
const PISMO = MAP_ID === 'pismo', HAS_ROCK = MAP_ID === 'morro';
// Field of Light (Sensorio, Paso Robles): inland, no sea, no Rock; it rides the coastal code paths with its water hidden
const SENSORIO = MAP_ID === 'sensorio';
// the landmark the hero shots frame: Morro Rock, Bishop Peak's summit knobs, or the Oceano dunes behind the Pismo green
const FOCUS = BISHOP ? bishop.LM.bishop : SENSORIO ? { x: GREEN.x, z: GREEN.z - 60 } : PISMO ? { x: GREEN.x - 40, z: GREEN.z - 110 } : ROCK;
// the first shot's aim point when the cup is round a corner
const AIM_VIA = BISHOP ? bishop.AIM_VIA : PISMO ? pismo.AIM_VIA : null;
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
const camera = new THREE.PerspectiveCamera(50, 1, 0.15, BISHOP ? 16000 : 6000);
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

// the pieces the Morro Rock bay has and Bishop Peak does not (boats, stack wisps, gulls, mist, beacons) are inert stand-ins there
const inert = () => { const g = new THREE.Group(); g.userData.update = () => {}; return g; };
async function build() {
  const weatherP = getWeather(params, MAP);
  await loadStep('Shaping the ' + (BISHOP ? 'valley' : 'coastline'), 0.1);
  const big = !touch;
  // mesh detail follows the tier the game starts on (built once; a later tier change keeps these meshes)
  const L = QUALITY[qLevel], ts = qLevel === 'high' && touch ? [230, 238, 70, 205, 90, 75] : L.terrain;
  if (BISHOP) await bishop.loadHeights();
  const depthTex = bakeDepth(512, HAS_ROCK);
  const patches = BISHOP
    ? { corridor: { minX: -50, maxX: 235, minZ: -125, maxZ: 330 }, green: { minX: GREEN.x - 32, maxX: GREEN.x + 32, minZ: GREEN.z - 28, maxZ: GREEN.z + 30 } }
    : SENSORIO ? { corridor: { minX: Math.min(TEE.x, GREEN.x) - 40, maxX: Math.max(TEE.x, GREEN.x) + 40, minZ: GREEN.z - 30, maxZ: TEE.z + 25 }, green: { minX: GREEN.x - 32, maxX: GREEN.x + 32, minZ: GREEN.z - 28, maxZ: GREEN.z + 30 } }
    : PISMO ? { corridor: { minX: -95, maxX: 65, minZ: -548, maxZ: -10 }, green: { minX: GREEN.x - 32, maxX: GREEN.x + 32, minZ: GREEN.z - 28, maxZ: GREEN.z + 30 } }
    : { corridor: { minX: -60, maxX: 80, minZ: -178, maxZ: 232 }, green: { minX: -28, maxX: 32, minZ: -165, maxZ: -115 } };
  const style = BISHOP ? 'inland' : PISMO ? 'pismo' : 'coast';   // Sensorio: green coastal grass for now (job 40 restyles the field)
  // Bishop's outer ground is mostly rough beyond the corridor patch (the real hills carry the detail): a lighter grid
  const tk = BISHOP ? 0.76 : 1;
  const baseColor = BISHOP ? landColor : null;
  const terrain = createTerrain({ segX: Math.round(ts[0] * tk), segZ: Math.round(ts[1] * tk), paintRes: big ? 1024 : 768, warp: true, style, baseColor });
  scene.add(terrain.mesh);
  const corridor = createTerrain({ segX: ts[2], segZ: ts[3], paint: terrain.paint, offset: 1, bounds: patches.corridor, style, baseColor });
  const greenPatch = createTerrain({ segX: ts[4], segZ: ts[5], paint: terrain.paint, offset: 2, bounds: patches.green, style, baseColor });
  corridor.mesh.receiveShadow = greenPatch.mesh.receiveShadow = true;
  scene.add(corridor.mesh, greenPatch.mesh);
  W0.ground = [greenPatch.mesh, corridor.mesh, terrain.mesh];
  if (BISHOP) {
    // a small murky pond instead of the bay: the same water shader, calmed, in valley colours
    W0.water = createWater({ depthTex, bounds: BOUNDS, segments: L.water > 100 ? 40 : 20, size: 120 });
    const P = bishop.POND; W0.water.mesh.position.set(P.x, WATER_LEVEL, P.z);
    const u = W0.water.uniforms; u.uSurf.value = 0; u.uCalm.value = 0.28; u.uRock.value.set(1e5, 1e5, 1, 1); u.uRockH.value = 1;
    u.uDeep.value.set('#1c3a2c'); u.uMid.value.set('#2d5a3c'); u.uShallow.value.set('#58804a'); u.uSandy.value.set('#8a9358');
  } else W0.water = createWater({ depthTex, bounds: BOUNDS, segments: qLevel === 'high' && touch ? 110 : L.water });
  if (SENSORIO) W0.water.mesh.visible = false;   // no sea or pond at Sensorio
  if (PISMO) {
    // a wider surf zone of rolling white-water lines from the WNW swell, and a little foam round the pier pilings
    const u = W0.water.uniforms; u.uBreak.value = 1; u.uPier.value.set(PIER_AXIS.ax, PIER_AXIS.az, PIER_AXIS.bx, PIER_AXIS.bz);
  }
  scene.add(W0.water.mesh);
  W0.sky = createSky(); scene.add(W0.sky.mesh);
  if (BISHOP) {
    W0.backdrop = createBackdrop(qLevel === 'high' && !touch ? 'high' : qLevel === 'low' ? 'low' : 'med'); scene.add(W0.backdrop);
    scene.add(createFarOaks(qLevel === 'high' ? (touch ? 2400 : 5000) : qLevel === 'med' ? 1700 : 1000, W0.backdrop.userData.surfaceY, qLevel === 'low' ? 0 : qLevel === 'high' && !touch ? 600 : 260));
  } else if (PISMO) { W0.backdrop = createPismoBackdrop(); scene.add(W0.backdrop); } else if (!SENSORIO) scene.add(createHills());
  await loadStep(BISHOP ? 'Raising Bishop Peak' : SENSORIO ? 'Lighting the Field of Light' : PISMO ? 'Raising the Oceano Dunes' : 'Raising Morro Rock', 0.35);
  if (BISHOP) {
    const knobs = createBishopKnobs(qLevel === 'high' && !touch ? 2 : 1); W0.crest = knobs.userData.crest; W0.rock = knobs; scene.add(knobs);
    const sy = W0.backdrop.userData.surfaceY;
    W0.cerroM = createCerroM(sy); scene.add(W0.cerroM); W0.inn = createMadonnaInn(sy); scene.add(W0.inn); W0.innSign = createInnSign(sy); scene.add(W0.innSign);
    W0.boats = inert(); W0.mist = { group: new THREE.Group(), uniforms: { uCol: { value: new THREE.Color() }, uAmt: { value: 0 }, uTime: { value: 0 } } };
    W0.wisps = { points: new THREE.Group(), uniforms: { uCol: { value: new THREE.Color() }, uWind: { value: new THREE.Vector2() }, uTime: { value: 0 }, uScale: { value: 0 } } };
    W0.bmat = { color: new THREE.Color() };
  } else if (SENSORIO) {
    // no Rock, sea, wisps or boats: the scene dressing (the sphere field) lives in sensorio-scene.js; the hero framing reads
    // the hill behind the green as its "crest"
    const ss = createSensorioScene(qLevel); scene.add(ss); W0.sensorioInfo = ss.userData.info;
    W0.crest = [];
    for (let x = GREEN.x - 120; x <= GREEN.x + 120; x += 10) for (let z = GREEN.z - 220; z <= GREEN.z - 60; z += 10) W0.crest.push(new V3(x, heightAt(x, z), z));
    W0.rock = null; W0.boats = inert();
    W0.wisps = { points: new THREE.Group(), uniforms: { uCol: { value: new THREE.Color() }, uWind: { value: new THREE.Vector2() }, uTime: { value: 0 }, uScale: { value: 0 } } };
    W0.mist = { group: new THREE.Group(), uniforms: { uCol: { value: new THREE.Color() }, uAmt: { value: 0 }, uTime: { value: 0 } } };
    W0.bmat = { color: new THREE.Color() };
  } else if (PISMO) {
    // no Rock, stacks, beacons, wisps or boats; the hero framing reads the dune ridge behind the green as its "crest".
    // the pier, the PISMO BEACH arch, the town by the pier and the lifeguard towers (pismo-scene.js)
    const ps = createPismoScene(qLevel); scene.add(ps); W0.pismoInfo = ps.userData.info;
    W0.crest = [];
    for (let x = GREEN.x - 160; x <= GREEN.x + 80; x += 8) for (let z = GREEN.z - 200; z <= GREEN.z - 60; z += 8) { const y = heightAt(x, z); if (y > 18) W0.crest.push(new V3(x, y, z)); }
    W0.rock = null; W0.boats = inert();
    W0.wisps = { points: new THREE.Group(), uniforms: { uCol: { value: new THREE.Color() }, uWind: { value: new THREE.Vector2() }, uTime: { value: 0 }, uScale: { value: 0 } } };
    W0.mist = createMist(depthTex, BOUNDS); scene.add(W0.mist.group);
    W0.bmat = { color: new THREE.Color() };
  } else {
    const rock = createRock(qLevel === 'high' && touch ? 'med' : L.rock); W0.crest = rock.userData.crest; W0.rock = rock.children[0]; scene.add(rock); scene.add(createStacks());
    W0.boats = createBoats(); scene.add(W0.boats);
    W0.wisps = createWisps(touch ? 45 : 70); scene.add(W0.wisps.points);
    W0.mist = createMist(depthTex, BOUNDS); scene.add(W0.mist.group);
    // aviation beacons on the stacks
    const bmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2), fog: false });
    W0.beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(1.4, 8, 6), bmat, STACKS.length * 2);
    STACKS.forEach(([x, z], i) => { for (const [j, y, r] of [[0, 137.5, 1], [1, 72, 0.8]]) W0.beacons.setMatrixAt(i * 2 + j, new THREE.Matrix4().compose(new V3(x, heightAt(x, z) + y, z), new THREE.Quaternion(), new V3(r, r, r))); });
    scene.add(W0.beacons); W0.bmat = bmat;
  }
  W0.flag = createFlag(); scene.add(W0.flag.group);
  scene.add(createTeeMarkers());
  W0.peg = createTeePeg(); scene.add(W0.peg);
  if (BISHOP || SENSORIO) W0.gulls = inert(); else { W0.gulls = createGulls(touch ? 7 : 11); }
  scene.add(W0.gulls);
  await loadStep(BISHOP ? 'Planting oaks and golden grass' : 'Planting cypress and dune grass', 0.55);
  // scatter is thinned by distance from the camera every few metres it moves (see updateLod); reach: how far each kind
  // carries relative to the tier's near/far distances (bigger plants stay visible further out)
  if (BISHOP) {
    W0.scatter = { grass: createDryGrass(touch ? 9000 : 20000, touch ? 650 : 1000), rocks: createGranite(touch ? 240 : 420), shrubs: createChaparral(touch ? 700 : 1100, W0.backdrop.userData.surfaceY) };
    W0.reach = { grass: 1, rocks: 1.8, shrubs: 1.8 };
  } else if (SENSORIO) {
    W0.scatter = { grass: createGrass(touch ? 6000 : 12000, touch ? 650 : 1000) };
    W0.reach = { grass: 1 };
  } else if (PISMO) {
    // the shared coastal instancers re-planted on Pismo's dunes (pismo-veg.js); no beach rocks or meadow flowers on this sand
    const ng = touch ? 9000 : 20000, ni = touch ? 1400 : 2600, ns = touch ? 700 : 1100;
    W0.scatter = { grass: plantGrass(createGrass(ng, 0), ng), ice: plantIce(createIcePlant(ni), ni), shrubs: plantScrub(createShrubs(ns), ns), drift: createDriftwood(40) };
    W0.reach = { grass: 1, ice: 1.4, shrubs: 1.7, drift: 1.6 };
  } else {
    W0.scatter = { grass: createGrass(touch ? 9000 : 20000, touch ? 650 : 1000), flowers: createFlowers(touch ? 2600 : 5000), ice: createIcePlant(touch ? 1400 : 2600), rocks: createBeachRocks(touch ? 260 : 420), drift: createDriftwood(40), shrubs: createShrubs(touch ? 700 : 1100) };
    W0.reach = { grass: 1, flowers: 0.8, ice: 1.4, rocks: 1.6, drift: 1.6, shrubs: 1.7 };
  }
  for (const m of Object.values(W0.scatter)) { lodScatter(m); scene.add(m); }
  W0.trees = createTrees(qLevel, PISMO ? townTreeSpots() : SENSORIO ? sensorio.OAKS.map((t, i) => ({ kind: 'oak', x: t.x, z: t.z, sc: t.sc, pri: i })) : null); scene.add(W0.trees);
  // ball, effects
  W0.ballMesh = createBall(); scene.add(W0.ballMesh);
  W0.tracer = new Ribbon(260, 0xf2fbfa, 0.6, 0.003, 0.016); scene.add(W0.tracer.mesh);
  W0.aimLine = new Ribbon(200, 0xe1f5f3, 0.7, 0.0022, 0.03); scene.add(W0.aimLine.mesh);
  W0.marker = createMarker(); scene.add(W0.marker);
  // putting break grid: short dashes on a lattice over the green that drift down the fall line (longer + faster = steeper)
  { const pts = [];
    for (let x = GREEN.x - GREEN.rx; x <= GREEN.x + GREEN.rx; x += 1.6) for (let z = GREEN.z - GREEN.rz; z <= GREEN.z + GREEN.rz; z += 1.6) {
      if (greenDist(x, z) > -1.4) continue;
      const n = normalAt(x, z), sl = Math.hypot(n.x, n.z) / n.y, l = Math.hypot(n.x, n.z) || 1;
      pts.push({ x, z, dx: n.x / l, dz: n.z / l, sl, ph: Math.random() });
    }
    // tapered dash: wide uphill end (-x) narrowing to a point downhill (+x) so the direction reads in a still frame
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.055, -0.5, 0, 0.055, 0.5, 0, 0], 3));
    const m = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, fog: false }), pts.length);
    m.frustumCulled = false; m.visible = false; m.renderOrder = 3; scene.add(m); W0.grid = { mesh: m, pts, on: true };
  }
  W0.parts = new Particles(900); scene.add(W0.parts.points);
  await loadStep(`Reading ${MAP.place} weather`, 0.75);
  weather = await weatherP;
  if (weather.rain) {
    const n = touch ? 900 : 1800, pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = (Math.random() - 0.5) * 70, y = Math.random() * 40, z = (Math.random() - 0.5) * 70; pos.set([x, y, z, x, y - 0.5, z], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    W0.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.35, depthWrite: false }));
    W0.rain.frustumCulled = false; W0.rainPos = pos; scene.add(W0.rain);
  }
  await loadStep('Lighting the scene', 0.9);
  const sd = sceneDate(params.get('time') || (SENSORIO ? 'dusk' : null));   // the Field of Light is played at dusk unless ?time= says otherwise simDate = sd.date; timeOverride = sd.override;
  applyLook();
  resize();
  setQuality(qLevel, false);
  if (BISHOP) camera.position.set(-120, 60, 120); else if (PISMO) camera.position.set(140, 50, 80); else if (SENSORIO) camera.position.set(TEE.x - 60, TEE.h + 60, TEE.z + 120); else camera.position.set(-260, 60, -470);
  camera.lookAt(FOCUS.x, 60, FOCUS.z);
  renderer.compile(scene, camera);
  post.render();
  await loadStep('Ready', 1);
}
// par and yardage come from the course itself (centre-line length, tee -> dogleg corner -> cup)
$('hole-text').textContent = `Hole ${HOLE_NO} · ${MAP.name} · Par ${PAR} · ${HOLE_YD} yd`;
$('fly-sub').textContent = `Par ${PAR} · ${HOLE_YD} yd · ${MAP.cap}`;
if (MAP_ID !== 'morro') {
  document.title = `Coastline Golf · ${MAP.name}`; $('scene').setAttribute('aria-label', BISHOP ? '3D golf hole below Bishop Peak, San Luis Obispo' : SENSORIO ? "3D par 3 across Bruce Munro's Field of Light at Sensorio, Paso Robles" : '3D golf hole down Pismo State Beach from the Pismo Pier to the Oceano Dunes');
  document.querySelector('#flytitle h2').textContent = MAP.name; document.querySelector('#loader h1').textContent = `Hole ${HOLE_NO} · ${MAP.name}`;
  document.querySelector('#loader .sub').textContent = MAP.loaderSub; document.querySelector('#endcard .eyebrow').textContent = `Hole ${HOLE_NO} · ${MAP.name}`;
  document.getElementById('info-wx').innerHTML = `<b>Open-Meteo live weather</b> for ${MAP.place}: real wind pushes your ball, visibility thickens the ${BISHOP ? 'valley' : SENSORIO ? 'hill' : 'sea'} haze, cloud cover greys the sky.`;
  document.getElementById('info-sun').innerHTML = `<b>The real sun</b>: solar position over ${MAP.place} at the current California time sets the light, from morning haze to golden hour to moonlight.`;
  document.getElementById('info-map').hidden = false; document.getElementById('info-map').innerHTML = SENSORIO ? '<b>Real-world mapping</b>: the hole is laid out true to scale on the rolling hills of Sensorio, east of Paso Robles, from OpenStreetMap and real elevation data. Field of Light by Bruce Munro, at Sensorio, Paso Robles.<br><small>Installation outline and paths © OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles (USGS 3DEP/SRTM).</small>' : PISMO ? '<b>Real-world mapping</b>: the hole runs from the Pismo Beach Pier down Pismo State Beach, across the Pismo Creek mouth, to the Oceano Dunes, laid out from OpenStreetMap and real elevation data (the beach between is shortened ~8x along the shore).<br><small>Pier outline, buildings and shoreline © OpenStreetMap contributors (ODbL); elevation: AWS Terrain Tiles (USGS 3DEP/SRTM).</small>' : '<b>Real-world mapping</b>: Bishop Peak, Cerro San Luis Obispo (and its "M"), the Madonna Inn and the Nine Sisters stand at their true bearings and distances, on real elevation data (Mapzen Terrain Tiles / AWS Open Data, including USGS 3DEP and SRTM).';
}

// ---------- light, sky, fog from real time + weather ----------
const sunDir = new V3(), moonDir = new V3(), tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
function applyLook() {
  if (!timeOverride) simDate = new Date();
  const sp = sunPosition(simDate, MAP.lat, MAP.lon), el = sp.elevation * Math.PI / 180, az = (sp.azimuth - HEADING) * Math.PI / 180;
  sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
  const mel = 0.3, maz = -0.4;   // art-directed: the moon hangs front-left of the rock from the tee, so its path lies on the water
  moonDir.set(Math.sin(maz) * Math.cos(mel), Math.sin(mel), -Math.cos(maz) * Math.cos(mel)).normalize();
  look = lookFor(sp.elevation, weather);
  const night = THREE.MathUtils.smoothstep(-sp.elevation, 2, 9); // 0 day → 1 night
  look.nightK = night; look.elev = sp.elevation;
  if (PISMO) setPismoNight(night);
  if (BISHOP && night < 0.5) {
    // inland valley: a natural Central Coast sky, a clean blue overhead and a pale, dusty haze low over the hills instead of
    // the coast's purple band; the weather's grey still comes through (cloud and fog are already mixed into look)
    const keep = Math.min(0.9, look.cloud * 0.5 + look.fog * 0.8), low = 1 - THREE.MathUtils.smoothstep(sp.elevation, 4, 25);
    look.zen.lerp(tmpC.set('#5f93cc'), 0.7 * (1 - keep)); look.hor.lerp(tmpC.set('#e3e2d6').lerp(tmpC2.set('#efdcb6'), low * 0.6), 0.65 * (1 - keep));
  }
  hemi.color.copy(look.hemiS); hemi.groundColor.copy(look.hemiG); hemi.intensity = look.hemiI * 0.78 * (1 + night * 0.15) * (1 + Math.max(0, Math.min(1, 1 - sp.elevation / 12)) * 0.7 * (1 - night));
  if (night > 0.5) { sun.color.set(0xa4bcff); sun.intensity = 2.1 * (1 - weather.cloud / 170); W0.lightDir = moonDir; }
  else { sun.color.copy(look.sun); sun.intensity = Math.max(0.05, look.sunI * 0.8); W0.lightDir = sunDir; }
  if (BISHOP && night < 0.5) {
    // the inland valley at a low sun: keep the warmth but not the coast's deep orange, so dry grass reads golden-tan, not rust
    const low0 = 1 - THREE.MathUtils.smoothstep(sp.elevation, 3, 24);
    sun.color.lerp(tmpC.set('#ffe9d0'), 0.7 * low0); hemi.groundColor.lerp(tmpC.set('#66645a'), 0.6 * low0); hemi.color.lerp(tmpC.set('#b8cce4'), 0.45 * low0);
    W0.bishopLow = low0;
  }
  const fogC = look.hor.clone();
  scene.fog.color.copy(fogC);
  // a marine layer: thick enough that the Rock looms as a soft shape at ~550 m, thin enough that the green (~345 m from
  // the tee) still reads as green under the flag
  const base = Math.min(0.0018, Math.max(0.00042, 1.4 / Math.max(300, weather.visibility)));
  scene.fog.density = THREE.MathUtils.lerp(base * MAP.fogScale, 0.00185, weather.fogFactor * 0.85);
  renderer.toneMappingExposure = look.exp * (1 + night * 0.2);
  // grade: moonlight is desaturated with lifted blue shadows; bloom only catches the moon, lights and glints at night
  gradeState.sat = (BISHOP ? 1.04 : 1.12) - night * 0.36; gradeState.lift.set(0.004, 0.011, 0.03).multiplyScalar(night);
  // fill: opposite the key, warm at golden hour so the foreground reads gold rather than dark
  const low = night > 0.5 ? 0 : 1 - THREE.MathUtils.smoothstep(sp.elevation, 2, 22);
  // a low sun sits in or near the frame: less, tighter bloom so the trees and inlet beside it stay readable
  gradeState.bloomS = night > 0.5 ? 0.55 : 0.36 - low * 0.1; gradeState.bloomT = night > 0.5 ? 0.75 : 1.0 + low * 0.2; gradeState.bloomR = night > 0.5 ? 0.6 : 0.6 - low * 0.2;
  W0.low = low; W0.night = night;
  fill.position.set(-sunDir.x, 0.6, -sunDir.z).normalize().multiplyScalar(100); fill.target.position.set(0, 0, 0);
  if (night > 0.5) { fill.color.set(0x7c94cc); fill.intensity = 0.55; }
  else { fill.color.copy(look.hor).lerp(new THREE.Color(0xffc08a), low * 0.6); fill.intensity = 0.25 + low * 0.75; }
  if (BISHOP && night < 0.5) { fill.color.lerp(tmpC.set('#d4dae0'), 0.6); fill.intensity = 0.25 + low * 0.35; }
  W0.mist.uniforms.uCol.value.copy(look.hor).lerp(new THREE.Color(1, 1, 1), 0.35);
  const morning = night < 0.5 && sp.azimuth < 180 && sp.elevation < 22 ? 1 : 0;
  W0.mist.uniforms.uAmt.value = Math.max(weather.fogFactor * 0.85, morning * 0.55);
  W0.mist.group.visible = !BISHOP && W0.mist.uniforms.uAmt.value > 0.02;
  W0.wisps.uniforms.uCol.value.copy(look.hor).lerp(new THREE.Color(1, 1, 1), 0.5).multiplyScalar(night > 0.5 ? 0.35 : 1);
  const s = W0.sky.uniforms;
  s.uZen.value.copy(look.zen); s.uHor.value.copy(look.hor); s.uSunCol.value.copy(look.sun); s.uSunDir.value.copy(sunDir); s.uMoonDir.value.copy(moonDir);
  s.uNight.value = night; s.uCloud.value = look.cloud; s.uFog.value = look.fog;
  // the inland sky: blue reaches lower and the low sun warms the horizon, not the whole sun-side dome (no purple wash)
  if (BISHOP) { s.uWarm.value = 0.3; s.uHorPow.value = 6.0; }
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
  tameUniforms.uTame.value = low * (1 - night); tameUniforms.uNightK.value = night; tameUniforms.uRelief.value = 1 - low * 0.45 - (night > 0.5 ? 0.4 : 0); tameUniforms.uAerial.value = night > 0.5 ? 0.12 : (BISHOP ? 0.07 : 0.22) + weather.fogFactor * 0.2;   // Bishop's pale valley haze would bleach the oaks
  // light scattered through the canopy: warm at golden hour, cool and faint by moonlight
  leafUniforms.uLeafGlow.value.copy(sun.color).multiplyScalar(Math.min(2.5, sun.intensity) * (night > 0.5 ? 0.06 : 0.1 + low * 0.16));
  applyGrade();
  // HUD
  const clock = laClock(simDate);
  let phase = look.elev < -6 ? 'Moonlit night' : look.elev < 0 ? 'Twilight' : look.elev < 9 ? (sp.azimuth > 180 ? 'Golden hour' : 'Sunrise') : weather.fogFactor > 0.4 ? 'Marine layer' : sp.azimuth < 180 && look.elev < 30 ? 'Morning' : 'Daylight';
  if (weather.rain) phase = look.elev < -6 ? 'Rainy night' : 'Light rain';
  $('wx-text').textContent = `${MAP.place} · ${weather.label.replace(/ \w+$/, '')} ${compass(weather.windFrom)} · ${Math.round(weather.tempF)}°F`;
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
const G = { preview: false, pvSpot: null, pvZoom: 1, lastPower: 1, state: 'loading', strokes: 0, club: 'driver', manualClub: false, yaw: 0, putts: 0, longest: 0, penalties: 0, t: 0, timeScale: 1, hinted: false, curve: 0 };
const cam = { pos: new V3(), look: new V3(), from: null, to: null, tt: 0, dur: 1, dir: new THREE.Vector2(0, -1) };
const cupPos = () => new V3(CUP.x, heightAt(CUP.x, CUP.z), CUP.z);
const distToCup = () => Math.hypot(ball.p.x - CUP.x, ball.p.z - CUP.z);
const yawTo = (x, z) => Math.atan2(x - ball.p.x, -(z - ball.p.z));
// where a fresh shot is aimed: at the cup, except on a dogleg where the cup is out of sight round the corner
const aimYaw = () => (AIM_VIA && distToCup() > AIM_VIA.until && ball.p.z > AIM_VIA.z + 40 ? yawTo(AIM_VIA.x, AIM_VIA.z) : yawTo(CUP.x, CUP.z));

function autoClub() {
  if (ball.lie === 'green') return 'putter';
  const d = distToCup() * YD;
  // the wedge inside ~100 yd, and out of a bunker anywhere it can reach the green from
  if (d <= 100 || ball.lie === 'sand' && d <= 110) return 'wedge';
  if (d > 180 && ball.lie !== 'sand') return ball.lie === 'tee' ? 'driver' : d > 200 ? 'wood' : 'iron';
  return 'iron';
}
function setClub(c, manual = false) {
  G.club = c; G.manualClub = manual;
  for (const b of document.querySelectorAll('#clubs button[data-club]')) b.setAttribute('aria-pressed', String(b.dataset.club === c));
}
function aimPose(club = G.club, yaw = G.yaw) {
  const putt = club === 'putter', p = ball.p;
  const dist = putt ? 3.4 : club === 'wedge' ? 6 : club === 'iron' ? 7 : club === 'wood' ? 7.8 : 8.5, h = putt ? 1.2 : club === 'wedge' ? 2.1 : club === 'iron' ? 2.3 : club === 'wood' ? 2.5 : 2.7;
  // off the (elevated) tee the camera stands back and a little higher, tipped down so the landing zone and its bunkers read
  const onTee = ball.lie === 'tee' && !putt, back = dist + (onTee ? 2.5 : 0);
  const dx = Math.sin(yaw), dz = -Math.cos(yaw);
  const cx = p.x - dx * back, cz = p.z - dz * back;
  const pos = new V3(cx, Math.max(p.y, heightAt(cx, cz) + 0.6, 0.6) + h + (onTee ? 1.2 : 0), cz);
  const ahead = putt ? Math.max(2.5, Math.min(7, distToCup())) : Math.min(130, Math.max(60, distToCup() * 0.6));
  // on Bishop Peak the tee view is turned a little left toward Cerro San Luis (~18° left of the aim line) and its M (~4° left)
  // so they sit in frame; a portrait frame turns ~8° so Cerro fits inside its left edge while the aim line stays well in view
  const bias = BISHOP && onTee ? (camera.aspect > 1 ? 0.1 : 0.14) * ahead : PISMO && onTee ? -0.05 * ahead : 0;
  const lx = p.x + dx * ahead + dz * bias, lz = p.z + dz * ahead - dx * bias;
  const lk = new V3(lx, putt ? heightAt(lx, lz) : Math.max(onTee ? 0 : p.y, heightAt(lx, lz)) + 2.2 + ahead * 0.012, lz);
  return { pos, look: lk };
}
// landing-zone preview: the camera hangs above and behind the predicted carry spot (default: last full-shot power)
const pvKey = { k: '', land: { x: 0, z: 0 } };
function previewLand() {
  const k = `${G.club},${G.yaw},${G.lastPower},${ball.p.x},${ball.p.z}`;
  if (k !== pvKey.k) {
    const pr = predict(ball.p, ball.lie, G.club, G.lastPower, G.yaw, { x: 0, z: 0 }), cp = pr.carryPt || pr.end, len = Math.hypot(cp.x - ball.p.x, cp.z - ball.p.z);
    pvKey.k = k; pvKey.land = { x: ball.p.x + Math.sin(G.yaw) * len, z: ball.p.z - Math.cos(G.yaw) * len };
  }
  return pvKey.land;
}
function previewPose() {
  const l = G.pvSpot || previewLand(), gy = Math.max(0.05, heightAt(l.x, l.z)), z = G.pvZoom, dx = Math.sin(G.yaw), dz = -Math.cos(G.yaw);
  const cx = l.x - dx * 42 * z, cz = l.z - dz * 42 * z;
  return { pos: new V3(cx, Math.max(heightAt(cx, cz) + 2, gy + 24 * z), cz), look: new V3(l.x, gy + 1, l.z) };
}
function togglePreview(force) {
  const on = force ?? !G.preview;
  if (G.state !== 'aim' || on === G.preview || on && G.club === 'putter') return G.preview;
  G.preview = on; G.pvSpot = null; $('pvtap').hidden = true; drag.on = false; $('dragdot').hidden = true; $('pull').hidden = true; $('power').hidden = true;
  if (on) { W0.aimLine.set([]); tweenTo(previewPose(), 0.9); } else { W0.marker.visible = false; tweenTo(aimPose(), 0.8); }
  return G.preview;
}
// a tap in the preview flies the camera to look at that spot and labels its distance + surface (aim, club and power untouched)
function tapPreview(x, z) {
  if (!G.preview || G.state !== 'aim') return null;
  G.pvSpot = { x, z }; tweenTo(previewPose(), 0.7);
  const t = `${yd(Math.hypot(x - ball.p.x, z - ball.p.z))} yd · ${SURF[surfaceAt(x, z)].label}`, el = $('pvtap'); el.textContent = t; el.hidden = false;
  return t;
}
function tweenTo(pose, dur) { cam.from = { pos: camera.position.clone(), look: cam.look.clone() }; cam.to = pose; cam.tt = 0; cam.dur = dur; }

function prepareShot(dur = 1.6) {
  G.preview = false; G.pvSpot = null; $('pvtap').hidden = true;
  G.yaw = aimYaw();
  if (!G.manualClub || ball.lie === 'green') setClub(autoClub());
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
  G.strokes++; if (club === 'putter') G.putts++; else G.lastPower = Math.max(0.3, power);
  G.preview = false; G.pvSpot = null; $('pvtap').hidden = true;
  G.shotStart = { ...ball.p }; G.shotFromTee = ball.lie === 'tee'; G.cupCheck = false; G.slowmo = false; G.waterHandled = false;
  ball.lipped = false;
  ball.strike(club, power, yaw, weather.wind, club === 'putter' ? 0 : G.curve); G.curve = 0; updateCurveHud();
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
  return `I shot ${s} at ${MAP.name} on Tyler's course ⛳`;
}
async function share() {
  const url = location.href.split('?')[0], text = shareText();
  if (navigator.share) { try { await navigator.share({ title: `Coastline Golf · ${MAP.name}`, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
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
  G.yaw = aimYaw();
  const end = aimPose('driver', G.yaw), e = end.pos, l = end.look;
  const c = cupPos(), R = ROCK, k = 0.9;   // k: overall pace (seconds per key-time unit)
  if (BISHOP) {
    // from high south-west of the green, round it clockwise (always looking at the flag), back down the hole and onto the
    // tee camera: the heading only ever turns one way (right, ~200°), so by the tee it is already turned onto the Madonna
    // Inn behind it, and the view tips up just once (from looking down on the green to level at the tee)
    const f = (t, x, y, z, lx, ly, lz) => [t * k, x, y, z, lx, ly, lz];
    const keys = [
      f(0.0, -300, 95, 120, c.x, c.y, c.z),
      f(2.8, -260, 70, -40, c.x, c.y, c.z),
      f(5.2, -150, 50, -150, c.x, c.y, c.z + 10),
      f(7.6, -20, 42, -60, -40, 14, 120),
      f(10.0, 30, 30, 120, -20, 18, 260),
      f(12.6, ...panPos(0, true).toArray(), ...panLook(0)),   // lands on the tee camera already turned onto the Madonna Inn: the opening pan takes over
    ];
    fly.path = keyPath(keys); fly.dur = keys[keys.length - 1][0]; fly.keys = keys;
    return;
  }
  if (SENSORIO) {
    // high and behind the tee on the south-west knoll, over the tee and down across the field to the green, a turn round
    // the flag, then back up the hole onto the tee aim view
    const dx = c.x - TEE.x, dz = c.z - TEE.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, ty = TEE.h;
    const keys = [
      [0.0, TEE.x - ux * 90, ty + 55, TEE.z - uz * 90, c.x, c.y, c.z],
      [3.0, TEE.x - ux * 10, ty + 30, TEE.z - uz * 10, c.x, c.y, c.z],
      [6.0, TEE.x + ux * L * 0.6 + uz * 25, ty + 22, TEE.z + uz * L * 0.6 - ux * 25, c.x, c.y, c.z],
      [8.4, c.x + ux * 35 - uz * 20, c.y + 16, c.z + uz * 35 + ux * 20, c.x, c.y, c.z],
      [12.0, e.x, e.y, e.z, l.x, l.y, l.z],
    ].map(([t, ...r]) => [t * k, ...r]);
    fly.path = keyPath(keys); fly.dur = keys[keys.length - 1][0]; fly.keys = keys;
    return;
  }
  if (PISMO) {
    // out at the end of the Pismo Pier (~10 m above the deck, ~22 m off its end), looking back along the deck at the town and
    // the PISMO BEACH arch; a held beat (the path is clamped before its first key), then in over the deck, round onto the
    // beach and SSE down the hole (over the tee, the creek mouth and the fairway) to the green in the Oceano dunes, flag held
    // in frame, then a rising pull-back up the beach onto the tee aim view
    const A = PIER_AXIS, L = Math.hypot(A.bx - A.ax, A.bz - A.az), ux = (A.bx - A.ax) / L, uz = (A.bz - A.az) / L;
    const si = W0.pismoInfo && W0.pismoInfo.signPos, sx = si ? si.x : A.ax, sz = si ? si.z : A.az, sy = si ? si.top - 2 : 8;
    const deck = W0.pismoInfo ? W0.pismoInfo.pierEnds[1].deck : 6.6;
    const keys = [
      [0.8, A.bx + ux * 22, deck + 10, A.bz + uz * 22, sx, sy - 6, sz],
      [3.4, A.ax + ux * 170, deck + 22, A.az + uz * 170, sx - 30, 6, sz - 70],
      [5.8, 55, 34, -10, 10, 4, -200],
      [8.0, 30, 34, -150, -20, 4, -400],
      [10.2, 5, 30, -420, c.x, c.y, c.z],
      [11.6, -20, 24, -478, c.x, c.y, c.z],   // the dunes beat: green and flag ahead, the foredunes behind
      [13.6, 25, 55, -330, c.x + 40, c.y, c.z + 160],
      [15.4, e.x, e.y, e.z, l.x, l.y, l.z],
    ];
    fly.path = keyPath(keys); fly.dur = keys[keys.length - 1][0]; fly.keys = keys; fly.dunesT = 11.6;
    return;
  }
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
// the opening pan on Bishop Peak: from ~30 m above the tee, turned round onto the Madonna Inn behind the tee and framed so
// the whole complex and its roadside sign fill most of the frame width, it holds a beat, then the view sweeps right (the
// shorter way) round to Cerro San Luis and its M with Bishop Peak beside it, holds and settles on the tee aim view. Heading,
// pitch, height and lens each ease one way per leg (quintic ends), so there is no wobble and the last frame is exactly aimPose()
const pan = { t: 0, dur: 5.6, legs: null, pos: null, R: 1, pitch: 0, pitch0: 0, lift: 0, fov0: 36, hold: 0.8, turnEnd: 2.8, up: 30, fill: 0.75, fovM: 48, pitchM: 0, mPx: 36 };
const hdg = (x, z) => Math.atan2(x, -z), wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const panEase = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * u * (u * (u * 6 - 15) + 10); };
// the 8 world-space bbox corners of the Inn and of its sign: the pan-start shot is solved to hold them all
function innCorners() {
  const out = [], box = new THREE.Box3();
  for (const o of [W0.inn, W0.innSign]) {
    if (!o) continue; o.updateMatrixWorld(true); box.setFromObject(o, true);
    for (let i = 0; i < 8; i++) out.push(new V3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  }
  return out;
}
const solveCam = new THREE.PerspectiveCamera();
function buildPan() {
  // on the club the tee aim view will open with (endPan lands on aimPose() with it), so the last frame is that view exactly
  const a = aimPose(autoClub(), G.yaw), v = a.look.clone().sub(a.pos), LM = bishop.LM;
  pan.pos = a.pos; pan.R = v.length(); pan.pitch = Math.asin(v.y / pan.R);
  pan.lift = Math.max(0, heightAt(a.pos.x, a.pos.z) + pan.up - a.pos.y);
  const h2 = hdg(v.x, v.z), at = (o) => h2 + wrapA(hdg(o.x - a.pos.x, o.z - a.pos.z) - h2);
  const h1 = (at(LM.cerro) + at(LM.m)) / 2;
  // start pose: aim at the middle of the Inn + sign and pick the lens so they span pan.fill of the frame width, centred a
  // little below the middle of the frame (the HUD title sits up top); a few fixed-point steps converge to well under a pixel
  const P0 = a.pos.clone().setY(a.pos.y + pan.lift), C = innCorners(), m = innMid();
  let h0 = at(m), p0 = Math.atan2(m.y - P0.y, Math.hypot(m.x - P0.x, m.z - P0.z)), f = pan.fov0;
  if (C.length) {
    const sc = solveCam, q = new V3(); sc.aspect = camera.aspect; sc.near = 1; sc.far = 1e5; sc.position.copy(P0);
    for (let k = 0; k < 12; k++) {
      sc.fov = f; sc.updateProjectionMatrix();
      sc.lookAt(P0.x + Math.sin(h0) * Math.cos(p0), P0.y + Math.sin(p0), P0.z - Math.cos(h0) * Math.cos(p0)); sc.updateMatrixWorld(true);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const c of C) { q.copy(c).project(sc); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      const tv = Math.tan(f * Math.PI / 360), th = tv * sc.aspect;
      h0 += Math.atan((x0 + x1) / 2 * th); p0 += Math.atan(((y0 + y1) / 2 + 0.1) * tv);
      f = 2 * Math.atan(tv * (x1 - x0) / 2 / pan.fill) * 180 / Math.PI;
    }
  }
  pan.fov0 = f; pan.pitch0 = p0;
  const H = pan.hold, T = pan.turnEnd;
  // the Cerro hold: aimed square on the M and the lens tightened until its drawn height is pan.mPx on screen (from the
  // camera height at the middle of the hold)
  let hm = h1, pm = pan.pitch, fm = baseFov;
  if (W0.cerroM) {
    const PM = a.pos.clone().setY(a.pos.y + pan.lift * (1 - panEase((T + 0.25 - H) / (pan.dur - H)))), box = new THREE.Box3().setFromObject(W0.cerroM, true);
    // its actual vertices (the M lies on a slope, so its axis-aligned box corners overstate the drawn size)
    const MC = [], q = new V3(), sc = solveCam, mp = W0.cerroM.geometry.attributes.position; W0.cerroM.updateMatrixWorld(true);
    for (let i = 0; i < mp.count; i++) MC.push(new V3().fromBufferAttribute(mp, i).applyMatrix4(W0.cerroM.matrixWorld));
    const mc = box.getCenter(new V3()); hm = at(mc); pm = Math.atan2(mc.y - PM.y, Math.hypot(mc.x - PM.x, mc.z - PM.z));
    sc.aspect = camera.aspect; sc.near = 1; sc.far = 1e5; sc.position.copy(PM);
    for (let k = 0; k < 8; k++) {
      sc.fov = fm; sc.updateProjectionMatrix();
      sc.lookAt(PM.x + Math.sin(hm) * Math.cos(pm), PM.y + Math.sin(pm), PM.z - Math.cos(hm) * Math.cos(pm)); sc.updateMatrixWorld(true);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const c of MC) { q.copy(c).project(sc); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
      const tv = Math.tan(fm * Math.PI / 360), th = tv * sc.aspect;
      hm += Math.atan((x0 + x1) / 2 * th); pm += Math.atan((y0 + y1) / 2 * tv);
      fm = Math.min(baseFov, 2 * Math.atan(tv * (y1 - y0) / 2 * H0px() / pan.mPx) * 180 / Math.PI);
    }
  }
  pan.fovM = fm; pan.pitchM = pm;
  pan.legs = [[0, H, h0, h0], [H, T, h0, hm], [T, T + 0.5, hm, hm], [T + 0.5, pan.dur, hm, h2]];
}
const H0px = () => (renderer && renderer.domElement.clientHeight) || innerHeight;
// the lens and the pitch: framed on the Inn, easing onto the M at Cerro San Luis by the end of the sweep, then to the tee camera's
// (start -> Cerro hold value over the sweep, held, then -> the tee camera's over the settle)
function panLeg(t, v0, vm, v1) { const T = pan.turnEnd; return t <= T ? v0 + (vm - v0) * panEase((t - pan.hold) / (T - pan.hold)) : vm + (v1 - vm) * panEase((t - T - 0.5) / (pan.dur - T - 0.5)); }
function panFov(t) { return panLeg(t, pan.fov0, pan.fovM, baseFov); }
function panPitch(t) { return panLeg(t, pan.pitch0, pan.pitchM, pan.pitch); }
function setFov(f) { if (Math.abs(camera.fov - f) > 1e-4) { camera.fov = f; camera.updateProjectionMatrix(); } }
function applyPan(t) { camera.position.copy(panPos(t)); cam.look.set(...panLook(t)); camera.lookAt(cam.look); setFov(panFov(t)); }
// the middle of the Inn complex as drawn (its wings spread east of the landmark point)
function innMid() { const m = W0.inn; if (!m) return bishop.LM.inn; m.updateMatrixWorld(true); if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); return m.geometry.boundingBox.getCenter(new V3()).applyMatrix4(m.matrixWorld); }
function panLook(t, fresh) {
  if (fresh || !pan.legs) buildPan();
  const L = pan.legs.find((g) => t <= g[1]) || pan.legs[pan.legs.length - 1];
  const h = L[2] + (L[3] - L[2]) * panEase((t - L[0]) / (L[1] - L[0])), pt = panPitch(t), c = Math.cos(pt) * pan.R, p = panPos(t);
  return [p.x + Math.sin(h) * c, p.y + Math.sin(pt) * pan.R, p.z - Math.cos(h) * c];
}
// the camera starts ~30 m above the tee ground (so the whole Inn clears the near trees) and eases down to the tee camera
function panPos(t, fresh) { if (fresh || !pan.legs) buildPan(); return tmpP.copy(pan.pos).setY(pan.pos.y + pan.lift * (1 - panEase((t - pan.hold) / (pan.dur - pan.hold)))); }
const tmpP = new V3();
function startPan() {
  buildPan(); pan.t = 0; G.state = 'pan'; cam.to = null; applyPan(0);
}
function startFlyover() {
  buildFlyover();
  G.state = 'flyover'; fly.t = 0;
  $('hud').classList.add('intro'); $('hud').hidden = false;   // only the menu button shows during the intro
  $('flytitle').hidden = false; $('flytitle').classList.add('show');
}
function endFlyover(quick) {
  fly.endT = performance.now();
  perf.frames = 0; perf.t0 = fly.endT;   // auto quality starts judging the frame rate only now (see trackPerf)
  $('flytitle').hidden = true;
  G.yaw = aimYaw(); setClub(autoClub());
  if (BISHOP && !quick) { startPan(); return; }
  toAim(quick ? 0.9 : 1.4);
}
// skipping the pan (tap / click / any key) cuts straight to the tee aim view
function endPan() { G.yaw = aimYaw(); const a = aimPose(); camera.position.copy(a.pos); cam.look.copy(a.look); camera.lookAt(cam.look); setFov(baseFov); toAim(0); }
function toAim(dur) {
  if (dur > 0) tweenTo(aimPose(), dur); else cam.to = null;
  G.state = 'aim'; $('hud').hidden = false; $('hud').classList.remove('intro');
  if (!G.hinted) $('hint').hidden = false;
  updateHud();
}

// ---------- input ----------
const drag = { on: false, x0: 0, y0: 0, x: 0, y: 0, id: null };
const pvPtr = new Map();   // preview: a horizontal drag turns the aim, a pinch zooms, and neither can swing
const pvTap = { bad: false, t: 0 };   // a tap = one finger, little movement, quick
const pvZoom = (k) => { G.pvZoom = Math.max(0.5, Math.min(1.8, G.pvZoom * k)); };
let aimOv = null;
function dragShot() {
  if (TEST && aimOv) return aimOv;
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
  if (G.state === 'pan') { endPan(); return; }
  if (G.state !== 'aim') return;
  if (G.preview) { if (pvPtr.size) pvTap.bad = true; else pvTap.bad = false; pvTap.t = performance.now(); pvPtr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }); try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ } return; }
  if (!G.hinted) { G.hinted = true; $('hint').hidden = true; }
  drag.on = true; drag.id = e.pointerId; drag.x0 = drag.x = e.clientX; drag.y0 = drag.y = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
  $('dragdot').style.transform = `translate(${e.clientX}px, ${e.clientY}px)`; $('dragdot').hidden = false;
});
canvas.addEventListener('pointermove', (e) => {
  const q = pvPtr.get(e.pointerId);
  if (q) {
    if (pvPtr.size === 1) G.yaw += (e.clientX - q.x) * 0.0025;
    else if (pvPtr.size === 2) {
      const [a, b] = [...pvPtr.entries()].map(([id, v]) => id === e.pointerId ? { x: e.clientX, y: e.clientY } : v), [c, d] = [...pvPtr.values()];
      pvZoom(Math.hypot(c.x - d.x, c.y - d.y) / (Math.hypot(a.x - b.x, a.y - b.y) || 1));
    }
    if (Math.hypot(e.clientX - q.x0, e.clientY - q.y0) > 10) pvTap.bad = true;
    pvPtr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: q.x0, y0: q.y0 }); return;
  }
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
canvas.addEventListener('pointerup', (e) => {
  if (pvPtr.has(e.pointerId) && pvPtr.size === 1 && !pvTap.bad && performance.now() - pvTap.t < 600) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera({ x: (e.clientX - r.left) / r.width * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera); ray.far = 2000;
    const hit = ray.intersectObjects(W0.ground, false)[0]; if (hit) tapPreview(hit.point.x, hit.point.z);
  }
});
for (const t of ['pointerup', 'pointercancel']) canvas.addEventListener(t, (e) => { pvPtr.delete(e.pointerId); });
canvas.addEventListener('wheel', (e) => { if (G.preview) { e.preventDefault(); pvZoom(Math.exp(e.deltaY * 0.001)); } }, { passive: false });
let aimCache = 0;
function updateCurveHud() { const el = $('curve'); if (!el) return; el.hidden = !G.curve; el.textContent = G.curve < 0 ? `draw ${Math.abs(G.curve) * 100}%` : `fade ${G.curve * 100}%`; }
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
    // a straight line along the aim for the flat-ground roll of this power: reading the break from the grid is up to the player
    len = Math.min(40, flatPuttDist(s.power));
    $('power-label').textContent = `${Math.round(s.power * 100)}% · ~${Math.round(len * 3.28)} ft`;
    const pts = groundLine(ball.p, s.yaw, len, 0.25);
    const ex = ball.p.x + Math.sin(s.yaw) * len, ez = ball.p.z - Math.cos(s.yaw) * len;
    pts.push({ x: ex, y: Math.max(0.05, heightAt(ex, ez)) + 0.12, z: ez });
    W0.aimLine.set(pts); G.aimLinePts = pts;
    W0.marker.visible = true; W0.marker.position.set(ex, Math.max(0.05, heightAt(ex, ez)) + 0.08, ez);
    return;
  } else {
    const now = performance.now();
    if (now - aimCache > 40 || !G.lastPred) { aimCache = now; G.lastPred = predict(ball.p, ball.lie, G.club, s.power, s.yaw, { x: 0, z: 0 }, G.curve); }
    const cp = G.lastPred.carryPt || G.lastPred.end; len = Math.hypot(cp.x - ball.p.x, cp.z - ball.p.z);
    land = { x: cp.x, z: cp.z };   // where it lands, draw / fade included
    $('power-label').textContent = `${CLUBS[G.club].name} · ${Math.round(s.power * 100)}% · carry ${yd(len)} yd${G.curve ? (G.curve < 0 ? ' · draw' : ' · fade') : ''}`;
  }
  W0.aimLine.set([]);
  W0.marker.visible = true; W0.marker.position.set(land.x, Math.max(0.05, heightAt(land.x, land.z)) + 0.08, land.z);
}
for (const b of document.querySelectorAll('#clubs button[data-club]')) b.addEventListener('click', () => { if (G.state !== 'aim') return; setClub(b.dataset.club, true); if (G.preview && b.dataset.club === 'putter') togglePreview(false); else if (!G.preview) tweenTo(aimPose(), 0.6); });
$('btn-preview').addEventListener('click', () => togglePreview());
$('btn-grid').addEventListener('click', () => { W0.grid.on = !W0.grid.on; });
window.addEventListener('keydown', (e) => {
  if (G.state === 'pan') { endPan(); return; }
  if (G.state === 'aim' && !cam.to) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { G.yaw += (e.key === 'ArrowLeft' ? -1 : 1) * (G.club === 'putter' ? 0.01 : 0.02); if (!G.preview) tweenTo(aimPose(), 0.12); }
    if ((e.key === ',' || e.key === '.') && G.club !== 'putter') { G.curve = Math.max(-1, Math.min(1, Math.round((G.curve + (e.key === ',' ? -0.5 : 0.5)) * 2) / 2)); G.lastPred = null; updateCurveHud(); if (drag.on) updateAim(); }
    const k = { 1: 'driver', 2: 'wood', 3: 'iron', 4: 'wedge', 5: 'putter' }[e.key]; if (k) { setClub(k, true); if (G.preview && k === 'putter') togglePreview(false); else if (!G.preview) tweenTo(aimPose(), 0.6); }
  }
  if (G.state === 'aim' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.key === 'z' || e.key === 'Z') togglePreview();
    else if (e.key === 'Tab' && (document.activeElement === document.body || document.activeElement === canvas) && G.club !== 'putter') { e.preventDefault(); togglePreview(); }
  }
  if (e.key === 'Escape') { $('info').hidden = true; }
});

// map picker on the start screen: the course data is bound when the page loads, so a different pick saves the choice
// and reloads with ?map=
for (const b of document.querySelectorAll('#map-picker .map-choice')) {
  b.setAttribute('aria-pressed', String(b.dataset.map === MAP_ID));
  b.addEventListener('click', () => {
    rememberMap(b.dataset.map);
    if (b.dataset.map === MAP_ID) return;
    const u = new URL(location.href); u.searchParams.set('map', b.dataset.map); location.replace(u.toString());
  });
}
if (PISMO) document.querySelector('.load-art').innerHTML = '<circle class="load-sun" cx="196" cy="34" r="12" fill="#FFF3D6"/><path d="M6 62 L234 70 L234 74 L6 66 Z" fill="#E1F5F3" opacity=".95"/><g stroke="#E1F5F3" stroke-width="2.4" opacity=".9">' + Array.from({ length: 12 }, (_, i) => `<line x1="${14 + i * 19}" y1="${64 + i * 0.7}" x2="${14 + i * 19}" y2="104"/>`).join('') + '</g><g stroke="#E1F5F3" stroke-width="1.6" opacity=".8">' + Array.from({ length: 6 }, (_, i) => `<line x1="${30 + i * 38}" y1="${63 + i * 1.3}" x2="${30 + i * 38}" y2="${52 + i * 1.3}"/>`).join('') + '</g><g class="load-waves" stroke="#9ED8E0" stroke-width="3" fill="none" stroke-linecap="round"><path d="M4 100 q 10 -4 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0"/><path d="M4 110 q 10 -4 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0" opacity=".6"/></g>';
if (BISHOP) document.querySelector('.load-art').innerHTML = '<defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8D9A8"/><stop offset="1" stop-color="#8A7A3E"/></linearGradient></defs><circle class="load-sun" cx="188" cy="40" r="13" fill="#FFF3D6"/><path d="M8 96 L44 70 L58 52 L66 58 L82 30 L92 38 L104 22 L114 36 L124 34 L150 68 L182 84 L236 92 Z" fill="#E1F5F3" opacity=".95"/><path d="M130 96 L168 62 L176 66 L214 90 L236 92 L236 96 Z" fill="#E1F5F3" opacity=".5"/><g class="load-waves" stroke="url(#lg)" stroke-width="3" fill="none" stroke-linecap="round"><path d="M4 106 q 10 -4 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0"/></g>';

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
// menu: reload to the start screen with the current map kept, no autostart / nofly (the map picker marks the current hole)
$('btn-menu').addEventListener('click', () => {
  rememberMap(MAP_ID);
  const u = new URL(location.href); u.searchParams.set('map', MAP_ID); u.searchParams.delete('autostart'); u.searchParams.delete('nofly');
  location.assign(u.toString());
});
$('btn-info').addEventListener('click', openInfo); $('end-info').addEventListener('click', openInfo);
$('info-close').addEventListener('click', () => { $('info').hidden = true; });
$('info').addEventListener('click', (e) => { if (e.target === $('info')) $('info').hidden = true; });
$('end-share').addEventListener('click', share);
$('end-replay').addEventListener('click', () => { resetHole(); prepareShot(1.2); $('hint').hidden = G.hinted; });
// previous / next hole follow the MAP_KEYS order; the active map is bound at import, so switching saves the pick and reloads with ?map=
{
  const at = MAP_KEYS.indexOf(MAP_ID);
  const go = (btn, id, label) => {
    btn.hidden = !id;
    if (!id) return;
    btn.textContent = `${label}: ${MAPS[id].name}`;
    btn.addEventListener('click', () => { rememberMap(id); const u = new URL(location.href); u.searchParams.set('map', id); location.assign(u.toString()); });
  };
  go($('end-prev'), MAP_KEYS[at - 1], 'Previous'); go($('end-next'), MAP_KEYS[at + 1], 'Next');
}
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
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new V3(), tmp = new V3(), pinV = new V3(), shU = new V3(), shV = new V3(), UP = new V3(0, 1, 0);
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
  windUniforms.uTime.value = elapsed; W0.water.uniforms.uTime.value = elapsed; TERRAIN_TIME.value = elapsed; W0.sky.uniforms.uTime.value = elapsed; W0.flag.uniforms.uTime.value = elapsed;
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
    for (let i = 0; i < n; i++) ball.step(dt / n);   // Ball re-slices into fixed 1/240 s substeps
    if (ball.state === 'flight') W0.tracer.push(ball.p);
    handleEvents();
  }
  if (G.state === 'flight') {
    G.t += dt;
    // cup-drop slow motion: peek ahead once the ball is rolling close to the hole
    if (ball.state === 'roll' && !G.cupCheck && distToCup() < 3.2) {
      G.cupCheck = true;
      const b = ball.clone();      // deterministic physics: the copy does exactly what the real ball will
      for (let i = 0; i < 960 && b.state === 'roll'; i++) b.step(DT);
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
  if (G.preview) { const l = previewLand(); W0.marker.visible = true; W0.marker.position.set(l.x, Math.max(0.05, heightAt(l.x, l.z)) + 0.08, l.z); }
  const pb = $('btn-preview'), pbShow = G.state === 'aim' && G.club !== 'putter';
  if (pb.hidden === pbShow) pb.hidden = !pbShow;
  if (pb.getAttribute('aria-pressed') !== String(G.preview)) pb.setAttribute('aria-pressed', String(G.preview));
  if (W0.marker.visible) W0.marker.scale.setScalar(Math.max(0.5, camera.position.distanceTo(W0.marker.position) * 0.028));

  const gShow = G.state === 'aim' && G.club === 'putter' && ball.lie === 'green', gb = $('btn-grid'), gr = W0.grid;
  const hintHide = G.hinted || G.state !== 'aim' || G.preview || (G.club === 'putter' && ball.lie === 'green'), hn = $('hint');
  if (hn.hidden !== hintHide) hn.hidden = hintHide;
  if (gb.hidden === gShow) gb.hidden = !gShow;
  if (gb.getAttribute('aria-pressed') !== String(gr.on)) gb.setAttribute('aria-pressed', String(gr.on));
  if (gr.mesh.visible !== (gShow && gr.on)) gr.mesh.visible = gShow && gr.on;
  if (gr.mesh.visible) {
    const t = performance.now() / 1000;
    gr.pts.forEach((q, i) => {
      const sp = 0.2 + q.sl * 25, ph = (q.ph + t * sp / 1.6) % 1, len = 0.2 + Math.min(q.sl, 0.04) * 20, k = Math.sin(Math.PI * ph), o = (ph - 0.5) * 1.5;
      const x = q.x + q.dx * o, z = q.z + q.dz * o;
      tmpM.compose(tmp.set(x, heightAt(x, z) + 0.04, z), tmpQ.setFromAxisAngle(UP, Math.atan2(-q.dz, q.dx)), tmpS.set(len * k, 1, 1)); gr.mesh.setMatrixAt(i, tmpM);
    });
    gr.mesh.instanceMatrix.needsUpdate = true;
  }
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
  if (G.state !== 'holed' && G.state !== 'end' && !(BISHOP && (G.state === 'flyover' || G.state === 'pan'))) lens(baseFov, damp(4, rdt));
  if (cam.free) { camera.position.set(cam.free[0], cam.free[1], cam.free[2]); camera.lookAt(cam.free[3], cam.free[4], cam.free[5]); return; }
  if (G.state === 'flyover') {
    fly.t += rdt;
    fly.path(fly.t, camera.position, cam.look); camera.lookAt(cam.look);
    // on Bishop Peak the lens narrows over the last leg onto the Inn, so the pan's first frame (fov included) follows on exactly
    if (BISHOP) { const u = Math.max(0, Math.min(1, (fly.t - fly.dur + 2.2) / 2.2)), s = u * u * (3 - 2 * u); setFov(baseFov + (pan.fov0 - baseFov) * s); }
    if (fly.t > fly.dur) endFlyover(false);
    return;
  }
  if (G.state === 'pan') {
    pan.t += rdt; applyPan(pan.t);
    if (pan.t >= pan.dur) endPan();
    return;
  }
  if (cam.to) {
    cam.tt += rdt; const u = ease(Math.min(1, cam.tt / cam.dur));
    camera.position.lerpVectors(cam.from.pos, cam.to.pos, u); cam.look.lerpVectors(cam.from.look, cam.to.look, u);
    camera.lookAt(cam.look);
    if (cam.tt >= cam.dur) cam.to = null;
    return;
  }
  if (G.preview && G.state === 'aim') {
    const pp = previewPose(); camera.position.lerp(pp.pos, damp(5, rdt)); cam.look.lerp(pp.look, damp(5, rdt)); camera.lookAt(cam.look); return;
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
  let best = -1, lo = 9, hi = -9; const a0 = Math.atan2(FOCUS.x - p.x, -(FOCUS.z - p.z));
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
    // Bishop Peak rock-tint check: share of grey-rock land colour in the summit band (top 15% above the valley) vs the lower half
    rockStats: () => {
      if (MAP_ID !== 'bishop') return null;
      const L = bishop.LM.bishop, c = [0, 0, 0], v0 = 60, top = L.elev, st = { sum: [0, 0], low: [0, 0] };
      for (let i = 0; i < 40000; i++) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 900, x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r;
        const e = bishop.elevAt(x, z), f = (e - v0) / (top - v0); landColor(x, z, c);
        const mx = Math.max(...c), mn = Math.min(...c), lum = (mx + mn) / 2, sat = mx > 0 ? (mx - mn) / mx : 0, grey = sat < 0.32 && lum > 0.2 && lum < 0.6;
        const b = f >= 0.85 ? st.sum : f < 0.5 ? st.low : null; if (b) { b[0]++; if (grey) b[1]++; }
      }
      return { summitGrey: +(st.sum[1] / st.sum[0]).toFixed(3), lowerGrey: +(st.low[1] / st.low[0]).toFixed(3), n: [st.sum[0], st.low[0]] };
    },
    showEnd, get state() { return G.state; }, get strokes() { return G.strokes; }, get ball() { return { ...ball.p, state: ball.state, lie: ball.lie }; },
    get fps() { return perf.fps; }, get fpsHistory() { return perf.history.slice(); }, get frameMs() { return { update: +perf.upd.toFixed(2), render: +perf.ren.toFixed(2) }; }, info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles }), get quality() { return qLevel; }, get tierChanges() { return tierChanges; }, autoStart, get weather() { return weather; }, errors,
    get yaw() { return G.yaw; }, get preview() { return G.preview; }, get pvZoom() { return G.pvZoom; }, togglePreview, previewLand, tapPreview, get pvSpot() { return G.pvSpot; }, get pvLabel() { return $('pvtap').hidden ? '' : $('pvtap').textContent; }, get grid() { return { visible: W0.grid.mesh.visible, on: W0.grid.on, count: W0.grid.pts.length }; }, get club() { return G.club; }, W0, camera, renderer, scene,
    hole: { par: PAR, yd: HOLE_YD, m: HOLE_M, no: HOLE_NO, get flagNo() { return W0.flag && W0.flag.number; } },
    map: { id: MAP_ID, name: MAP.name, lat: MAP.lat, lon: MAP.lon, weatherLat: MAP.weatherLat, weatherLon: MAP.weatherLon, heading: HEADING },
    // real-world mapping of the Bishop Peak hole: tee / corner / cup as lat-lon, and the landmarks' lat-lon with their world positions
    geo: SENSORIO ? { tee: sensorio.worldToLl(TEE.x, TEE.z), cup: sensorio.worldToLl(CUP.x, CUP.z), green: sensorio.worldToLl(GREEN.x, GREEN.z), site: sensorio.SITE } : PISMO ? { tee: pismo.worldToLl(TEE.x, TEE.z), cup: pismo.worldToLl(CUP.x, CUP.z), green: pismo.worldToLl(GREEN.x, GREEN.z), site: pismo.SITE } : BISHOP ? { tee: bishop.worldToLl(TEE.x, TEE.z), corner: bishop.worldToLl(bishop.CORNER.x, bishop.CORNER.z), cup: bishop.worldToLl(CUP.x, CUP.z), site: bishop.SITE, landmarks: bishop.LM } : null,
    W0, surfY: () => W0.backdrop && W0.backdrop.userData.surfaceY, camera,
    probe: TEST && BISHOP ? { fairwayDist, llToWorld: bishop.llToWorld } : null,
    get pismo() { return PISMO ? W0.pismoInfo || null : null; },
    get pismoNature() { return PISMO ? { plants: plantStats(), clear: { fairway: pismo.FAIRWAY_HALF + 3, tee: 6, green: 6 }, trees: W0.trees.userData.spots.map((t) => ({ kind: t.kind, x: +t.x.toFixed(1), z: +t.z.toFixed(1), t: +(pismo.toeX(t.z) - t.x).toFixed(1) })), backdrop: W0.backdrop.userData.features, backdropCalls: 1, surf: { break: W0.water.uniforms.uBreak.value, pier: W0.water.uniforms.uPier.value.toArray() }, sand: pismoSandTransect(-120, pismo.shoreX) } : null; },
    TEE, CUP, bunkers: BUNKERS, pond: BISHOP ? bishop.POND : null, aimVia: AIM_VIA, heightAt,
    // Bishop Peak scene facts for the tests: the M draped on the hillside, the real-elevation heightmaps, the Inn's placement
    bishopCheck: () => {
      if (!BISHOP) return null;
      const M = W0.cerroM, P = M.geometry.attributes.position, sy = W0.backdrop.userData.surfaceY, lift = M.userData.lift;
      let drape = 0, real = 0, lo = 1e9, hi = -1e9;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        drape = Math.max(drape, Math.abs(y - lift - sy(x, z))); real = Math.max(real, Math.abs(y - lift - heightAt(x, z))); lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      const L = bishop.LM, inn = W0.inn.position;
      return { m: { verts: P.count, drape, real, rise: hi - lo, size: M.userData.size, slope: M.userData.slope, up: M.userData.up, at: bishop.worldToLl(M.userData.spot.x, M.userData.spot.z), ll: { lat: L.m.lat, lon: L.m.lon } },
        heights: { loaded: bishop.heightsLoaded(), near: bishop.NEAR.n, far: bishop.FAR.n, nearHalf: bishop.NEAR.half, exaggeration: bishop.EXAGGERATION },
        inn: { dist: Math.hypot(inn.x - L.inn.x, inn.z - L.inn.z), y: inn.y, ground: heightAt(L.inn.x, L.inn.z) },
        backdropTris: W0.backdrop.userData.tris, rocks: W0.rock.geometry.attributes.position.count / 3 };
    },
    surfaceAt, autoClub: () => autoClub(), weather: () => weather, windVector,
    // put the ball down anywhere and set up the shot (auto club) as if it had come to rest there
    place: (x, z) => { ball.place(x, z); G.manualClub = false; prepareShot(0.2); cam.tt = cam.dur; return { lie: ball.lie, club: G.club }; },
    // a windless shot from (x, z) with a given lie: carry / total / roll in yards
    // opts: { wind: {x, z}, curve: -1..1, frame: seconds per step (default 1/240) }
    // runs updateAim for a putter drag of (power, yaw): the straight preview line, its marker and label
    aimLinePts: (power, yaw) => { G.club = 'putter'; aimOv = { power, yaw }; updateAim(); aimOv = null; const m = W0.marker.position; return { pts: G.aimLinePts.map((p) => [p.x, p.z]), marker: [m.x, m.z], label: $('power-label').textContent, flat: flatPuttDist(power) }; },
    sim: (club, power, x, z, lie, yaw = 0, opts = {}) => {
      const b = new Ball(); b.place(x, z); if (lie) b.lie = lie; b.strike(club, power, yaw, opts.wind || { x: 0, z: 0 }, opts.curve || 0);
      const fr = opts.frame || DT; let lip = 0, land = null;
      for (let i = 0, n = Math.ceil(60 / fr); i < n && (b.state === 'flight' || b.state === 'roll'); i++) { b.step(fr); if (land === null && b.carry !== null) land = { x: b.p.x, z: b.p.z }; lip += b.events.filter((e) => e.type === 'lip').length; b.events.length = 0; }
      const tot = Math.hypot(b.p.x - x, b.p.z - z), dx = Math.sin(yaw), dz = -Math.cos(yaw), lx = b.p.x - x, lz = b.p.z - z;
      return { carry: b.carry * YD, total: tot * YD, roll: (tot - b.carry) * YD, end: surfaceAt(b.p.x, b.p.z), x: b.p.x, z: b.p.z, state: b.state, lip,
        apex: b.apex * YD, descent: b.landAngle, lateral: (lx * -dz + lz * dx) * YD /* + = right of the aim line */, t: b.t,
        landLateral: land ? ((land.x - x) * -dz + (land.z - z) * dx) * YD : null /* same, at the first touchdown (before any roll) */ };
    },
    // a putt rolling at the cup from `dist` metres away (offset: sideways miss in metres) at `speed` m/s: does it drop or lip out?
    cupTest: (speed, dist = 0.6, offset = 0) => {
      const a = Math.atan2(TEE.x - CUP.x, TEE.z - CUP.z), sx = Math.sin(a), sz = Math.cos(a);
      const b = new Ball(); b.place(CUP.x + sx * dist - sz * offset, CUP.z + sz * dist + sx * offset); b.lie = 'green'; b.club = CLUBS.putter; b.wind = { x: 0, z: 0 };
      b.t = 0; b.rollT = 0; b.state = 'roll'; b.v.x = -sx * speed; b.v.z = -sz * speed; b.w.x = b.v.z / BALL_R; b.w.z = -b.v.x / BALL_R;
      let lip = 0;
      for (let i = 0; i < 240 * 20 && b.state === 'roll'; i++) { b.step(DT); lip += b.events.filter((e) => e.type === 'lip').length; b.events.length = 0; }
      return { state: b.state, lip, left: Math.hypot(b.p.x - CUP.x, b.p.z - CUP.z) };
    },
    // the green's own geometry and a ball released at (x, z) with a tiny nudge: does gravity alone carry it off?
    green: GREEN, greenDist,
    settle: (x, z) => {
      const b = new Ball(); b.place(x, z); b.lie = 'green'; b.club = CLUBS.putter; b.wind = { x: 0, z: 0 }; b.t = 0; b.rollT = 0; b.v.x = 0.001; b.state = 'roll';
      for (let i = 0; i < 240 * 30 && b.state === 'roll'; i++) b.step(DT);
      return { end: surfaceAt(b.p.x, b.p.z), moved: Math.hypot(b.p.x - x, b.p.z - z) };
    },
    shoot: (club, power, angleDeg = 0, curve = 0) => { if (club) setClub(club, true); G.curve = curve; return shoot(G.club, power, G.yaw + angleDeg * Math.PI / 180); },
    // showcase lens: hold a different field of view (baseFov is reset on the next resize)
    setFov: (v) => { baseFov = v; camera.fov = v; camera.updateProjectionMatrix(); },
    freeCam: (...a) => { cam.free = a.length ? a : null; update(1 / 30); post.render(); },
    advance: (sec, step = 1 / 30) => { for (let t = 0; t < sec; t += step) update(step); post.render(); },
    flyAt: (sec) => { fly.t = sec; },
    // the intro camera at time t: world points -> [ndcX, ndcY, in front?, distance]
    flyProject: (t, pts) => {
      if (!fly.path) buildFlyover();
      const sc = solveCam, p = new V3(), l = new V3(), q = new V3(); fly.path(t, p, l);
      sc.aspect = camera.aspect; sc.fov = baseFov; sc.near = 0.5; sc.far = 1e5; sc.updateProjectionMatrix(); sc.position.copy(p); sc.lookAt(l); sc.updateMatrixWorld(true);
      return pts.map((w) => { q.set(...w).applyMatrix4(sc.matrixWorldInverse); const front = q.z < 0; q.set(...w).project(sc); return [q.x, q.y, front, p.distanceTo(new V3(...w))]; });
    },
    get flyDunesT() { return fly.dunesT; },
    // the intro path sampled at n even time steps: [x, y, z, lookX, lookY, lookZ, ground height under the camera]
    get flyKeys() { if (!fly.path) buildFlyover(); return fly.keys; },
    flyPath: (n = 240) => {
      if (!fly.path) buildFlyover();
      const p = new V3(), l = new V3(), pts = [];
      for (let i = 0; i <= n; i++) { fly.path(fly.dur * i / n, p, l); pts.push([p.x, p.y, p.z, l.x, l.y, l.z, heightAt(p.x, p.z)]); }
      return { dur: fly.dur, pts, cup: cupPos() };
    },
    // what the camera actually did, frame by frame, while the intro played (see frame())
    introLog: [],
    skip: () => { if (G.state === 'flyover') endFlyover(true); else if (G.state === 'pan') endPan(); },
    // the opening pan (Bishop only): play it from the tee, hold it at a time, or read it
    playPan: () => { if (BISHOP) { G.yaw = aimYaw(); setClub(autoClub()); $('hud').hidden = true; startPan(); } return G.state; },
    // the landmarks in world space (summit / M height on the drawn terrain) and the clearance of the sightline to a point
    lmWorld: () => PISMO ? (() => { const i = W0.pismoInfo, e = i.pierEnds, c = cupPos();
      return { pierEnd: [e[1].x, e[1].deck, e[1].z], pierBase: [e[0].x, e[0].deck, e[0].z], sign: [i.signPos.x, i.signPos.top - 1, i.signPos.z], cup: [c.x, c.y, c.z], flag: [CUP.x, heightAt(CUP.x, CUP.z) + 2.5, CUP.z] }; })() : BISHOP ? Object.fromEntries(Object.entries(bishop.LM).map(([k, v]) => [k, [v.x, k === 'm' || k === 'inn' ? heightAt(v.x, v.z) + 5 : bishop.yOf(v.elev, v.x, v.z), v.z]])) : null,
    sightline: (x, y, z) => { const c = camera.position; let m = 1e9; for (let i = 1; i < 194; i++) { const f = i / 200, px = c.x + (x - c.x) * f, pz = c.z + (z - c.z) * f; m = Math.min(m, c.y + (y - c.y) * f - heightAt(px, pz)); } return m; },
    get fov() { return camera.fov; },
    panAt: (sec) => { pan.t = sec; if (G.state === 'pan') applyPan(sec); }, panLift: (m) => { pan.up = m; pan.legs = null; }, heightAt,
    get panState() { return { t: pan.t, dur: pan.dur, active: G.state === 'pan', legs: pan.legs, pos: pan.pos && pan.pos.toArray() }; },
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
    $('load-step').textContent = weather.live ? `Live: ${weather.label}, ${Math.round(weather.tempF)}°F in ${MAP.place}` : `Weather offline · using typical ${MAP.place} conditions`;
    renderer.setAnimationLoop(frame);
    if (params.has('autostart')) $('start').click();
  } catch (e) {
    console.error(e); errors.push(String(e));
    $('load-step').textContent = 'Something went wrong loading the course. WebGL 2 is required.';
  }
})();
