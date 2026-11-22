import * as THREE from "three";
import { disposeObject, makeGlowSprite } from "./glow.js";
import { applyCssTheme, clearStaleStylePrefs, createVisuals, PALETTES, PICKUP_STYLES } from "./styles.js";
import { createAudio } from "./audio.js";

const TUNNEL_RADIUS = 7;
// Fly near the bottom wall; world rotates around the tunnel axis so the
// plane stays fixed on screen while obstacles come around by angle.
const FLIGHT_RADIUS = 5.4;
const PLANE_Z = -5.2;
const CAMERA_FOV = 80;
const CAMERA_FOV_BOOST = 115;
const CAMERA_FOV_FRAME = 68;
const CAMERA_Y = -3.0;
const CAMERA_Z = 2.0;
const CAMERA_FAR = 1100;
const LOOK_AT_Y = -4.0;
const LOOK_AT_Z = -40;
const SPEED = 42;
// Previous hold-to-boost rate (4x +12%/10s) is now the standard ramp.
const SPEED_GROWTH = 1.12 ** 4;
const SPEED_GROWTH_EVERY = 10;
const SPEED_MAX_FACTOR = 8;
const BOOST_RATE = 2;
const RING_SPACING = 9;
const RING_COUNT = 84;
const SPAWN_Z = -120;
const DESPAWN_Z = 6;
const METEOR_RADIUS = 1.35;
const HIT_RADIUS = 1.7;
const SPAWN_INTERVAL = 1.0;
const SMOOTH_TAU = 0.12;
const KEY_RATE = 2.1;
const TAP_RATE = 2.1;
const TAP_EASE_TAU = 0.1;
const CONTROL_KEY = "gyro-tunnel-control";
const HINT_GYRO = "Tilt the phone like a steering wheel · stay steady to boost";
const HINT_TAP = "Hold the sides to turn · stay steady to boost";
const AUTO_BOOST_DELAY = 2;
// Smoothed |d(targetRoll)/dt| below this counts as holding still (sensor noise).
const AUTO_BOOST_RATE_DEG = 8;
const AUTO_BOOST_RATE_RAD = (AUTO_BOOST_RATE_DEG * Math.PI) / 180;
const STEER_RATE_TAU = 0.12;

function motionApiAvailable() {
  return typeof DeviceMotionEvent !== "undefined";
}

function loadControlMode() {
  try {
    const saved = localStorage.getItem(CONTROL_KEY);
    if (saved === "gyro" || saved === "tap") return saved;
  } catch {
    // private mode
  }
  return motionApiAvailable() ? "gyro" : "tap";
}

function saveControlMode(mode) {
  try {
    localStorage.setItem(CONTROL_KEY, mode);
  } catch {
    // private mode
  }
}
const SIZE_MIN = 0.6;
const SIZE_MAX = 1.8;
const SPEED_MIN = 0.7;
const SPEED_MAX = 1.5;
const PLANE_HIT = 0.45;
const BAR_THRESHOLD = 500;
const BAR_THICKNESS = 0.44;
const BAR_DEPTH = 0.58;
const BAR_OFFSET_MIN = 0.8;
const BAR_OFFSET_MAX = 3.4;
const BAR_INTERVAL = 2.7;
const BAR_CLEAR_TIME = 0.8;
const DENSITY_RAMP = 2000;
const DENSITY_MAX = 2.75;
const DENSITY_SAFE_ARC = 0.8;
const BASE_WAVE_EXPECTED = 1.28;
// Hard caps so boost and late-game density never pile a wall in front of the ship.
const MAX_WAVE_METEORS = 3;
const HAZARD_CAP_MIN = 6;
const HAZARD_CAP_MAX = 8;
const CLOSE_WAVE_TIME = 1.0;
const EXPLODE_DURATION = 0.9;
const SHAKE_DURATION = 0.36;
const SHARD_COUNT = 16;
const SHARD_COLORS = [0xf4efe8, 0xff6b4a, 0xf0b429];

const BOARD_KEY = "gyro-tunnel-board";
const BOARD_SIZE = 5;
const NEAR_MISS_MARGIN = 1.2;
const NEAR_MISS_POINTS = 50;
const COMBO_WINDOW = 3;
const COMBO_CAP = 5;
const PICKUP_RADIUS = 1.28;
const PICKUP_INTERVAL_MIN = 15;
const PICKUP_INTERVAL_MAX = 25;
const SLOWMO_SCALE = 0.5;
const SLOWMO_HOLD = 5;
const SLOWMO_EASE = 0.85;
const X2_DURATION = 8;
const PALETTE_EVERY = 1000;
const PALETTE_FADE = 2;
const PICKUP_KINDS = ["shield", "slow", "x2"];
const BOOST_SPAWN_RATE = 1.35;

const app = document.getElementById("app");
const canvas = document.getElementById("scene");
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayBody = document.getElementById("overlay-body");
const actionButton = document.getElementById("action");
const statusEl = document.getElementById("status");
const hud = document.getElementById("hud");
const scoreHud = document.getElementById("score-hud");
const scoreValue = document.getElementById("score-value");
const speedHud = document.getElementById("speed-hud");
const speedValue = document.getElementById("speed-value");
const speedArc = document.getElementById("speed-arc");
const runSummary = document.getElementById("run-summary");
const finalScoreEl = document.getElementById("final-score");
const recordBadge = document.getElementById("record-badge");
const boardEl = document.getElementById("board");
const boardList = document.getElementById("board-list");
const lockHint = document.getElementById("lock-hint");
const lensFx = document.getElementById("lens-fx");
const comboHud = document.getElementById("combo-hud");
const powerHud = document.getElementById("power-hud");
const floatLayer = document.getElementById("float-layer");
const flashFx = document.getElementById("flash-fx");
const milestoneEl = document.getElementById("milestone");
const muteButton = document.getElementById("mute");
const controlModeButton = document.getElementById("control-mode");
const tapZones = document.getElementById("tap-zones");
const tapLeftEl = document.getElementById("tap-left");
const tapRightEl = document.getElementById("tap-right");
const hintEl = document.getElementById("hint");
const tapLeftIds = new Set();
const tapRightIds = new Set();
const audio = createAudio();

function syncMuteButton() {
  if (!muteButton) return;
  const muted = audio.isMuted();
  muteButton.classList.toggle("is-muted", muted);
  muteButton.setAttribute("aria-pressed", muted ? "true" : "false");
  muteButton.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
}

function isTapMode() {
  return state.controlMode === "tap";
}

function tapLeftHeld() {
  return tapLeftIds.size > 0;
}

function tapRightHeld() {
  return tapRightIds.size > 0;
}

function syncTapZoneVisuals() {
  tapLeftEl?.classList.toggle("is-held", tapLeftHeld());
  tapRightEl?.classList.toggle("is-held", tapRightHeld());
}

function syncControlModeUi() {
  const tap = isTapMode();
  if (controlModeButton) {
    controlModeButton.textContent = tap ? "Tap" : "Gyro";
    controlModeButton.setAttribute(
      "aria-label",
      tap ? "Control mode: Tap. Switch to Gyro." : "Control mode: Gyro. Switch to Tap.",
    );
  }
  const showZones = tap && state.mode === "playing";
  if (tapZones) {
    tapZones.classList.toggle("hidden", !showZones);
    tapZones.setAttribute("aria-hidden", showZones ? "false" : "true");
  }
  if (hintEl) hintEl.textContent = tap ? HINT_TAP : HINT_GYRO;
  syncTapZoneVisuals();
}

function clearTapPointers() {
  tapLeftIds.clear();
  tapRightIds.clear();
  state.tapSteer = 0;
  syncTapZoneVisuals();
}

function setControlMode(mode, { persist = true, announce = false } = {}) {
  const next = mode === "tap" ? "tap" : "gyro";
  const prev = state.controlMode;
  state.controlMode = next;
  if (persist) saveControlMode(next);
  if (next === "tap") {
    state.desktopRoll = state.roll;
    state.tapSteer = 0;
    clearTapPointers();
  } else if (prev === "tap") {
    clearTapPointers();
    state.pendingContinuity = true;
    state.calibrated = true;
  }
  syncControlModeUi();
  if (announce && statusEl && state.mode !== "playing") {
    statusEl.textContent = next === "tap" ? "Using tap controls." : "";
  }
  return next;
}

function freezeRunScore() {
  if (state.scoreFrozen) return state.finalScore;
  if (!state.scoreFrozen) {
    const next = Math.floor(state.scoreFromDistance) + state.bonusScore;
    state.score = next;
    state.displayedScore = next;
    state.finalScore = next;
    state.scoreFrozen = true;
    if (scoreValue) scoreValue.textContent = formatScore(next);
  }
  return state.finalScore;
}

const slowmoFx = document.getElementById("slowmo-fx");

const state = {
  mode: "start", // start | playing | over
  roll: 0,
  targetRoll: 0,
  calibrated: false,
  calibration: 0,
  hasMotion: false,
  desktopRoll: 0,
  pointerDragging: false,
  lastPointerX: 0,
  keys: { left: false, right: false },
  controlMode: loadControlMode(),
  tapSteer: 0,
  scoreFrozen: false,
  finalScore: 0,
  elapsed: 0,
  spawnTimer: 0.8,
  lastFrame: 0,
  orientAngle: 0,
  orientationLocked: false,
  compensated: false,
  pendingContinuity: false,
  fps: 60,
  explodeT: 0,
  shakeT: 0,
  distance: 0,
  score: 0,
  displayedScore: -1,
  best: 0,
  newRecord: false,
  runId: null,
  madeBoard: false,
  speedFactor: 1,
  speed: SPEED,
  displayedKmh: -1,
  growthTime: 0,
  boosting: false,
  autoBoost: false,
  steerIdleT: 0,
  steerRate: 0,
  prevTargetRoll: 0,
  flame: 0,
  lens: 0,
  displayedLens: -1,
  barTimer: 1.2,
  barsEnabled: true,
  meteorEnabled: true,
  pickupEnabled: true,
  bonusScore: 0,
  scoreFromDistance: 0,
  combo: 0,
  comboAt: -999,
  lastNearMiss: 0,
  lastNearLabel: "",
  shield: false,
  slowHold: 0,
  slowEase: 0,
  timeScale: 1,
  x2T: 0,
  pickupTimer: 8 + Math.random() * 4,
  lastPickupKind: "",
  meteorsPassed: 0,
  meteorsSpawned: 0,
  invincible: false,
  paletteFrom: 0,
  paletteTo: 0,
  paletteT: 1,
  paletteIndex: 0,
  milestone: 0,
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x02040a, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();

let visuals = null;
let rings = null;
let plane = null;
let planeLight = null;
let exhaust = null;

const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, CAMERA_FAR);
const _ndc = new THREE.Vector3();
const _camLocal = new THREE.Vector3();
let basePlaneNdcY = 0;

function currentFov() {
  const t = state.lens;
  const eased = t * t * (3 - 2 * t);
  return CAMERA_FOV + (CAMERA_FOV_BOOST - CAMERA_FOV) * eased;
}

function refreshBasePlaneNdc() {
  // Anchor the plane to the original 68° framing so a wider default FOV
  // still leaves the ship at the same screen spot.
  const prev = camera.fov;
  camera.fov = CAMERA_FOV_FRAME;
  camera.updateProjectionMatrix();
  camera.position.set(0, CAMERA_Y, CAMERA_Z);
  camera.lookAt(0, LOOK_AT_Y, LOOK_AT_Z);
  camera.updateMatrixWorld();
  basePlaneNdcY = _ndc.set(0, -FLIGHT_RADIUS, PLANE_Z).project(camera).y;
  if (prev !== CAMERA_FOV_FRAME) {
    camera.fov = prev;
    camera.updateProjectionMatrix();
  }
}

function framePlaneOnScreen() {
  if (!basePlaneNdcY) return;
  const planeY = plane?.position.y ?? -FLIGHT_RADIUS;
  for (let i = 0; i < 2; i += 1) {
    camera.updateMatrixWorld();
    _ndc.set(0, planeY, PLANE_Z).project(camera);
    const err = _ndc.y - basePlaneNdcY;
    if (Math.abs(err) < 1e-4) break;
    _camLocal.set(0, planeY, PLANE_Z).applyMatrix4(camera.matrixWorldInverse);
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * Math.abs(_camLocal.z);
    const shift = err * halfH;
    camera.position.y += shift;
    camera.lookAt(0, LOOK_AT_Y + (camera.position.y - CAMERA_Y), LOOK_AT_Z);
  }
}

function placeCamera() {
  const fov = currentFov();
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  camera.position.set(0, CAMERA_Y, CAMERA_Z);
  camera.lookAt(0, LOOK_AT_Y, LOOK_AT_Z);
  framePlaneOnScreen();
}

function applyLensOverlay() {
  const value = state.lens < 0.008 ? 0 : state.lens;
  if (Math.abs(value - state.displayedLens) < 0.01 && !(value === 0 && state.displayedLens !== 0)) return;
  state.displayedLens = value;
  lensFx.style.opacity = value ? String(Math.round(value * 1000) / 1000) : "0";
}

function updateLens(dt, snap = false) {
  const want = isBoostHeld() ? 1 : 0;
  if (snap) {
    state.lens = want;
  } else {
    const tau = want > state.lens ? 0.14 : 0.16;
    state.lens += (want - state.lens) * (1 - Math.exp(-Math.max(dt, 0) / tau));
    if (state.lens < 0.008 && !want) state.lens = 0;
    else if (state.lens > 0.992 && want) state.lens = 1;
  }
  applyLensOverlay();
}

placeCamera();

const world = new THREE.Group();
scene.add(world);

const meteors = [];
const meteorPool = [];
const bars = [];
const barPool = [];
const pickups = [];
const pickupPool = [];

const clock = new THREE.Clock(false);
const _vec = new THREE.Vector3();
const fpsMeter = { frames: 0, start: 0 };

function visualContext() {
  return {
    scene,
    world,
    renderer,
    radius: TUNNEL_RADIUS,
    spacing: RING_SPACING,
    count: RING_COUNT,
    meteorR: METEOR_RADIUS,
  };
}

function clearMeteors(disposePool = false) {
  for (const mesh of [...meteors]) recycleMeteor(mesh);
  if (!disposePool) return;
  for (const mesh of meteorPool) {
    mesh.removeFromParent();
    disposeObject(mesh);
  }
  meteorPool.length = 0;
}

function clearBars(disposePool = false) {
  for (const mesh of [...bars]) recycleBar(mesh);
  if (!disposePool) return;
  for (const mesh of barPool) {
    mesh.removeFromParent();
    disposeObject(mesh);
  }
  barPool.length = 0;
}

function makeFlameCone(radius, length, color, opacity) {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, length, 7, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  // Tip toward +Z (toward the camera), wide base at the nozzle.
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = length * 0.5;
  return mesh;
}

function disposeExhaust() {
  if (!exhaust) return;
  exhaust.group.removeFromParent();
  disposeObject(exhaust.group);
  exhaust = null;
}

function mountExhaust(parent) {
  disposeExhaust();
  const group = new THREE.Group();
  group.position.set(0, 0, 0.74);
  const outer = makeFlameCone(0.13, 0.82, 0xff6b4a, 0.7);
  const mid = makeFlameCone(0.08, 0.62, 0xf0b429, 0.85);
  const core = makeFlameCone(0.04, 0.42, 0xfff3d0, 0.95);
  group.add(outer, mid, core);
  group.visible = false;
  group.scale.setScalar(0);
  parent.add(group);
  exhaust = { group, outer, mid, core };
}

function hasDirectSteerInput() {
  return !!(
    state.keys.left ||
    state.keys.right ||
    tapLeftHeld() ||
    tapRightHeld() ||
    state.pointerDragging
  );
}

function isSteering() {
  if (hasDirectSteerInput()) return true;
  if (!isTapMode()) return state.steerRate > AUTO_BOOST_RATE_RAD;
  return false;
}

function updateSteerRate(dt) {
  const inst = Math.abs(wrapAngle(state.targetRoll - state.prevTargetRoll)) / Math.max(dt, 1e-4);
  const k = 1 - Math.exp(-Math.max(dt, 0) / STEER_RATE_TAU);
  state.steerRate += (inst - state.steerRate) * k;
  if (state.steerRate < 1e-4) state.steerRate = 0;
  state.prevTargetRoll = state.targetRoll;
}

function updateAutoBoost(dt) {
  if (state.mode !== "playing" || state.scoreFrozen) {
    state.autoBoost = false;
    state.steerIdleT = 0;
    return;
  }
  updateSteerRate(dt);
  if (isSteering()) {
    state.steerIdleT = 0;
    state.autoBoost = false;
    return;
  }
  state.steerIdleT += dt;
  if (!state.autoBoost && state.steerIdleT >= AUTO_BOOST_DELAY) {
    state.autoBoost = true;
    pushFloatLabel("Auto boost", "is-auto-boost");
  }
}

function isBoostHeld() {
  return state.mode === "playing" && !!state.autoBoost;
}

function setBoostHud(active) {
  speedHud.classList.toggle("is-boosting", active);
}

function clearBoostInput() {
  state.autoBoost = false;
  state.steerIdleT = 0;
  state.steerRate = 0;
  state.boosting = false;
  setBoostHud(false);
}

function updateExhaust(dt, now) {
  const want = isBoostHeld() ? 1 : 0;
  const tau = want > state.flame ? 0.07 : 0.1;
  state.flame += (want - state.flame) * (1 - Math.exp(-Math.max(dt, 0) / tau));
  if (state.flame < 0.008 && !want) state.flame = 0;

  const spr = plane?.userData?.engineSprite;
  if (!exhaust || !plane) return;

  if (state.flame <= 0 || !plane.visible) {
    exhaust.group.visible = false;
    if (planeLight && plane.visible) planeLight.intensity = planeLightBase;
    if (spr) spr.scale.setScalar(spr.userData.baseScale || 1);
    return;
  }

  const flicker =
    0.86 +
    Math.sin(now * 0.041) * 0.08 +
    Math.sin(now * 0.113) * 0.07 +
    Math.random() * 0.07;
  const s = state.flame * flicker;
  exhaust.group.visible = true;
  exhaust.group.scale.set(s * (0.92 + Math.random() * 0.14), s, s * (1.05 + Math.sin(now * 0.05) * 0.18));
  exhaust.outer.material.opacity = 0.55 * state.flame * flicker;
  exhaust.mid.material.opacity = 0.8 * state.flame * flicker;
  exhaust.core.material.opacity = 0.95 * state.flame;
  if (planeLight) planeLight.intensity = planeLightBase * (1 + 0.7 * state.flame);
  if (spr) {
    const base = spr.userData.baseScale || 1;
    spr.scale.setScalar(base * (1 + 0.7 * state.flame * flicker));
  }
}

function mountPlane() {
  plane = visuals.plane;
  plane.position.set(0, -FLIGHT_RADIUS, PLANE_Z);
  plane.rotation.set(0, 0, 0);
  plane.visible = true;
  scene.add(plane);
  planeLight = visuals.planeLight;
  planeLightBase = planeLight.intensity;
  planeLight.position.set(0, -FLIGHT_RADIUS + 0.3, PLANE_Z + 0.4);
  scene.add(planeLight);
  const spr = plane.userData?.engineSprite;
  if (spr && !spr.userData.baseScale) spr.userData.baseScale = spr.scale.x;
  mountExhaust(plane);
}

function bootVisuals() {
  clearStaleStylePrefs();
  applyCssTheme();
  clearMeteors(true);
  clearBars(true);
  clearPickups(true);
  disposeExhaust();
  if (visuals) visuals.dispose();
  visuals = createVisuals(visualContext());
  rings = visuals.tunnel;
  mountPlane();
  applyPaletteNow(0, 0, 1);
  spawnMeteor(0.8, -36);
  spawnMeteor(-1.6, -58);
  spawnMeteor(2.3, -88);
}

function makeMeteorMesh() {
  return visuals.createMeteor();
}

function acquireMeteor() {
  const mesh = meteorPool.pop() || makeMeteorMesh();
  world.add(mesh);
  meteors.push(mesh);
  return mesh;
}

function recycleMeteor(mesh) {
  world.remove(mesh);
  const i = meteors.indexOf(mesh);
  if (i >= 0) meteors.splice(i, 1);
  meteorPool.push(mesh);
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function meteorHalfAngle(sizeScale) {
  const r = METEOR_RADIUS * sizeScale;
  return Math.asin(Math.min(0.95, r / FLIGHT_RADIUS));
}

function minDodgeGap(sizeA, sizeB) {
  const planeHalf = Math.asin(Math.min(0.95, 0.95 / FLIGHT_RADIUS));
  return meteorHalfAngle(sizeA) + meteorHalfAngle(sizeB) + planeHalf * 2 + 0.28;
}

function densityT() {
  return Math.min(1, Math.max(0, state.distance / DENSITY_RAMP));
}

function densityFactor() {
  return 1 + (DENSITY_MAX - 1) * densityT();
}

function expectedWaveCount(t = densityT()) {
  const p2 = 0.28 + 0.62 * t;
  const p3 = t > 0.35 ? 0.65 * ((t - 0.35) / 0.65) : 0;
  return 1 + p2 + p3;
}

function waveCount() {
  const t = densityT();
  let n = 1;
  if (Math.random() < 0.28 + 0.62 * t) n += 1;
  if (t > 0.35 && Math.random() < 0.65 * ((t - 0.35) / 0.65)) n += 1;
  return n;
}


function approachingHazardCount() {
  let n = 0;
  for (const mesh of meteors) {
    if (mesh.position.z < DESPAWN_Z) n += 1;
  }
  for (const mesh of bars) {
    if (mesh.position.z < DESPAWN_Z) n += 1;
  }
  return n;
}

function hazardCap() {
  const t = Math.min(1, Math.max(0, (state.speedFactor - 1) / Math.max(1e-6, SPEED_MAX_FACTOR - 1)));
  return Math.round(HAZARD_CAP_MIN + (HAZARD_CAP_MAX - HAZARD_CAP_MIN) * t);
}

function hazardEta(mesh, speedScale) {
  const z = mesh.position ? mesh.position.z : mesh;
  const s = speedScale ?? mesh.userData?.speedScale ?? 1;
  return (PLANE_Z - z) / Math.max(0.25, s);
}

function nearbyHazardsForWave(atZ, speedScale = 1) {
  const eta0 = (PLANE_Z - atZ) / Math.max(0.25, speedScale);
  const nearby = [];
  for (const mesh of meteors) {
    if (Math.abs(hazardEta(mesh) - eta0) <= CLOSE_WAVE_TIME) nearby.push(mesh);
  }
  return nearby;
}

function nextSpawnInterval() {
  const t = densityT();
  const factor = densityFactor();
  const expected = expectedWaveCount(t);
  const base = SPAWN_INTERVAL + Math.random() * 0.35;
  let interval = (base * expected) / (BASE_WAVE_EXPECTED * factor);
  // Boost used to feel empty: the wide lens plus faster passing made the
  // same time-based spawn rate look sparse. Keep density-by-distance, but
  // raise the per-second rate while the finger is held.
  if (isBoostHeld()) interval /= BOOST_SPAWN_RATE;
  return interval;
}

function blockedHalf(sizeScale) {
  const planeHalf = Math.asin(Math.min(0.95, (PLANE_HIT * 2) / FLIGHT_RADIUS));
  return meteorHalfAngle(sizeScale) + planeHalf + 0.14;
}

function entriesFromMeshes(meshes) {
  return meshes.map((m) => ({
    angle: m.userData.angle,
    half: blockedHalf(m.userData.sizeScale),
  }));
}

function largestFreeArc(entries) {
  const N = 96;
  const step = (Math.PI * 2) / N;
  const blocked = new Array(N).fill(false);
  for (const e of entries) {
    const nSteps = Math.ceil(e.half / step);
    const mid = Math.round(((((e.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / step));
    for (let i = -nSteps; i <= nSteps; i += 1) {
      blocked[(((mid + i) % N) + N) % N] = true;
    }
  }
  if (blocked.every(Boolean)) return 0;
  let best = 0;
  let run = 0;
  for (let i = 0; i < N * 2; i += 1) {
    if (!blocked[i % N]) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return Math.min(best, N) * step;
}

function largestGapCenter(entries) {
  const N = 96;
  const step = (Math.PI * 2) / N;
  const blocked = new Array(N).fill(false);
  for (const e of entries) {
    const nSteps = Math.ceil(e.half / step);
    const mid = Math.round(((((e.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / step));
    for (let i = -nSteps; i <= nSteps; i += 1) {
      blocked[(((mid + i) % N) + N) % N] = true;
    }
  }
  let best = 0;
  let bestStart = 0;
  let run = 0;
  let runStart = 0;
  for (let i = 0; i < N * 2; i += 1) {
    if (!blocked[i % N]) {
      if (run === 0) runStart = i;
      run += 1;
      if (run > best) {
        best = run;
        bestStart = runStart;
      }
    } else {
      run = 0;
    }
  }
  return wrapAngle((bestStart + best / 2) * step);
}

function pickSafeAngle(meshes, sizeScale) {
  const half = blockedHalf(sizeScale);
  const existing = entriesFromMeshes(meshes);
  const tryAngle = (angle) => {
    const a = wrapAngle(angle);
    if (existing.some((e) => Math.abs(wrapAngle(a - e.angle)) < e.half + half)) return null;
    const next = [...existing, { angle: a, half }];
    if (largestFreeArc(next) < DENSITY_SAFE_ARC) return null;
    return a;
  };
  for (let k = 0; k < 20; k += 1) {
    let candidate = Math.random() * Math.PI * 2;
    if (k > 4 && existing.length) candidate = largestGapCenter(existing);
    const ok = tryAngle(candidate);
    if (ok != null) return ok;
  }
  return null;
}

function waveSafeArc(meshes) {
  return largestFreeArc(entriesFromMeshes(meshes));
}

function placeMeteor(mesh, angle, z, opts = {}) {
  const sizeScale = opts.sizeScale ?? randRange(SIZE_MIN, SIZE_MAX);
  const speedScale = opts.speedScale ?? randRange(SPEED_MIN, SPEED_MAX);
  mesh.position.set(
    Math.sin(angle) * FLIGHT_RADIUS,
    -Math.cos(angle) * FLIGHT_RADIUS,
    z,
  );
  mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  mesh.scale.setScalar(sizeScale);
  mesh.userData.angle = angle;
  mesh.userData.sizeScale = sizeScale;
  mesh.userData.speedScale = speedScale;
  mesh.userData.hitRadius = PLANE_HIT + METEOR_RADIUS * sizeScale;
  mesh.userData.spin = new THREE.Vector3(
    (Math.random() - 0.5) * 1.6,
    (Math.random() - 0.5) * 1.6,
    (Math.random() - 0.5) * 1.6,
  );
  mesh.userData.scoredNear = false;
  mesh.userData.seenAhead = false;
  mesh.userData.minApproach = null;
  mesh.userData.resolved = null;
  mesh.visible = true;
  markHazardPose(mesh);
}

function spawnMeteor(angle = Math.random() * Math.PI * 2, z, opts = {}) {
  const sizeScale = opts.sizeScale ?? randRange(SIZE_MIN, SIZE_MAX);
  const speedScale = opts.speedScale ?? randRange(SPEED_MIN, SPEED_MAX);
  // Faster hazards start farther so they stay dodgeable as game speed ramps.
  const spawnZ = z ?? SPAWN_Z * speedScale * (state.speedFactor || 1);
  const mesh = acquireMeteor();
  placeMeteor(mesh, angle, spawnZ, { sizeScale, speedScale });
  state.meteorsSpawned += 1;
  return mesh;
}

function spawnMeteorWave(atZ, opts = {}) {
  let baseZ = atZ;
  if (baseZ == null) {
    baseZ = SPAWN_Z * (state.speedFactor || 1);
    if (!opts.force) {
      for (let i = 0; i < 4 && !isZClear(baseZ, null, true); i += 1) {
        baseZ -= hazardClearZ();
      }
      if (!isZClear(baseZ, null, true)) return [];
    }
  }
  const spawned = [];
  const room = opts.force ? MAX_WAVE_METEORS : Math.max(0, (opts.maxCount ?? MAX_WAVE_METEORS));
  const n = Math.min(opts.count ?? waveCount(), MAX_WAVE_METEORS, room);
  if (n <= 0) return spawned;
  // Treat nearby / soon-to-arrive rocks as part of the same packing so two
  // close waves cannot close the only safe gap.
  const packing = opts.force ? [] : nearbyHazardsForWave(baseZ, 1);
  for (let i = 0; i < n; i += 1) {
    const sizeScale = opts.sizeScale ?? randRange(SIZE_MIN, SIZE_MAX);
    const angle = pickSafeAngle([...packing, ...spawned], sizeScale);
    if (angle == null) break;
    // When the caller pins a Z, keep it. Otherwise start faster rocks farther
    // so they stay dodgeable, using the (possibly nudged) base Z.
    const z = atZ != null ? atZ : undefined;
    const mesh = spawnMeteor(angle, z, { sizeScale });
    if (atZ == null && mesh) {
      // spawnMeteor already used SPAWN_Z * speedScale * speedFactor; if we
      // nudged baseZ away from that, rescale from the cleared base.
      const speedScale = mesh.userData.speedScale || 1;
      mesh.position.z = baseZ * speedScale;
      markHazardPose(mesh);
    }
    spawned.push(mesh);
  }
  return spawned;
}

function makeBarMesh() {
  return visuals.createBar();
}

function acquireBar() {
  const mesh = barPool.pop() || makeBarMesh();
  world.add(mesh);
  bars.push(mesh);
  return mesh;
}

function recycleBar(mesh) {
  world.remove(mesh);
  const i = bars.indexOf(mesh);
  if (i >= 0) bars.splice(i, 1);
  barPool.push(mesh);
}

function hazardClearZ() {
  return BAR_CLEAR_TIME * SPEED * (state.speedFactor || 1);
}

function isZClear(z, ignore = null, vsBarsOnly = false) {
  const clearZ = hazardClearZ();
  if (!vsBarsOnly) {
    for (const mesh of meteors) {
      if (mesh !== ignore && Math.abs(mesh.position.z - z) < clearZ) return false;
    }
  }
  for (const mesh of bars) {
    if (mesh !== ignore && Math.abs(mesh.position.z - z) < clearZ) return false;
  }
  for (const mesh of pickups) {
    if (mesh !== ignore && Math.abs(mesh.position.z - z) < clearZ) return false;
  }
  return true;
}

function placeBar(mesh, opts = {}) {
  const angle = opts.angle ?? Math.random() * Math.PI * 2;
  const sign = opts.offset != null ? Math.sign(opts.offset) || 1 : Math.random() < 0.5 ? 1 : -1;
  const offset = opts.offset ?? sign * randRange(BAR_OFFSET_MIN, BAR_OFFSET_MAX);
  const absOffset = Math.abs(offset);
  const length = 2 * Math.sqrt(Math.max(0.25, TUNNEL_RADIUS * TUNNEL_RADIUS - absOffset * absOffset)) + 0.2;
  const z = opts.z ?? SPAWN_Z * (state.speedFactor || 1);
  mesh.position.set(Math.sin(angle) * offset, -Math.cos(angle) * offset, z);
  mesh.rotation.set(0, 0, angle);
  const core = mesh.userData.core;
  const glow = mesh.userData.glow;
  const capA = mesh.userData.capA;
  const capB = mesh.userData.capB;
  core.scale.set(length, BAR_THICKNESS, BAR_DEPTH);
  glow.scale.set(length + 0.35, BAR_THICKNESS * 2.6, BAR_DEPTH * 1.7);
  capA.position.set(-length / 2, 0, 0);
  capB.position.set(length / 2, 0, 0);
  mesh.userData.kind = "bar";
  mesh.userData.angle = angle;
  mesh.userData.offset = offset;
  mesh.userData.speedScale = 1;
  mesh.userData.halfThick = BAR_THICKNESS / 2 + PLANE_HIT;
  mesh.userData.halfDepth = BAR_DEPTH / 2 + 0.28;
  mesh.userData.scoredNear = false;
  mesh.userData.seenAhead = false;
  mesh.userData.minApproach = null;
  mesh.userData.resolved = null;
  mesh.visible = true;
  markHazardPose(mesh);
  return mesh;
}

function spawnBar(z, opts = {}) {
  let spawnZ = z ?? SPAWN_Z * (state.speedFactor || 1);
  if (opts.force == null || opts.force === false) {
    for (let i = 0; i < 4 && !isZClear(spawnZ); i += 1) {
      spawnZ -= hazardClearZ();
    }
    if (!isZClear(spawnZ)) return null;
  }
  const mesh = acquireBar();
  placeBar(mesh, { ...opts, z: spawnZ });
  return mesh;
}

function barsUnlocked() {
  return state.barsEnabled && state.distance >= BAR_THRESHOLD;
}

function scoreMultiplier() {
  return state.x2T > 0 ? 2 : 1;
}

function currentTimeScale() {
  if (state.slowHold > 0) return SLOWMO_SCALE;
  if (state.slowEase > 0) {
    const t = 1 - state.slowEase / SLOWMO_EASE;
    const s = t * t * (3 - 2 * t);
    return SLOWMO_SCALE + (1 - SLOWMO_SCALE) * s;
  }
  return 1;
}

function slowmoActive() {
  return state.slowHold > 0 || state.slowEase > 0;
}

function pushFloatLabel(text, extraClass = "") {
  if (!floatLayer) return;
  const el = document.createElement("div");
  el.className = extraClass ? `float-label ${extraClass}` : "float-label";
  el.textContent = text;
  const offset = floatLayer.childElementCount * 18;
  el.style.marginBottom = `${offset}px`;
  floatLayer.append(el);
  window.setTimeout(() => el.remove(), 1000);
}

function triggerNearFlash() {
  if (!flashFx) return;
  flashFx.classList.remove("is-on");
  void flashFx.offsetWidth;
  flashFx.classList.add("is-on");
  window.setTimeout(() => flashFx.classList.remove("is-on"), 240);
}

function formatScore(value) {
  return Math.floor(Math.max(0, Number(value) || 0)).toLocaleString("en-US");
}

function paletteTitle(index) {
  const id = PALETTES[((index % PALETTES.length) + PALETTES.length) % PALETTES.length]?.id || "";
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : "";
}

let milestoneTimer = 0;
function showMilestone(mark) {
  state.milestone = mark;
  if (!milestoneEl) return;
  const label = paletteTitle(paletteIndexFor(mark)) || formatScore(mark);
  milestoneEl.textContent = label;
  audio.milestone();
  milestoneEl.classList.remove("hidden", "is-in");
  void milestoneEl.offsetWidth;
  milestoneEl.classList.add("is-in");
  window.clearTimeout(milestoneTimer);
  milestoneTimer = window.setTimeout(() => {
    milestoneEl.classList.add("hidden");
    milestoneEl.classList.remove("is-in");
  }, 2400);
}

function updateComboHud() {
  if (!comboHud) return;
  if (state.combo > 1) {
    comboHud.textContent = `×${state.combo}`;
    comboHud.classList.remove("hidden");
  } else {
    comboHud.classList.add("hidden");
  }
}

function resetCombo() {
  state.combo = 0;
  state.comboAt = -999;
  updateComboHud();
}

function awardNearMiss() {
  if (state.mode !== "playing" || state.scoreFrozen) return 0;
  const next = Math.min(COMBO_CAP, (state.combo || 0) + 1);
  state.combo = next;
  state.comboAt = state.elapsed;
  const points = NEAR_MISS_POINTS * next * scoreMultiplier();
  state.bonusScore += points;
  state.lastNearMiss = points;
  state.lastNearLabel = `Close call! +${points}`;
  pushFloatLabel(state.lastNearLabel);
  triggerNearFlash();
  updateComboHud();
  updateScoreHud(true);
  audio.closeCall(state.combo);
  return points;
}

function tickCombo(rawDt) {
  if (state.combo > 0 && state.elapsed - state.comboAt > COMBO_WINDOW) {
    resetCombo();
  }
}

function ensureShieldBubble() {
  if (!plane) return null;
  if (plane.userData.shieldBubble) return plane.userData.shieldBubble;
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(1.02, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0x7ee0ff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  bubble.position.set(0, 0.05, 0.05);
  bubble.visible = false;
  plane.add(bubble);
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0xbff6ff,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      wireframe: true,
    }),
  );
  bubble.add(rim);
  plane.userData.shieldBubble = bubble;
  return bubble;
}

function setShield(on) {
  state.shield = !!on;
  const bubble = ensureShieldBubble();
  if (bubble) bubble.visible = !!on;
}

function grantPowerup(kind, { silent = false } = {}) {
  if (kind === "shield") {
    setShield(true);
    if (!silent) {
      pushFloatLabel("Shield!", "is-power");
      audio.pickup("shield");
    }
  } else if (kind === "slow") {
    state.slowHold = SLOWMO_HOLD;
    state.slowEase = 0;
    state.timeScale = SLOWMO_SCALE;
    if (slowmoFx) slowmoFx.classList.add("is-on");
    if (!silent) {
      pushFloatLabel("Slow-mo!", "is-power");
      audio.pickup("slow");
    }
  } else if (kind === "x2") {
    state.x2T = X2_DURATION;
    document.getElementById("score-hud")?.querySelector(".score-pill")?.classList.add("is-x2");
    if (!silent) {
      pushFloatLabel("2× Score!", "is-power");
      audio.pickup("x2");
    }
  }
  renderPowerHud();
}

function burstAt(origin, scale = 0.85) {
  ensureExplosionFx();
  const pos = origin.clone();
  for (let i = 0; i < 8; i += 1) {
    const s = shardPool.pop() || makeShard();
    s.position.copy(pos);
    s.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.4, Math.random() - 0.5).normalize();
    s.userData.vel = dir.multiplyScalar(5 + Math.random() * 8);
    s.userData.spin = new THREE.Vector3(
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 12,
    );
    s.userData.life = 0.4 + Math.random() * 0.25;
    s.userData.age = 0;
    s.material.color.setHex(SHARD_COLORS[i % SHARD_COLORS.length]);
    s.material.opacity = 1;
    s.scale.setScalar((0.5 + Math.random() * 0.8) * scale);
    s.visible = true;
    activeShards.push(s);
  }
  if (flashSprite) {
    flashSprite.position.copy(pos);
    flashSprite.scale.setScalar(0.9 * scale);
    flashSprite.material.opacity = 0.9;
    flashSprite.visible = true;
    flashSprite.userData.age = 0;
  }
}

function recyclePickup(mesh) {
  world.remove(mesh);
  const i = pickups.indexOf(mesh);
  if (i >= 0) pickups.splice(i, 1);
  pickupPool.push(mesh);
}

function clearPickups(disposePool = false) {
  for (const mesh of [...pickups]) recyclePickup(mesh);
  if (!disposePool) return;
  for (const mesh of pickupPool) {
    mesh.removeFromParent();
    disposeObject(mesh);
  }
  pickupPool.length = 0;
}

function acquirePickup(kind) {
  const cached = pickupPool.findIndex((m) => m.userData.kind === kind);
  const mesh = cached >= 0 ? pickupPool.splice(cached, 1)[0] : visuals.createPickup(kind);
  world.add(mesh);
  pickups.push(mesh);
  return mesh;
}

function pickupAngleBlocked(z, angle) {
  for (const mesh of meteors) {
    if (Math.abs(mesh.position.z - z) < hazardClearZ() * 0.85) {
      if (Math.abs(wrapAngle((mesh.userData.angle || 0) - angle)) < 0.9) return true;
    }
  }
  for (const mesh of bars) {
    if (Math.abs(mesh.position.z - z) >= hazardClearZ() * 0.85) continue;
    const barAngle = mesh.userData.angle || 0;
    const offset = mesh.userData.offset || 0;
    const dist = Math.abs(FLIGHT_RADIUS * Math.cos(angle - barAngle) - offset);
    if (dist < (mesh.userData.halfThick || BAR_THICKNESS) + PICKUP_RADIUS * 0.6) return true;
  }
  return false;
}

function placePickup(mesh, opts = {}) {
  const kind = opts.kind || mesh.userData.kind || "x2";
  let angle = opts.angle;
  const z = opts.z ?? SPAWN_Z * (state.speedFactor || 1);
  if (angle == null) {
    angle = 0;
    for (let i = 0; i < 10; i += 1) {
      const candidate = Math.random() * Math.PI * 2;
      if (!pickupAngleBlocked(z, candidate)) {
        angle = candidate;
        break;
      }
    }
  }
  mesh.position.set(Math.sin(angle) * FLIGHT_RADIUS, -Math.cos(angle) * FLIGHT_RADIUS, z);
  mesh.rotation.set(0, 0, 0);
  if (mesh.userData.spin) mesh.userData.spin.rotation.set(0.35, 0.2, 0);
  if (mesh.userData.spoke) mesh.userData.spoke.rotation.z = Math.PI + angle;
  if (mesh.userData.beacon) {
    mesh.userData.beacon.position.set(-Math.sin(angle) * FLIGHT_RADIUS, Math.cos(angle) * FLIGHT_RADIUS, 0);
  }
  mesh.userData.kind = kind;
  mesh.userData.angle = angle;
  mesh.userData.speedScale = 1;
  mesh.userData.hitRadius = PICKUP_RADIUS;
  mesh.visible = true;
  return mesh;
}

function spawnPickup(kind, z, opts = {}) {
  let spawnZ = z ?? SPAWN_Z * (state.speedFactor || 1);
  if (!opts.force) {
    for (let i = 0; i < 4 && !isZClear(spawnZ); i += 1) spawnZ -= hazardClearZ();
    if (!isZClear(spawnZ)) return null;
  }
  const picked = kind || PICKUP_KINDS.filter((k) => k !== state.lastPickupKind)[Math.floor(Math.random() * 2)] || "x2";
  const mesh = acquirePickup(picked);
  placePickup(mesh, { ...opts, kind: picked, z: spawnZ });
  state.lastPickupKind = picked;
  return mesh;
}

function collectPickup(mesh) {
  const kind = mesh.userData.kind;
  recyclePickup(mesh);
  grantPowerup(kind);
}

function pickupHitsShip(mesh) {
  mesh.getWorldPosition(_vec);
  const dx = _vec.x;
  const dy = _vec.y + FLIGHT_RADIUS;
  const dz = _vec.z - PLANE_Z;
  const r = mesh.userData.hitRadius || PICKUP_RADIUS;
  return dx * dx + dy * dy + dz * dz < r * r;
}

function updatePickups(dt, baseDz) {
  for (const mesh of [...pickups]) {
    mesh.position.z += baseDz * (mesh.userData.speedScale || 1);
    const t = state.elapsed;
    const spin = mesh.userData.spin;
    if (spin) {
      spin.rotation.y += dt * 2.3;
      spin.rotation.x += dt * 0.95;
      const pulse = 1 + 0.14 * Math.sin(t * 4.2);
      spin.scale.setScalar(pulse);
    }
    const glow = mesh.userData.glow;
    if (glow) {
      const pulse = 3.8 * (1 + 0.22 * Math.sin(t * 5 + mesh.position.z * 0.05));
      glow.scale.setScalar(pulse);
      if (glow.material) glow.material.opacity = 0.8 + 0.2 * Math.sin(t * 5);
    }
    const halo = mesh.userData.halo;
    if (halo) {
      const pulse = 6.4 * (1 + 0.16 * Math.sin(t * 3.4 + 0.6));
      halo.scale.setScalar(pulse);
    }
    const marker = mesh.userData.marker;
    if (marker) {
      const s = 1 + 0.1 * Math.sin(t * 3.2);
      marker.scale.set(s, s, 1);
      if (marker.material) marker.material.opacity = 0.5 + 0.28 * Math.sin(t * 3.2);
    }
    const beam = mesh.userData.beam;
    if (beam?.material) beam.material.opacity = 0.26 + 0.14 * Math.sin(t * 2.5);
    const spoke = mesh.userData.spoke;
    if (spoke?.material) spoke.material.opacity = 0.22 + 0.12 * Math.sin(t * 2.5 + 0.4);
    const beacon = mesh.userData.beacon;
    if (beacon?.material) beacon.material.opacity = 0.38 + 0.22 * Math.sin(t * 2.8);
    const sparkles = mesh.userData.sparkles;
    if (sparkles) {
      for (const spark of sparkles) {
        const u = spark.userData;
        u.phase += dt * (u.speed || 2);
        const a = u.phase;
        spark.position.set(
          Math.cos(a) * u.radius,
          Math.sin(a * 1.35) * u.radius * 0.72,
          -(u.back || 0.5) - 0.55 * Math.sin(a * 0.85),
        );
        if (spark.material) spark.material.opacity = 0.28 + 0.5 * (0.5 + 0.5 * Math.sin(a * 2.2));
      }
    }
    if (state.mode === "playing" && pickupHitsShip(mesh)) collectPickup(mesh);
    else if (mesh.position.z > DESPAWN_Z) recyclePickup(mesh);
  }
  if (state.mode !== "playing" || !state.pickupEnabled) return;
  state.pickupTimer -= dt;
  if (state.pickupTimer <= 0) {
    spawnPickup();
    state.pickupTimer = PICKUP_INTERVAL_MIN + Math.random() * (PICKUP_INTERVAL_MAX - PICKUP_INTERVAL_MIN);
  }
}

function markHazardPose(mesh) {
  mesh.userData.prevZ = mesh.position.z;
  mesh.userData.prevRoll = state.roll;
}

function meteorWorldAt(angle, z, roll, out = _vec) {
  const a = angle + roll;
  return out.set(FLIGHT_RADIUS * Math.sin(a), -FLIGHT_RADIUS * Math.cos(a), z);
}

function segmentClosestToShip(ax, ay, az, bx, by, bz) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  const t = ab2 > 1e-10
    ? Math.max(0, Math.min(1, ((-ax) * abx + (-FLIGHT_RADIUS - ay) * aby + (PLANE_Z - az) * abz) / ab2))
    : 0;
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const cz = az + t * abz;
  return {
    t,
    closest: Math.hypot(cx, cy + FLIGHT_RADIUS, cz - PLANE_Z),
    lateral: Math.hypot(cx, cy + FLIGHT_RADIUS),
    z: cz,
  };
}

function sweptMeteor(mesh) {
  const angle = mesh.userData.angle || 0;
  const prevZ = mesh.userData.prevZ ?? mesh.position.z;
  const prevRoll = mesh.userData.prevRoll ?? state.roll;
  meteorWorldAt(angle, prevZ, prevRoll, _vec);
  const ax = _vec.x, ay = _vec.y, az = _vec.z;
  meteorWorldAt(angle, mesh.position.z, state.roll, _vec);
  const sweep = segmentClosestToShip(ax, ay, az, _vec.x, _vec.y, _vec.z);
  // Lateral gap in the flight plane, independent of how fast Z jumped.
  if ((az - PLANE_Z) * (_vec.z - PLANE_Z) <= 0 && Math.abs(_vec.z - az) > 1e-8) {
    const tz = (PLANE_Z - az) / (_vec.z - az);
    if (tz >= 0 && tz <= 1) {
      const lx = ax + tz * (_vec.x - ax);
      const ly = ay + tz * (_vec.y - ay);
      sweep.lateral = Math.hypot(lx, ly + FLIGHT_RADIUS);
      sweep.crossed = true;
    }
  }
  const hitR = mesh.userData.hitRadius || HIT_RADIUS;
  if (prevZ < PLANE_Z || mesh.position.z < PLANE_Z || az < PLANE_Z) mesh.userData.seenAhead = true;
  sweep.hitR = hitR;
  sweep.crossed = !!sweep.crossed || (prevZ < PLANE_Z && mesh.position.z >= PLANE_Z);
  sweep.passed = mesh.position.z > PLANE_Z + Math.max(0.25, hitR * 0.2);
  sweep.seenAhead = !!mesh.userData.seenAhead;
  return sweep;
}

function barLateralAt(roll, mesh) {
  const angle = mesh.userData.angle || 0;
  const offset = mesh.userData.offset || 0;
  return Math.abs(FLIGHT_RADIUS * Math.cos(roll - angle) - offset);
}

function sweptBar(mesh) {
  const prevZ = mesh.userData.prevZ ?? mesh.position.z;
  const prevRoll = mesh.userData.prevRoll ?? state.roll;
  const z = mesh.position.z;
  const halfD = mesh.userData.halfDepth || 0.5;
  const halfT = mesh.userData.halfThick || BAR_THICKNESS;
  const lo = Math.min(prevZ, z);
  const hi = Math.max(prevZ, z);
  const overlaps = lo <= PLANE_Z + halfD && hi >= PLANE_Z - halfD;
  let lateral = barLateralAt(state.roll, mesh);
  if (overlaps && Math.abs(z - prevZ) > 1e-8) {
    const tPlane = (PLANE_Z - prevZ) / (z - prevZ);
    if (tPlane >= 0 && tPlane <= 1) {
      const roll = prevRoll + (state.roll - prevRoll) * tPlane;
      lateral = barLateralAt(roll, mesh);
    } else {
      lateral = Math.min(lateral, barLateralAt(prevRoll, mesh));
    }
  } else {
    lateral = Math.min(lateral, barLateralAt(prevRoll, mesh));
  }
  if (prevZ < PLANE_Z || z < PLANE_Z) mesh.userData.seenAhead = true;
  return {
    lateral,
    halfT,
    overlaps,
    crossed: prevZ < PLANE_Z && z >= PLANE_Z,
    passed: z > PLANE_Z + halfD,
    seenAhead: !!mesh.userData.seenAhead,
    closest: overlaps ? lateral : Math.hypot(lateral, Math.max(0, Math.abs(Math.min(hi, PLANE_Z + halfD) - PLANE_Z) - halfD)),
  };
}

function finishMeteorPass(mesh, sweep) {
  if (mesh.userData.resolved) return mesh.userData.resolved;
  mesh.userData.minApproach = sweep.lateral;
  mesh.userData.scoredNear = true;
  state.meteorsPassed += 1;
  if (sweep.lateral > sweep.hitR && sweep.lateral <= sweep.hitR + NEAR_MISS_MARGIN) {
    awardNearMiss();
    mesh.userData.resolved = "near";
  } else {
    mesh.userData.resolved = "pass";
  }
  return mesh.userData.resolved;
}

function resolveMeteor(mesh) {
  if (mesh.userData.resolved) return mesh.userData.resolved;
  const sweep = sweptMeteor(mesh);
  if (sweep.seenAhead && sweep.closest < sweep.hitR) {
    mesh.userData.resolved = "hit";
    mesh.userData.scoredNear = true;
    mesh.userData.minApproach = sweep.closest;
    state.meteorsPassed += 1;
    return "hit";
  }
  if (sweep.seenAhead && (sweep.crossed || sweep.passed)) {
    return finishMeteorPass(mesh, sweep);
  }
  return null;
}

function resolveBar(mesh) {
  if (mesh.userData.resolved) return mesh.userData.resolved;
  const sweep = sweptBar(mesh);
  if (sweep.seenAhead && sweep.overlaps && sweep.lateral < sweep.halfT) {
    mesh.userData.resolved = "hit";
    mesh.userData.scoredNear = true;
    mesh.userData.minApproach = sweep.lateral;
    return "hit";
  }
  if (sweep.seenAhead && (sweep.crossed || sweep.passed)) {
    mesh.userData.scoredNear = true;
    mesh.userData.minApproach = sweep.lateral;
    if (sweep.lateral > sweep.halfT && sweep.lateral <= sweep.halfT + NEAR_MISS_MARGIN) {
      awardNearMiss();
      mesh.userData.resolved = "near";
    } else {
      mesh.userData.resolved = "pass";
    }
    return mesh.userData.resolved;
  }
  return null;
}

function resolveSweptHazards() {
  let hit = null;
  for (const mesh of meteors) {
    if (resolveMeteor(mesh) === "hit" && !hit) hit = mesh;
  }
  for (const mesh of bars) {
    if (resolveBar(mesh) === "hit" && !hit) hit = mesh;
  }
  return hit;
}

function recyclePassedHazards() {
  for (const mesh of [...meteors]) {
    if (mesh.position.z > DESPAWN_Z) {
      if (!mesh.userData.resolved) resolveMeteor(mesh);
      if (meteors.includes(mesh)) recycleMeteor(mesh);
    } else {
      markHazardPose(mesh);
    }
  }
  for (const mesh of [...bars]) {
    if (mesh.position.z > DESPAWN_Z) {
      if (!mesh.userData.resolved) resolveBar(mesh);
      if (bars.includes(mesh)) recycleBar(mesh);
    } else {
      markHazardPose(mesh);
    }
  }
}

function findCollision() {
  return resolveSweptHazards();
}

function checkNearMisses() {
  resolveSweptHazards();
}

function angleForLateral(lateral, sign = 1) {
  const x = Math.max(-0.999, Math.min(0.999, lateral / (2 * FLIGHT_RADIUS)));
  return -state.roll + sign * 2 * Math.asin(x);
}

function sweepForward(dz) {
  for (const mesh of meteors) mesh.position.z += dz;
  for (const mesh of bars) mesh.position.z += dz;
  for (const mesh of pickups) mesh.position.z += dz;
  const hit = resolveSweptHazards();
  if (hit) {
    if (state.mode === "playing" && state.shield) absorbHit(hit);
    else if (state.mode === "playing") triggerCrash();
  }
  recyclePassedHazards();
  return getState();
}

function absorbHit(mesh) {
  mesh.getWorldPosition(_vec);
  burstAt(_vec.clone(), 0.9);
  if (meteors.includes(mesh)) recycleMeteor(mesh);
  else if (bars.includes(mesh)) recycleBar(mesh);
  setShield(false);
  resetCombo();
  renderPowerHud();
  audio.shieldAbsorb();
}

function renderPowerHud() {
  if (!powerHud) return;
  const items = [];
  if (state.shield) items.push({ kind: "shield", t: 1, label: PICKUP_STYLES.shield.tag, color: "#7ee0ff", timed: false });
  if (slowmoActive()) {
    const total = SLOWMO_HOLD + SLOWMO_EASE;
    const left = state.slowHold + state.slowEase;
    items.push({ kind: "slow", t: left / total, label: PICKUP_STYLES.slow.tag, color: "#d4b8ff", timed: true });
  }
  if (state.x2T > 0) {
    items.push({ kind: "x2", t: state.x2T / X2_DURATION, label: PICKUP_STYLES.x2.tag, color: "#ffd45c", timed: true });
  }
  powerHud.classList.toggle("hidden", items.length === 0 || state.mode !== "playing");
  powerHud.setAttribute("aria-hidden", items.length ? "false" : "true");
  const circ = 2 * Math.PI * 14;
  powerHud.replaceChildren(
    ...items.map((item) => {
      const chip = document.createElement("div");
      chip.className = "power-chip";
      chip.dataset.kind = item.kind;
      chip.style.setProperty("--power-color", item.color);
      const dash = item.timed ? (item.t * circ).toFixed(2) : circ.toFixed(2);
      chip.innerHTML = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="power-track" cx="18" cy="18" r="14"></circle><circle class="power-arc" cx="18" cy="18" r="14" stroke-dasharray="${dash} ${circ.toFixed(2)}"></circle></svg><span class="power-icon">${item.label}</span>`;
      return chip;
    }),
  );
}

function updatePowerups(rawDt) {
  state.timeScale = currentTimeScale();
  if (state.slowHold > 0) {
    state.slowHold = Math.max(0, state.slowHold - rawDt);
    if (state.slowHold === 0) {
      state.slowEase = SLOWMO_EASE;
      audio.powerEnd("slow");
    }
  } else if (state.slowEase > 0) {
    state.slowEase = Math.max(0, state.slowEase - rawDt);
    if (state.slowEase === 0 && slowmoFx) slowmoFx.classList.remove("is-on");
  }
  if (state.x2T > 0) {
    state.x2T = Math.max(0, state.x2T - rawDt);
    if (state.x2T === 0) {
      document.getElementById("score-hud")?.querySelector(".score-pill")?.classList.remove("is-x2");
      audio.powerEnd("x2");
    }
  }
  const bubble = plane?.userData?.shieldBubble;
  if (bubble && bubble.visible) {
    const pulse = 1 + 0.06 * Math.sin(state.elapsed * 6);
    bubble.scale.setScalar(pulse);
  }
  if (slowmoFx) slowmoFx.classList.toggle("is-on", slowmoActive());
  renderPowerHud();
}

function clearPowerups() {
  setShield(false);
  state.slowHold = 0;
  state.slowEase = 0;
  state.timeScale = 1;
  state.x2T = 0;
  if (slowmoFx) slowmoFx.classList.remove("is-on");
  document.getElementById("score-hud")?.querySelector(".score-pill")?.classList.remove("is-x2");
  renderPowerHud();
}

function paletteIndexFor(distance) {
  return Math.floor(Math.max(0, distance) / PALETTE_EVERY) % PALETTES.length;
}

function applyPaletteNow(fromIndex, toIndex, t) {
  state.paletteFrom = fromIndex;
  state.paletteTo = toIndex;
  state.paletteT = Math.max(0, Math.min(1, t));
  state.paletteIndex = state.paletteT >= 1 ? toIndex : fromIndex;
  visuals?.setPalette?.(fromIndex, toIndex, state.paletteT);
}

function syncPaletteFromDistance({ snap = false, announce = false } = {}) {
  audio.setMusicDistance(state.distance, { snap });
  const target = paletteIndexFor(state.distance);
  if (target === state.paletteTo && (state.paletteT >= 1 || !snap)) {
    if (snap && state.paletteT < 1) applyPaletteNow(state.paletteFrom, state.paletteTo, 1);
    return;
  }
  if (target === state.paletteTo && state.paletteT >= 1) return;
  const from = state.paletteT >= 1 ? state.paletteTo : state.paletteFrom;
  if (snap) {
    applyPaletteNow(target, target, 1);
    return;
  }
  applyPaletteNow(from, target, 0);
  if (announce && target !== from) {
    const mark = Math.floor(state.distance / PALETTE_EVERY) * PALETTE_EVERY;
    if (mark > 0) showMilestone(mark);
  }
}

function updatePalette(rawDt) {
  const target = paletteIndexFor(state.distance);
  if (target !== state.paletteTo) {
    const mark = Math.floor(state.distance / PALETTE_EVERY) * PALETTE_EVERY;
    applyPaletteNow(state.paletteTo, target, 0);
    if (mark > 0 && mark !== state.milestone) {
      state.milestone = mark;
      showMilestone(mark);
    }
    audio.setMusicDistance(state.distance);
  }
  if (state.paletteT < 1) {
    state.paletteT = Math.min(1, state.paletteT + rawDt / PALETTE_FADE);
    applyPaletteNow(state.paletteFrom, state.paletteTo, state.paletteT);
  }
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function dampAngle(current, target, dt, tau) {
  const delta = wrapAngle(target - current);
  const k = 1 - Math.exp(-dt / tau);
  return wrapAngle(current + delta * k);
}

function gravityRoll(ax, ay, az) {
  // Prefer the screen-plane gravity vector (x,y). If the phone is nearly
  // flat, fall back to including z so the reading does not collapse.
  const planar = Math.hypot(ax, ay);
  if (planar < 2 && Math.abs(az) > planar) {
    return Math.atan2(ax, -az);
  }
  return Math.atan2(ax, -ay);
}

function isMobileLike() {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

function getOrientationAngle() {
  if (screen.orientation && Number.isFinite(screen.orientation.angle)) {
    return ((screen.orientation.angle % 360) + 360) % 360;
  }
  if (typeof window.orientation === "number") {
    return ((window.orientation % 360) + 360) % 360;
  }
  if (isMobileLike() && window.innerWidth > window.innerHeight) {
    return 90;
  }
  return 0;
}

function clearCompensationStyles() {
  app.classList.remove("is-compensated");
  app.style.position = "";
  app.style.top = "";
  app.style.left = "";
  app.style.width = "";
  app.style.height = "";
  app.style.transform = "";
  app.style.transformOrigin = "";
}

function applyViewportCompensation() {
  const angle = getOrientationAngle();
  if (angle !== state.orientAngle) {
    state.orientAngle = angle;
    state.pendingContinuity = true;
  }

  // Desktop monitors report angle 0 even when wide. Compensate only when the
  // OS actually rotated a phone-like screen, or a mobile viewport went landscape.
  const useComp = angle !== 0;
  state.compensated = useComp;

  if (!useComp) {
    clearCompensationStyles();
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    refreshBasePlaneNdc();
    return;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const portraitW = Math.min(vw, vh);
  const portraitH = Math.max(vw, vh);
  app.classList.add("is-compensated");
  app.style.position = "fixed";
  app.style.top = "50%";
  app.style.left = "50%";
  app.style.width = `${portraitW}px`;
  app.style.height = `${portraitH}px`;
  app.style.transformOrigin = "center center";
  app.style.transform = `translate(-50%, -50%) rotate(${-angle}deg)`;
  renderer.setSize(portraitW, portraitH, false);
  camera.aspect = portraitW / Math.max(portraitH, 1);
  camera.updateProjectionMatrix();
  refreshBasePlaneNdc();
}

function scheduleCompensation() {
  applyViewportCompensation();
  requestAnimationFrame(applyViewportCompensation);
  setTimeout(applyViewportCompensation, 200);
  setTimeout(applyViewportCompensation, 500);
}

async function requestFullscreenAndLock() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) {
      await el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
    } else if (el.webkitRequestFullScreen) {
      await el.webkitRequestFullScreen();
    }
  } catch {
    // iOS Safari and some desktop browsers reject fullscreen.
  }
  try {
    const orientation = screen.orientation;
    if (orientation && typeof orientation.lock === "function") {
      await orientation.lock("portrait");
      state.orientationLocked = true;
    }
  } catch {
    state.orientationLocked = false;
  }
  applyViewportCompensation();
}

function pointerLocalX(clientX, clientY) {
  const angle = (state.orientAngle * Math.PI) / 180;
  if (!angle) return clientX;
  const dx = clientX - window.innerWidth / 2;
  const dy = clientY - window.innerHeight / 2;
  // Inverse of the CSS rotate(-angle) so drag stays in phone-portrait space.
  return dx * Math.cos(angle) + dy * Math.sin(angle);
}

function requestSensorPermission() {
  const tasks = [];
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    tasks.push(DeviceMotionEvent.requestPermission().catch(() => "denied"));
  }
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    tasks.push(DeviceOrientationEvent.requestPermission().catch(() => "denied"));
  }
  return Promise.all(tasks);
}

function bindSensors() {
  window.addEventListener(
    "devicemotion",
    (event) => {
      const g = event.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      const rawScreen = gravityRoll(g.x, g.y, g.z ?? 0);
      // If the browser remaps axes to the current screen, adding the OS
      // angle brings the vector back into the physical-phone portrait frame.
      // If it does not remap (typical on iOS), the next-sample continuity
      // lock absorbs the constant offset so the world angle does not jump.
      const raw = wrapAngle(rawScreen + (state.orientAngle * Math.PI) / 180);
      if (state.pendingContinuity && state.calibrated) {
        state.calibration = wrapAngle(raw - state.targetRoll);
        state.pendingContinuity = false;
      } else if (!state.calibrated) {
        state.calibration = raw;
        state.calibrated = true;
        state.pendingContinuity = false;
      }
      state.hasMotion = true;
      if (!isTapMode()) state.targetRoll = wrapAngle(raw - state.calibration);
    },
    { passive: true },
  );
}

const shardPool = [];
const activeShards = [];
let flashSprite = null;
let flashRing = null;
let planeLightBase = 2.2;
const _shake = new THREE.Vector3();

function makeShard() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0.2, 0, -0.16, -0.12, 0, 0.16, -0.12, 0]), 3),
  );
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xf4efe8,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

function ensureExplosionFx() {
  if (flashSprite) return;
  for (let i = 0; i < SHARD_COUNT; i++) shardPool.push(makeShard());
  flashSprite = makeGlowSprite(0xfff1c8, 1.2);
  flashSprite.visible = false;
  scene.add(flashSprite);
  flashRing = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.72, 28),
    new THREE.MeshBasicMaterial({
      color: 0xff6b4a,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    }),
  );
  flashRing.visible = false;
  scene.add(flashRing);
}

function clearExplosion() {
  for (const s of activeShards) {
    s.visible = false;
    shardPool.push(s);
  }
  activeShards.length = 0;
  if (flashSprite) {
    flashSprite.visible = false;
    flashSprite.scale.setScalar(1);
  }
  if (flashRing) {
    flashRing.visible = false;
    flashRing.scale.setScalar(1);
  }
  state.explodeT = 0;
  state.shakeT = 0;
  placeCamera();
}

function startExplosion() {
  ensureExplosionFx();
  clearExplosion();
  const origin = plane.getWorldPosition(_vec).clone();
  plane.visible = false;
  if (planeLight) planeLight.intensity = 0;
  clearBoostInput();
  state.flame = 0;
  if (exhaust) exhaust.group.visible = false;

  for (let i = 0; i < SHARD_COUNT; i++) {
    const s = shardPool.pop() || makeShard();
    s.position.copy(origin);
    s.position.x += (Math.random() - 0.5) * 0.3;
    s.position.y += (Math.random() - 0.5) * 0.25;
    s.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.4, Math.random() - 0.5).normalize();
    s.userData.vel = dir.multiplyScalar(6 + Math.random() * 10);
    s.userData.spin = new THREE.Vector3(
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
    );
    s.userData.life = 0.55 + Math.random() * 0.3;
    s.userData.age = 0;
    s.material.color.setHex(SHARD_COLORS[i % SHARD_COLORS.length]);
    s.material.opacity = 1;
    s.scale.setScalar(0.7 + Math.random() * 1.15);
    s.visible = true;
    activeShards.push(s);
  }

  flashSprite.position.copy(origin);
  flashSprite.scale.setScalar(1.4);
  flashSprite.material.opacity = 1;
  flashSprite.visible = true;
  flashSprite.userData.age = 0;

  flashRing.position.copy(origin);
  flashRing.lookAt(camera.position);
  flashRing.scale.setScalar(0.25);
  flashRing.material.opacity = 0.95;
  flashRing.visible = true;
  flashRing.userData.age = 0;

  state.mode = "exploding";
  state.explodeT = 0;
  state.shakeT = SHAKE_DURATION;
  hud.classList.add("hidden");
  setPlayHud(false);
  syncControlModeUi();
}

function updateExplosion(dt) {
  for (const s of [...activeShards]) {
    s.userData.age += dt;
    const k = s.userData.age / s.userData.life;
    s.position.addScaledVector(s.userData.vel, dt);
    s.rotation.x += s.userData.spin.x * dt;
    s.rotation.y += s.userData.spin.y * dt;
    s.rotation.z += s.userData.spin.z * dt;
    s.material.opacity = Math.max(0, 1 - k);
    if (k >= 1) {
      s.visible = false;
      activeShards.splice(activeShards.indexOf(s), 1);
      shardPool.push(s);
    }
  }
  if (flashSprite?.visible) {
    flashSprite.userData.age += dt;
    const k = flashSprite.userData.age / 0.4;
    flashSprite.scale.setScalar(1.4 + k * 6);
    flashSprite.material.opacity = Math.max(0, 1 - k);
    if (k >= 1) flashSprite.visible = false;
  }
  if (flashRing?.visible) {
    flashRing.userData.age += dt;
    const k = flashRing.userData.age / 0.45;
    flashRing.scale.setScalar(0.25 + k * 7);
    flashRing.material.opacity = Math.max(0, 0.95 * (1 - k));
    flashRing.lookAt(camera.position);
    if (k >= 1) flashRing.visible = false;
  }
}

function applyCameraShake() {
  placeCamera();
  if (state.shakeT <= 0) return;
  const a = Math.max(0, state.shakeT / SHAKE_DURATION);
  const mag = 0.2 * a * a;
  camera.position.x += (Math.random() - 0.5) * mag;
  camera.position.y += (Math.random() - 0.5) * mag;
}

function readRecordAt(row) {
  const raw = row?.at ?? row?.ts ?? row?.timestamp;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  // ms since epoch, or seconds since epoch
  if (value > 1e12) return Math.floor(value);
  if (value > 1e9) return Math.floor(value * 1000);
  return null;
}

function loadBoard() {
  try {
    const raw = JSON.parse(localStorage.getItem(BOARD_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((row) => row && Number.isFinite(Number(row.score)))
      .map((row) => ({
        id: String(row.id || ""),
        score: Math.max(0, Math.floor(Number(row.score))),
        at: readRecordAt(row),
      }))
      .sort((a, b) => b.score - a.score || (b.at || 0) - (a.at || 0))
      .slice(0, BOARD_SIZE);
  } catch {
    return [];
  }
}

function saveBoard(rows) {
  try {
    localStorage.setItem(
      BOARD_KEY,
      JSON.stringify(rows.map((row) => ({ id: row.id, score: row.score, at: row.at ?? null }))),
    );
  } catch {
    // private mode or full storage — keep the in-memory board
  }
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatRecordAt(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const clock = `${hours}:${minutes}`;
  const today = new Date(now);
  if (startOfLocalDay(date) === startOfLocalDay(today)) {
    return `today, ${clock}`;
  }
  const month = MONTHS_EN[date.getMonth()];
  if (date.getFullYear() === today.getFullYear()) {
    return `${month} ${date.getDate()}, ${clock}`;
  }
  return `${month} ${date.getDate()}, ${date.getFullYear()}, ${clock}`;
}

function speedFactorFor(growthTime) {
  return Math.min(SPEED_MAX_FACTOR, Math.pow(SPEED_GROWTH, Math.max(0, growthTime) / SPEED_GROWTH_EVERY));
}

function kmhFromFactor(factor) {
  return Math.round(SPEED * factor * 3.6);
}

function updateSpeedHud(force = false) {
  const kmh = kmhFromFactor(state.speedFactor);
  if (!force && kmh === state.displayedKmh) return;
  state.displayedKmh = kmh;
  speedValue.textContent = String(kmh);
  const t = (state.speedFactor - 1) / (SPEED_MAX_FACTOR - 1);
  const fill = 12 + Math.max(0, Math.min(1, t)) * 88;
  speedArc.style.strokeDasharray = `${fill} 100`;
}

function setPlayHud(visible) {
  const method = visible ? "remove" : "add";
  scoreHud.classList[method]("hidden");
  speedHud.classList[method]("hidden");
  scoreHud.setAttribute("aria-hidden", visible ? "false" : "true");
  speedHud.setAttribute("aria-hidden", visible ? "false" : "true");
  if (!visible) {
    comboHud?.classList.add("hidden");
    powerHud?.classList.add("hidden");
    milestoneEl?.classList.add("hidden");
  }
}

function syncSpeed() {
  const held = isBoostHeld();
  if (held !== state.boosting) {
    state.boosting = held;
    setBoostHud(held);
  }
  state.speedFactor = speedFactorFor(state.growthTime);
  state.speed = SPEED * state.speedFactor;
  updateSpeedHud();
}

function applyGrowth(dt) {
  if (!slowmoActive()) {
    state.growthTime += dt * (isBoostHeld() ? BOOST_RATE : 1);
  }
  syncSpeed();
}

let board = loadBoard();
state.best = board[0]?.score ?? 0;

function updateScoreHud(force = false) {
  if (state.scoreFrozen) {
    state.score = state.finalScore;
    if (scoreValue) scoreValue.textContent = formatScore(state.finalScore);
    return;
  }
  const next = Math.floor(state.scoreFromDistance) + state.bonusScore;
  if (!force && next === state.displayedScore) return;
  state.score = next;
  state.displayedScore = next;
  if (scoreValue) scoreValue.textContent = formatScore(next);
}

function hideRunOverlays() {
  runSummary.classList.add("hidden");
  recordBadge.classList.add("hidden");
  boardEl.classList.add("hidden");
  boardList.replaceChildren();
}

function recordFlight() {
  const points = state.scoreFrozen ? state.finalScore : state.score;
  state.score = points;
  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    score: points,
    at: Date.now(),
  };
  state.runId = entry.id;
  const prevBest = board[0]?.score ?? 0;
  state.newRecord = entry.score > prevBest;
  board = [...board, entry]
    .sort((a, b) => b.score - a.score || (b.at || 0) - (a.at || 0))
    .slice(0, BOARD_SIZE);
  state.madeBoard = board.some((row) => row.id === entry.id);
  state.best = board[0]?.score ?? entry.score;
  saveBoard(board);
  return entry;
}

function renderBoard(currentId) {
  boardList.replaceChildren();
  for (let i = 0; i < board.length; i += 1) {
    const row = board[i];
    const li = document.createElement("li");
    const isCurrent = row.id === currentId;
    li.className = isCurrent ? "board-row is-current" : "board-row";
    if (isCurrent) li.setAttribute("aria-current", "true");

    const rank = document.createElement("span");
    rank.className = "board-rank";
    rank.textContent = String(i + 1);

    const time = document.createElement("span");
    time.className = "board-when";
    time.textContent = formatRecordAt(row.at);

    const points = document.createElement("span");
    points.textContent = formatScore(row.score);

    li.append(rank, time, points);
    boardList.append(li);
  }
}

function showStart() {
  state.mode = "start";
  overlay.dataset.mode = "start";
  overlay.classList.remove("hidden");
  hud.classList.add("hidden");
  setPlayHud(false);
  hideRunOverlays();
  overlayTitle.textContent = "Gyro Tunnel";
  overlayBody.textContent =
    "The plane stays put at the bottom of the screen. You tilt the phone — the 3D tunnel spins around it. Dodge the meteors coming at you.";
  actionButton.textContent = "Tap to start";
  statusEl.textContent = "";
  syncControlModeUi();
}

function showOver() {
  state.mode = "over";
  overlay.dataset.mode = "over";
  overlay.classList.remove("hidden");
  hud.classList.add("hidden");
  setPlayHud(false);
  if (!state.scoreFrozen) freezeRunScore();
  recordFlight();
  overlayTitle.textContent = "Crash";
  finalScoreEl.textContent = formatScore(state.finalScore || state.score);
  recordBadge.classList.toggle("hidden", !state.newRecord);
  runSummary.classList.remove("hidden");
  renderBoard(state.runId);
  boardEl.classList.toggle("hidden", board.length === 0);
  overlayBody.textContent = "An obstacle was in the way. Twist the tunnel and try again.";
  actionButton.textContent = "Tap to fly again";
  statusEl.textContent = "";
  syncControlModeUi();
}

function resetWorld() {
  clearExplosion();
  state.roll = 0;
  state.targetRoll = 0;
  state.desktopRoll = 0;
  state.prevTargetRoll = 0;
  state.tapSteer = 0;
  clearTapPointers();
  state.elapsed = 0;
  state.spawnTimer = 0.45;
  world.rotation.z = 0;
  plane.position.set(0, -FLIGHT_RADIUS, PLANE_Z);
  plane.rotation.set(0, 0, 0);
  plane.visible = true;
  if (planeLight) planeLight.intensity = planeLightBase;
  for (const mesh of [...meteors]) recycleMeteor(mesh);
  for (const mesh of [...bars]) recycleBar(mesh);
  clearPickups();
  rings.reset();
  state.barTimer = 1.2;
  state.pickupTimer = 8 + Math.random() * 4;
  state.lastPickupKind = "";
  state.meteorsPassed = 0;
  state.meteorsSpawned = 0;
  state.invincible = false;
  state.distance = 0;
  state.score = 0;
  state.bonusScore = 0;
  state.scoreFromDistance = 0;
  state.scoreFrozen = false;
  state.finalScore = 0;
  state.displayedScore = -1;
  state.lastNearMiss = 0;
  state.lastNearLabel = "";
  resetCombo();
  clearPowerups();
  floatLayer?.replaceChildren();
  state.milestone = 0;
  applyPaletteNow(0, 0, 1);
  state.newRecord = false;
  state.runId = null;
  state.madeBoard = false;
  state.speedFactor = 1;
  state.speed = SPEED;
  state.displayedKmh = -1;
  state.growthTime = 0;
  state.flame = 0;
  state.lens = 0;
  clearBoostInput();
  applyLensOverlay();
  if (exhaust) {
    exhaust.group.visible = false;
    exhaust.group.scale.setScalar(0);
  }
  updateScoreHud(true);
  updateSpeedHud(true);
}

function startGame({ recalibrate = true } = {}) {
  if (recalibrate) {
    state.calibrated = false;
    state.calibration = 0;
  }
  resetWorld();
  state.mode = "playing";
  overlay.classList.add("hidden");
  hud.classList.remove("hidden");
  setPlayHud(true);
  hideRunOverlays();
  syncControlModeUi();
  audio.startEngine();
  if (!clock.running) clock.start();
  state.lastFrame = performance.now();
  // First hazards start close enough to read, slightly off the flight path.
  spawnMeteor(1.15, -72);
  spawnMeteor(-2.2, -102);
}

async function onAction() {
  actionButton.disabled = true;
  await audio.unlock();
  if (state.mode === "start" || state.mode === "over") {
    if (isTapMode() || !motionApiAvailable()) {
      if (!motionApiAvailable() && !isTapMode()) setControlMode("tap", { persist: true });
      statusEl.textContent = "";
    } else {
      statusEl.textContent = "Requesting sensor access…";
      try {
        const results = await requestSensorPermission();
        if (results.length && results.every((r) => r && r !== "granted")) {
          setControlMode("tap", { persist: true });
          statusEl.textContent = "Sensors unavailable — using tap controls.";
        } else {
          statusEl.textContent = "";
        }
      } catch {
        setControlMode("tap", { persist: true });
        statusEl.textContent = "Sensors unavailable — using tap controls.";
      }
    }
    await requestFullscreenAndLock();
    startGame({ recalibrate: true });
  }
  actionButton.disabled = false;
}

function resize() {
  applyViewportCompensation();
}

function updateInput(dt) {
  if (isTapMode()) {
    const left = state.keys.left || tapLeftHeld();
    const right = state.keys.right || tapRightHeld();
    const want = left && !right ? TAP_RATE : right && !left ? -TAP_RATE : 0;
    const k = 1 - Math.exp(-dt / TAP_EASE_TAU);
    state.tapSteer += (want - state.tapSteer) * k;
    if (Math.abs(state.tapSteer) < 0.001 && want === 0) state.tapSteer = 0;
    state.desktopRoll = wrapAngle(state.desktopRoll + state.tapSteer * dt);
    state.targetRoll = state.desktopRoll;
  } else {
    if (state.keys.left) state.desktopRoll = wrapAngle(state.desktopRoll + KEY_RATE * dt);
    if (state.keys.right) state.desktopRoll = wrapAngle(state.desktopRoll - KEY_RATE * dt);
    if (!state.hasMotion) {
      state.targetRoll = state.desktopRoll;
    }
  }
  state.roll = dampAngle(state.roll, state.targetRoll, dt, SMOOTH_TAU);
  world.rotation.z = state.roll;
}

function advanceTunnel(dz) {
  rings.scroll(dz);
}

function updateMeteors(dt, baseDz) {
  for (const mesh of meteors) {
    const speed = mesh.userData.speedScale || 1;
    mesh.position.z += baseDz * speed;
    mesh.rotation.x += mesh.userData.spin.x * dt;
    mesh.rotation.y += mesh.userData.spin.y * dt;
    mesh.rotation.z += mesh.userData.spin.z * dt;
  }

  if (state.mode !== "playing" || !state.meteorEnabled) return;
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    const room = hazardCap() - approachingHazardCount();
    if (room <= 0) {
      state.spawnTimer = 0.16;
    } else {
      const list = spawnMeteorWave(undefined, { maxCount: room });
      state.spawnTimer = list.length ? nextSpawnInterval() : 0.16;
    }
  }
}

function updateBars(dt, baseDz, now) {
  for (const mesh of bars) {
    mesh.position.z += baseDz * (mesh.userData.speedScale || 1);
    const glow = mesh.userData.glow;
    if (glow) {
      const dist = PLANE_Z - mesh.position.z;
      const pulse = 0.5 + 0.5 * Math.sin((now || 0) * 0.007 + mesh.position.z * 0.08);
      glow.material.opacity = dist > 10 ? 0.18 + 0.28 * pulse : 0.38;
    }
  }

  if (state.mode !== "playing" || !barsUnlocked()) return;
  state.barTimer -= dt;
  if (state.barTimer <= 0) {
    if (approachingHazardCount() >= hazardCap()) {
      state.barTimer = 0.2;
    } else {
      spawnBar();
      state.barTimer = BAR_INTERVAL + Math.random() * 0.9;
    }
  }
}

function checkBarHit(mesh) {
  const dz = mesh.position.z - PLANE_Z;
  if (Math.abs(dz) > (mesh.userData.halfDepth || 0.5)) return false;
  const angle = mesh.userData.angle || 0;
  const offset = mesh.userData.offset || 0;
  const dist = Math.abs(FLIGHT_RADIUS * Math.cos(state.roll - angle) - offset);
  return dist < (mesh.userData.halfThick || BAR_THICKNESS);
}

function checkCollision() {
  return !!findCollision();
}

function triggerCrash() {
  if (state.mode !== "playing") return;
  freezeRunScore();
  clearBoostInput();
  audio.crash();
  startExplosion();
}

function tick(now) {
  requestAnimationFrame(tick);
  const rawDt = Math.min(0.05, Math.max(0, (now - (state.lastFrame || now)) / 1000 || 0.016));
  state.lastFrame = now;

  let worldScale = 0.35;
  if (state.mode === "playing") worldScale = 1;
  else if (state.mode === "exploding") worldScale = state.explodeT < 0.3 ? 0.35 : 0.55;
  const timeScale = state.mode === "playing" ? currentTimeScale() : 1;
  state.timeScale = timeScale;
  const flightSpeed = state.mode === "playing" || state.mode === "exploding" ? state.speed : SPEED;
  const dz = flightSpeed * rawDt * worldScale * timeScale;

  if (state.mode === "playing" || state.mode === "start" || state.mode === "over" || state.mode === "exploding") {
    if (state.mode !== "exploding") updateInput(rawDt);
    advanceTunnel(dz);
    updateMeteors(rawDt, dz);
    updateBars(rawDt, dz, now);
    updatePickups(rawDt, dz);
    if (state.mode !== "playing") recyclePassedHazards();
    const bob = Math.sin(now * 0.004) * 0.03;
    if (plane.visible) {
      plane.position.y = -FLIGHT_RADIUS + (state.mode === "playing" ? bob : 0);
      planeLight.position.y = plane.position.y + 0.3;
    }
    if (state.mode === "playing" && !state.scoreFrozen) {
      updateAutoBoost(rawDt);
      state.elapsed += rawDt;
      applyGrowth(rawDt);
      const metres = state.speed * rawDt * timeScale;
      state.distance += metres;
      state.scoreFromDistance += metres * scoreMultiplier();
      updateScoreHud();
      tickCombo(rawDt);
      updatePowerups(rawDt);
      updatePalette(rawDt);
      const hit = resolveSweptHazards();
      if (hit) {
        if (state.invincible) {
          if (meteors.includes(hit)) recycleMeteor(hit);
          else if (bars.includes(hit)) recycleBar(hit);
        } else if (state.shield) absorbHit(hit);
        else triggerCrash();
      }
      recyclePassedHazards();
    }
    if (state.mode === "playing") {
      audio.updateEngine({
        speedFactor: state.speedFactor,
        boosting: isBoostHeld(),
        timeScale: state.timeScale,
        active: true,
      });
    }
    updateExhaust(rawDt, now);
    updateLens(rawDt);
    if (state.mode === "exploding") {
      state.explodeT += rawDt;
      if (state.shakeT > 0) state.shakeT -= rawDt;
      updateExplosion(rawDt);
      if (state.explodeT >= EXPLODE_DURATION) showOver();
    }
  }

  visuals?.update?.(rawDt, { plane, mode: state.mode, lens: state.lens, now });

  fpsMeter.frames += 1;
  if (!fpsMeter.start) fpsMeter.start = now;
  const elapsed = now - fpsMeter.start;
  if (elapsed >= 800) {
    state.fps = Math.round((fpsMeter.frames * 1000) / elapsed);
    fpsMeter.frames = 0;
    fpsMeter.start = now;
  }

  applyCameraShake();
  renderer.render(scene, camera);
}

function bindZoomGuards() {
  const block = (e) => {
    e.preventDefault();
  };
  // iOS Safari pinch / rotate gestures. user-scalable=no is ignored there.
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    window.addEventListener(type, block, { passive: false, capture: true });
  }
  // Block pinch-zoom on touchmove, but do not cancel multi-touch touchstart:
  // left+right turn zones must still work together.
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false, capture: true }
  );
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = performance.now();
      if (now - lastTouchEnd > 0 && now - lastTouchEnd < 350) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false, capture: true }
  );
  window.addEventListener("dblclick", block, { capture: true });
}

function bindControls() {
  actionButton.addEventListener("click", onAction);
  syncMuteButton();
  muteButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    void audio.unlock();
    audio.toggleMuted();
    syncMuteButton();
  });
  syncControlModeUi();
  controlModeButton?.addEventListener("click", (e) => {
    e.stopPropagation();
    setControlMode(isTapMode() ? "gyro" : "tap");
  });

  const bindZone = (el, ids) => {
    if (!el) return;
    el.addEventListener("pointerdown", (e) => {
      if (!isTapMode() || state.mode !== "playing") return;
      e.preventDefault();
      e.stopPropagation();
      ids.add(e.pointerId);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // best-effort
      }
      syncTapZoneVisuals();
    });
    const release = (e) => {
      if (!ids.has(e.pointerId)) return;
      ids.delete(e.pointerId);
      syncTapZoneVisuals();
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", release);
  };
  bindZone(tapLeftEl, tapLeftIds);
  bindZone(tapRightEl, tapRightIds);

  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") state.keys.left = true;
    if (e.code === "ArrowRight" || e.code === "KeyD") state.keys.right = true;
    if (e.code === "Space") {
      e.preventDefault();
      if ((state.mode === "start" || state.mode === "over") && !e.repeat) onAction();
      return;
    }
    if (e.code === "Enter" && (state.mode === "start" || state.mode === "over")) {
      e.preventDefault();
      onAction();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") state.keys.left = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") state.keys.right = false;
    if (e.code === "Space") e.preventDefault();
  });

  const onDown = (x) => {
    state.pointerDragging = true;
    state.lastPointerX = x;
  };
  const onMove = (x) => {
    if (!state.pointerDragging) return;
    const dx = x - state.lastPointerX;
    state.lastPointerX = x;
    state.desktopRoll = wrapAngle(state.desktopRoll + dx * 0.007);
    if (!state.hasMotion) state.targetRoll = state.desktopRoll;
  };
  const onSteerUp = () => {
    state.pointerDragging = false;
  };

  const onPointerDown = (e) => {
    if (state.mode !== "playing") return;
    if (e.target?.closest?.("#action, button, a, #tap-zones, #corner-controls")) return;
    // Tap mode: the middle of the screen does nothing; sides steer via zones.
    if (isTapMode()) return;
    e.preventDefault();
    try {
      app.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort
    }
    onDown(pointerLocalX(e.clientX, e.clientY));
  };
  const onPointerUp = () => {
    onSteerUp();
  };

  app.addEventListener("pointerdown", onPointerDown);
  app.addEventListener("pointermove", (e) => onMove(pointerLocalX(e.clientX, e.clientY)));
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  bindZoomGuards();

  window.addEventListener("resize", scheduleCompensation);
  window.addEventListener("orientationchange", scheduleCompensation);
  if (screen.orientation) {
    screen.orientation.addEventListener("change", scheduleCompensation);
  }
  window.visualViewport?.addEventListener("resize", scheduleCompensation);
}

function tunnelEndZ() {
  return -4 - (RING_COUNT - 1) * RING_SPACING;
}

function visibleRange() {
  return PLANE_Z - tunnelEndZ();
}

function leadTimeAt(speed) {
  return visibleRange() / Math.max(1e-6, speed);
}

function getState() {
  return {
    mode: state.mode,
    roll: state.roll,
    targetRoll: state.targetRoll,
    meteorCount: meteors.length,
    barCount: bars.length,
    barsUnlocked: barsUnlocked(),
    barThreshold: BAR_THRESHOLD,
    densityFactor: densityFactor(),
    densityT: densityT(),
    densityMax: DENSITY_MAX,
    densityRamp: DENSITY_RAMP,
    starCount: 0,
    cameraFar: camera.far,
    fogDensity: scene.fog?.density ?? null,
    ringCount: RING_COUNT,
    ringSpacing: RING_SPACING,
    tunnelEndZ: tunnelEndZ(),
    visibleRange: visibleRange(),
    leadTime: leadTimeAt(state.speed),
    leadTimeAtMax: leadTimeAt(SPEED * SPEED_MAX_FACTOR),
    spawnZ: SPAWN_Z,
    elapsed: state.elapsed,
    hasMotion: state.hasMotion,
    orientAngle: state.orientAngle,
    orientationLocked: state.orientationLocked,
    compensated: state.compensated,
    fps: state.fps,
    explodeT: state.explodeT,
    score: state.score,
    distance: state.distance,
    best: state.best,
    newRecord: state.newRecord,
    madeBoard: state.madeBoard,
    runId: state.runId,
    speed: state.speed,
    speedFactor: state.speedFactor,
    speedKmh: kmhFromFactor(state.speedFactor),
    growthTime: state.growthTime,
    boosting: state.boosting,
    autoBoost: state.autoBoost,
    steerIdleT: state.steerIdleT,
    steerRate: state.steerRate,
    steerRateDeg: (state.steerRate * 180) / Math.PI,
    autoBoostDelay: AUTO_BOOST_DELAY,
    steerDeadzoneDeg: AUTO_BOOST_RATE_DEG,
    muted: audio.isMuted(),
    controlMode: state.controlMode,
    tapLeft: tapLeftHeld(),
    tapRight: tapRightHeld(),
    tapSteer: state.tapSteer,
    scoreFrozen: state.scoreFrozen,
    finalScore: state.finalScore,
    flame: state.flame,
    flameVisible: !!(exhaust && exhaust.group.visible),
    lens: state.lens,
    fov: camera.fov,
    planeNdcY: (plane
      ? _ndc.set(0, plane.position.y, PLANE_Z).project(camera).y
      : null),
    bonusScore: state.bonusScore,
    scoreFromDistance: state.scoreFromDistance,
    combo: state.combo,
    comboAt: state.comboAt,
    lastNearMiss: state.lastNearMiss,
    lastNearLabel: state.lastNearLabel,
    shield: state.shield,
    slowHold: state.slowHold,
    slowEase: state.slowEase,
    timeScale: state.timeScale,
    x2T: state.x2T,
    scoreMultiplier: scoreMultiplier(),
    paletteIndex: state.paletteTo,
    paletteFrom: state.paletteFrom,
    paletteTo: state.paletteTo,
    paletteT: state.paletteT,
    paletteId: PALETTES[state.paletteTo % PALETTES.length].id,
    milestone: state.milestone,
    pickupCount: pickups.length,
    meteorsPassed: state.meteorsPassed,
    meteorsSpawned: state.meteorsSpawned,
    invincible: state.invincible,
    boostSpawnRate: BOOST_SPAWN_RATE,
    approachingCount: approachingHazardCount(),
    hazardCap: hazardCap(),
    maxWaveMeteors: MAX_WAVE_METEORS,
    hazardCapMin: HAZARD_CAP_MIN,
    hazardCapMax: HAZARD_CAP_MAX,
    nearMissMargin: NEAR_MISS_MARGIN,
    floatLabel: floatLayer?.innerText || "",
    powerHud: powerHud?.innerText || "",
    comboVisible: !!(comboHud && !comboHud.classList.contains("hidden")),
    board: board.map((row) => ({
      id: row.id,
      score: row.score,
      at: row.at,
      atLabel: formatRecordAt(row.at),
    })),
    meteors: meteors.map((m) => ({
      sizeScale: m.userData.sizeScale,
      speedScale: m.userData.speedScale,
      angle: m.userData.angle,
      z: m.position.z,
    })),
    bars: bars.map((b) => ({
      z: b.position.z,
      angle: b.userData.angle,
      offset: b.userData.offset,
    })),
    pickups: pickups.map((m) => ({
      kind: m.userData.kind,
      z: m.position.z,
      angle: m.userData.angle,
    })),
  };
}

window.__gyro = {
  zoomGuards: true,
  start: () => startGame({ recalibrate: true }),
  restart: () => startGame({ recalibrate: false }),
  spawnHazardAhead: (distance = 28) => {
    const mesh = spawnMeteor(-state.roll, PLANE_Z - distance, { sizeScale: 1.15, speedScale: 1.25 });
    return { z: mesh.position.z, angle: mesh.userData.angle, sizeScale: mesh.userData.sizeScale };
  },
  spawnBarAhead: (distance = 32, opts = {}) => {
    const mesh = spawnBar(PLANE_Z - distance, { ...opts, force: true });
    if (!mesh) return null;
    return { z: mesh.position.z, angle: mesh.userData.angle, offset: mesh.userData.offset };
  },
  setDistance: (value, snap = false) => {
    state.distance = Math.max(0, value);
    state.scoreFromDistance = Math.max(0, value);
    updateScoreHud(true);
    syncPaletteFromDistance({ snap: !!snap, announce: !snap });
  },
  setBarSpawning: (on) => {
    state.barsEnabled = !!on;
  },
  setMeteorSpawning: (on) => {
    state.meteorEnabled = !!on;
  },
  spawnMeteorWave: (z, opts = {}) => {
    const list = spawnMeteorWave(z, { force: true, ...opts });
    return {
      count: list.length,
      safeArc: waveSafeArc(list),
      angles: list.map((m) => m.userData.angle),
      sizes: list.map((m) => m.userData.sizeScale),
      z: list[0]?.position.z ?? null,
    };
  },
  clearHazards: () => {
    for (const mesh of [...meteors]) recycleMeteor(mesh);
    for (const mesh of [...bars]) recycleBar(mesh);
    clearPickups();
  },
  spawnPickupAhead: (kind = "shield", distance = 22, opts = {}) => {
    const mesh = spawnPickup(kind, PLANE_Z - distance, { ...opts, force: true, kind });
    if (!mesh) return null;
    return { kind: mesh.userData.kind, z: mesh.position.z, angle: mesh.userData.angle };
  },
  grantPowerup: (kind) => {
    grantPowerup(kind);
    return getState();
  },
  spawnNearMissAhead: (distance = 16, opts = {}) => {
    const sizeScale = opts.sizeScale ?? 1;
    const hitR = PLANE_HIT + METEOR_RADIUS * sizeScale;
    const mid = opts.lateral ?? hitR + NEAR_MISS_MARGIN * 0.45;
    const angle = angleForLateral(mid, opts.sign ?? 1);
    const mesh = spawnMeteor(angle, PLANE_Z - distance, { sizeScale, speedScale: opts.speedScale ?? 1 });
    return {
      z: mesh.position.z,
      angle: mesh.userData.angle,
      hitRadius: mesh.userData.hitRadius,
      margin: NEAR_MISS_MARGIN,
      lateral: mid,
    };
  },
  spawnByLateral: (lateral, distance = 16, opts = {}) => {
    const sizeScale = opts.sizeScale ?? 1;
    const angle = angleForLateral(lateral, opts.sign ?? 1);
    const mesh = spawnMeteor(angle, PLANE_Z - distance, { sizeScale, speedScale: opts.speedScale ?? 1 });
    return {
      z: mesh.position.z,
      angle: mesh.userData.angle,
      hitRadius: mesh.userData.hitRadius,
      margin: NEAR_MISS_MARGIN,
      lateral,
    };
  },
  sweepForward: (dz) => sweepForward(dz),
  resetPassCounters: () => {
    state.meteorsPassed = 0;
    state.meteorsSpawned = 0;
  },
  setInvincible: (on) => {
    state.invincible = !!on;
  },
  setPickupSpawning: (on) => {
    state.pickupEnabled = !!on;
  },
  setRoll: (value) => {
    state.desktopRoll = value;
    state.targetRoll = value;
    state.roll = value;
    world.rotation.z = value;
  },
  getState,
  applyViewportCompensation,
  getOrientationAngle,
  formatRecordAt,
  formatScore,
  setMuted: (on) => {
    audio.setMuted(!!on);
    syncMuteButton();
    return audio.isMuted();
  },
  toggleMuted: () => {
    const muted = audio.toggleMuted();
    syncMuteButton();
    return muted;
  },
  crash: () => {
    if (state.mode === "playing") triggerCrash();
  },
  unlockAudio: () => audio.unlock(),
  getMusicState: () => audio.getMusicState(),
  setMusicDistance: (distance, opts) => audio.setMusicDistance(distance, opts || {}),
  musicCutoffForDistance: (distance) => audio.musicCutoffForDistance(distance),
  muffleMusic: (seconds) => audio.muffleMusic(seconds),
  musicTracks: () => audio.tracks,
  setControlMode: (mode) => setControlMode(mode),
  setElapsed: (seconds) => {
    const t = Math.max(0, seconds);
    state.elapsed = t;
    state.growthTime = t;
    if (state.mode === "playing") syncSpeed();
    else {
      state.speedFactor = speedFactorFor(state.growthTime);
      state.speed = SPEED * state.speedFactor;
      updateSpeedHud(true);
    }
  },
  setBoosting: (on) => {
    state.autoBoost = !!on;
    state.steerIdleT = on ? AUTO_BOOST_DELAY : 0;
    if (state.mode === "playing") syncSpeed();
  },
  setTargetRoll: (value) => {
    state.targetRoll = value;
    state.desktopRoll = value;
  },
  advance: (seconds) => {
    const dt = Math.max(0, seconds);
    const timeScale = state.mode === "playing" ? currentTimeScale() : 1;
    state.timeScale = timeScale;
    if (state.mode === "playing" && !state.scoreFrozen) {
      state.elapsed += dt;
      applyGrowth(dt);
      const metres = state.speed * dt * timeScale;
      state.distance += metres;
      state.scoreFromDistance += metres * scoreMultiplier();
      updateScoreHud();
    }
    if (isBoostHeld()) state.flame = 1;
    else if (!isBoostHeld() && state.flame > 0 && dt >= 0.2) state.flame = 0;
    updateExhaust(Math.max(dt, 0.2), performance.now());
    updateLens(0, true);
    placeCamera();
    updateSpeedHud(true);
    updatePowerups(0);
    updatePalette(0);
  },
};

bindSensors();
bindControls();
bootVisuals();
resize();
requestAnimationFrame(tick);
showStart();
