import * as THREE from "three";
import { makeGlowSprite, disposeObject } from "./glow.js";

const STORAGE_KEY = "gyro-style";

const THEME = {
  bg: "#0e1420",
  text: "#f4f0ea",
  muted: "#a8b0be",
  accent: "#ff6b4a",
  danger: "#ff6b4a",
  overlayA: "rgba(255, 107, 74, 0.12)",
  overlayB: "rgba(14, 20, 32, 0.74)",
  fog: 0x0e1420,
  fogDensity: 0.0025,
  clear: 0x0e1420,
  toneMapping: THREE.NoToneMapping,
  exposure: 1.0,
};

// Obstacles stay coral/amber on every tunnel palette so they stay readable.
export const OBSTACLE_COLORS = [0xff6b4a, 0xf0b429];

export const PALETTES = [
  {
    id: "coral",
    bg: 0x0e1420,
    bgCss: "#0e1420",
    accent: "#ff6b4a",
    overlayA: "rgba(255, 107, 74, 0.12)",
    overlayB: "rgba(14, 20, 32, 0.74)",
    rings: [
      { core: 0xff6b4a, glow: 0xff7a5c, emit: 0.26, halo: 0.15 },
      { core: 0x1b2a4a, glow: 0x7ea0ff, emit: 0.4, halo: 0.11 },
      { core: 0xf4efe8, glow: 0xffd2a0, emit: 0.2, halo: 0.13 },
    ],
  },
  {
    id: "magenta",
    bg: 0x140a1c,
    bgCss: "#140a1c",
    accent: "#ff5cb8",
    overlayA: "rgba(255, 92, 184, 0.14)",
    overlayB: "rgba(20, 10, 28, 0.74)",
    rings: [
      { core: 0xff4fa3, glow: 0xff79c2, emit: 0.28, halo: 0.16 },
      { core: 0x2a1244, glow: 0xc07aff, emit: 0.42, halo: 0.12 },
      { core: 0xf3e8ff, glow: 0xe0b8ff, emit: 0.2, halo: 0.13 },
    ],
  },
  {
    id: "teal",
    bg: 0x07151a,
    bgCss: "#07151a",
    accent: "#3ce0d0",
    overlayA: "rgba(60, 224, 208, 0.14)",
    overlayB: "rgba(7, 21, 26, 0.74)",
    rings: [
      { core: 0x3ce0d0, glow: 0x7af0e6, emit: 0.28, halo: 0.16 },
      { core: 0x0c2c36, glow: 0x4ec8e8, emit: 0.4, halo: 0.12 },
      { core: 0xe7f7f4, glow: 0xb8fff0, emit: 0.2, halo: 0.13 },
    ],
  },
  {
    id: "crimson",
    bg: 0x16090a,
    bgCss: "#16090a",
    accent: "#ff6a2a",
    overlayA: "rgba(255, 106, 42, 0.14)",
    overlayB: "rgba(22, 9, 10, 0.74)",
    rings: [
      { core: 0xff6a2a, glow: 0xff8a4a, emit: 0.28, halo: 0.16 },
      { core: 0x3a1014, glow: 0xff5a5a, emit: 0.4, halo: 0.12 },
      { core: 0xffe8d8, glow: 0xffc090, emit: 0.2, halo: 0.13 },
    ],
  },
  {
    id: "emerald",
    bg: 0x07140e,
    bgCss: "#07140e",
    accent: "#8dff4a",
    overlayA: "rgba(141, 255, 74, 0.12)",
    overlayB: "rgba(7, 20, 14, 0.74)",
    rings: [
      { core: 0x8dff4a, glow: 0xb6ff7a, emit: 0.28, halo: 0.16 },
      { core: 0x0f2a18, glow: 0x4dff9a, emit: 0.4, halo: 0.12 },
      { core: 0xe8f8ea, glow: 0xc8ffb0, emit: 0.2, halo: 0.13 },
    ],
  },
];

const _colA = new THREE.Color();
const _colB = new THREE.Color();

function lerpHex(a, b, t) {
  return _colA.setHex(a).lerp(_colB.setHex(b), t).getHex();
}

function lerpNum(a, b, t) {
  return a + (b - a) * t;
}

export function mixPalette(fromIndex, toIndex, t) {
  const n = PALETTES.length;
  const A = PALETTES[((fromIndex % n) + n) % n];
  const B = PALETTES[((toIndex % n) + n) % n];
  const k = Math.max(0, Math.min(1, t));
  return {
    id: k < 1 ? `${A.id}-${B.id}` : B.id,
    bg: lerpHex(A.bg, B.bg, k),
    bgCss: `#${_colA.setHex(lerpHex(A.bg, B.bg, k)).getHexString()}`,
    accent: `#${_colA.set(A.accent).lerp(_colB.set(B.accent), k).getHexString()}`,
    overlayA: k < 0.5 ? A.overlayA : B.overlayA,
    overlayB: k < 0.5 ? A.overlayB : B.overlayB,
    rings: A.rings.map((ring, i) => ({
      core: lerpHex(ring.core, B.rings[i].core, k),
      glow: lerpHex(ring.glow, B.rings[i].glow, k),
      emit: lerpNum(ring.emit, B.rings[i].emit, k),
      halo: lerpNum(ring.halo, B.rings[i].halo, k),
    })),
  };
}

export function applyPaletteCss(mix) {
  const root = document.documentElement;
  root.style.setProperty("--bg", mix.bgCss);
  root.style.setProperty("--accent", mix.accent);
  root.style.setProperty("--danger", mix.accent);
  root.style.setProperty("--overlay-a", mix.overlayA);
  root.style.setProperty("--overlay-b", mix.overlayB);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", mix.bgCss);
}

export const PICKUP_STYLES = {
  shield: { color: 0x7ee0ff, label: "Shield", tag: "Shield" },
  slow: { color: 0xd4b8ff, label: "Slow-mo", tag: "Slow-mo" },
  x2: { color: 0xffd45c, label: "2× Score", tag: "2×" },
};


const pickupIconTextures = new Map();

function cssHex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function getPickupIconTexture(kind, color) {
  const key = `${kind}-${color}`;
  const cached = pickupIconTextures.get(key);
  if (cached) return cached;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const accent = cssHex(color);
  ctx.translate(cx, cy);
  const plate = ctx.createRadialGradient(0, 0, 16, 0, 0, 112);
  plate.addColorStop(0, "rgba(8, 12, 22, 0.88)");
  plate.addColorStop(0.72, "rgba(8, 12, 22, 0.55)");
  plate.addColorStop(1, "rgba(8, 12, 22, 0)");
  ctx.fillStyle = plate;
  ctx.beginPath();
  ctx.arc(0, 0, 112, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 22;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 16;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (kind === "shield") {
    ctx.beginPath();
    ctx.moveTo(0, -88);
    ctx.lineTo(76, -62);
    ctx.lineTo(84, -18);
    ctx.lineTo(84, 6);
    ctx.quadraticCurveTo(84, 64, 0, 104);
    ctx.quadraticCurveTo(-84, 64, -84, 6);
    ctx.lineTo(-84, -18);
    ctx.lineTo(-76, -62);
    ctx.closePath();
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 18;
    ctx.stroke();
  } else if (kind === "slow") {
    ctx.beginPath();
    ctx.arc(0, 0, 78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -46);
    ctx.moveTo(0, 0);
    ctx.lineTo(38, 18);
    ctx.stroke();
  } else {
    ctx.font = "700 118px system-ui, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("2×", 0, 6);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  pickupIconTextures.set(key, tex);
  return tex;
}

export function clearStaleStylePrefs() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function applyCssTheme() {
  const root = document.documentElement;
  delete root.dataset.style;
  root.style.setProperty("--bg", THEME.bg);
  root.style.setProperty("--text", THEME.text);
  root.style.setProperty("--muted", THEME.muted);
  root.style.setProperty("--accent", THEME.accent);
  root.style.setProperty("--danger", THEME.danger);
  root.style.setProperty("--overlay-a", THEME.overlayA);
  root.style.setProperty("--overlay-b", THEME.overlayB);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME.bg);
}

function makeRingList(buildRing, spacing, count, parent) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const ring = buildRing(i);
    ring.position.z = -i * spacing - 4;
    parent.add(ring);
    list.push(ring);
  }
  return list;
}

function scrollRings(list, wall, dz, spacing, count, despawnZ) {
  for (const ring of list) {
    ring.position.z += dz;
    if (ring.position.z > despawnZ) ring.position.z -= spacing * count;
  }
  if (wall) {
    wall.position.z += dz;
    const wallLen = spacing * count;
    if (wall.position.z > 0) wall.position.z -= wallLen;
  }
}

function triangularPlane({ body, accent, engine, glowColor, glowScale = 1.3 }) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({
    color: body,
    flatShading: true,
    emissive: 0x111111,
    emissiveIntensity: 0.2,
  });
  const accentMat = new THREE.MeshLambertMaterial({
    color: accent,
    flatShading: true,
    emissive: accent,
    emissiveIntensity: 0.35,
  });

  const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.35, 3), bodyMat);
  fuselage.rotation.x = -Math.PI / 2;
  fuselage.position.z = -0.05;
  g.add(fuselage);

  const shape = new THREE.Shape();
  shape.moveTo(0, 0.15);
  shape.lineTo(-1.05, -0.55);
  shape.lineTo(0, -0.18);
  shape.lineTo(1.05, -0.55);
  shape.closePath();
  const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape), bodyMat);
  wing.rotation.x = -Math.PI / 2;
  wing.position.z = 0.05;
  g.add(wing);

  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 3), accentMat);
  fin.position.set(0, 0.16, 0.42);
  g.add(fin);

  const engineMesh = new THREE.Mesh(
    new THREE.CircleGeometry(0.09, 10),
    new THREE.MeshBasicMaterial({ color: engine }),
  );
  engineMesh.position.z = 0.7;
  g.add(engineMesh);
  const spr = makeGlowSprite(glowColor || engine, glowScale);
  spr.position.z = 0.72;
  g.add(spr);
  g.userData.engineSprite = spr;
  return g;
}

export function createVisuals(ctx) {
  const { scene, world, renderer, radius, spacing, count, meteorR } = ctx;

  renderer.setClearColor(THEME.clear, 1);
  renderer.toneMapping = THEME.toneMapping;
  renderer.toneMappingExposure = THEME.exposure;
  scene.fog = new THREE.FogExp2(THEME.fog, THEME.fogDensity);
  scene.background = new THREE.Color(THEME.clear);

  const leftovers = [];
  const ambient = new THREE.AmbientLight(0xffffff, 0.85);
  const key = new THREE.DirectionalLight(0xffffff, 0.35);
  key.position.set(2, 8, 6);
  scene.add(ambient, key);
  leftovers.push(ambient, key);

  const group = new THREE.Group();
  world.add(group);

  const currentRing = PALETTES[0].rings.map((c) => ({ ...c }));
  const coreGeo = new THREE.TorusGeometry(radius, 0.16, 4, 24);
  const glowGeo = new THREE.TorusGeometry(radius, 0.4, 6, 32);
  const slabGeo = new THREE.BoxGeometry(0.22, 0.22, 2.4);
  const coreMats = currentRing.map((c) =>
    new THREE.MeshLambertMaterial({
      color: c.core,
      emissive: c.glow,
      emissiveIntensity: c.emit,
      flatShading: true,
      fog: true,
    }),
  );
  const glowMats = currentRing.map((c) =>
    new THREE.MeshBasicMaterial({
      color: c.glow,
      transparent: true,
      opacity: c.halo,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    }),
  );
  const slabMats = currentRing.map((c) =>
    new THREE.MeshLambertMaterial({
      color: c.core,
      emissive: c.glow,
      emissiveIntensity: c.emit * 0.7,
      flatShading: true,
      fog: true,
    }),
  );
  leftovers.push({
    removeFromParent() {},
    traverse(fn) {
      fn({ geometry: coreGeo, material: [...coreMats, ...glowMats, ...slabMats] });
      fn({ geometry: glowGeo });
      fn({ geometry: slabGeo });
    },
  });

  const list = makeRingList(
    (i) => {
      const rg = new THREE.Group();
      const pal = i % currentRing.length;
      const ring = new THREE.Mesh(coreGeo, coreMats[pal]);
      const halo = new THREE.Mesh(glowGeo, glowMats[pal]);
      halo.renderOrder = -1;
      rg.add(halo, ring);
      if (i % 3 === 0) {
        for (let s = 0; s < 4; s++) {
          const slab = new THREE.Mesh(slabGeo, slabMats[(i + s) % 3]);
          const a = (s / 4) * Math.PI * 2 + 0.4;
          slab.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0.6);
          rg.add(slab);
        }
      }
      return rg;
    },
    spacing,
    count,
    group,
  );

  const barBox = new THREE.BoxGeometry(1, 1, 1);
  const barCap = new THREE.SphereGeometry(0.22, 8, 6);

  function createBar() {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      barBox,
      new THREE.MeshLambertMaterial({
        color: 0xf4efe8,
        emissive: 0xf4efe8,
        emissiveIntensity: 0.4,
        flatShading: true,
        transparent: true,
        opacity: 0.96,
      }),
    );
    const glow = new THREE.Mesh(
      barBox,
      new THREE.MeshBasicMaterial({
        color: 0xff6b4a,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const capMat = new THREE.MeshBasicMaterial({
      color: 0xff6b4a,
      transparent: true,
      opacity: 0.9,
    });
    const capA = new THREE.Mesh(barCap, capMat);
    const capB = new THREE.Mesh(barCap, capMat);
    group.add(glow, core, capA, capB);
    group.userData.core = core;
    group.userData.glow = glow;
    group.userData.capA = capA;
    group.userData.capB = capB;
    return group;
  }

  function createMeteor() {
    const kind = Math.floor(Math.random() * 3);
    const col = OBSTACLE_COLORS[kind % OBSTACLE_COLORS.length];
    let geo;
    if (kind === 0) geo = new THREE.BoxGeometry(meteorR * 1.85, meteorR * 0.7, meteorR * 1.5);
    else if (kind === 1) geo = new THREE.BoxGeometry(meteorR * 1.1, meteorR * 1.8, meteorR * 1.1);
    else geo = new THREE.OctahedronGeometry(meteorR * 1.05, 0);
    return new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        color: col,
        flatShading: true,
        emissive: col,
        emissiveIntensity: 0.18,
      }),
    );
  }

  function createPickup(kind) {
    const style = PICKUP_STYLES[kind] || PICKUP_STYLES.x2;
    const group = new THREE.Group();
    const spin = new THREE.Group();
    let geo;
    // Visual core is ~1.8× the old size; hit radius stays unchanged in gameplay.
    if (kind === "shield") geo = new THREE.IcosahedronGeometry(0.76, 0);
    else if (kind === "slow") geo = new THREE.OctahedronGeometry(0.82, 0);
    else geo = new THREE.TetrahedronGeometry(0.9, 0);
    const core = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        color: style.color,
        emissive: style.color,
        emissiveIntensity: 1.15,
        flatShading: true,
        transparent: true,
        opacity: 1,
        fog: false,
      }),
    );
    const shell = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        wireframe: true,
        fog: false,
        depthWrite: false,
      }),
    );
    shell.scale.setScalar(1.12);
    spin.add(core, shell);

    const glow = makeGlowSprite(style.color, 3.8, { fog: false, opacity: 0.95 });
    const halo = makeGlowSprite(style.color, 6.4, { fog: false, opacity: 0.4 });

    const icon = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getPickupIconTexture(kind, style.color),
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    icon.material.depthTest = false;
    icon.scale.set(1.95, 1.95, 1);
    icon.position.z = 0.45;
    icon.renderOrder = 2;

    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.055, 8, 40),
      new THREE.MeshBasicMaterial({
        color: style.color,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.22, 110, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: style.color,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      }),
    );
    beam.rotation.x = Math.PI / 2;
    beam.position.z = -28;

    const beacon = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.97, 0.1, 8, 64),
      new THREE.MeshBasicMaterial({
        color: style.color,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );

    const flightR = 5.4;
    const spokeLen = radius;
    const spoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.07, spokeLen, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: style.color,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      }),
    );
    spoke.position.y = (radius - 2 * flightR) / 2;

    const light = new THREE.PointLight(style.color, 1.8, 16, 2);
    light.position.set(0, 0, 0.2);

    const sparkles = [];
    for (let i = 0; i < 7; i += 1) {
      const spark = makeGlowSprite(0xffffff, 0.28 + (i % 3) * 0.08, { fog: false, opacity: 0.7 });
      spark.material.color.setHex(style.color);
      spark.userData.phase = i * 0.9;
      spark.userData.speed = 1.6 + (i % 4) * 0.45;
      spark.userData.radius = 0.7 + (i % 3) * 0.28;
      spark.userData.back = 0.4 + i * 0.35;
      sparkles.push(spark);
      group.add(spark);
    }

    group.add(beacon, beam, spoke, halo, glow, marker, icon, light, spin);
    group.userData.kind = kind;
    group.userData.core = core;
    group.userData.spin = spin;
    group.userData.glow = glow;
    group.userData.halo = halo;
    group.userData.icon = icon;
    group.userData.marker = marker;
    group.userData.beacon = beacon;
    group.userData.beam = beam;
    group.userData.spoke = spoke;
    group.userData.sparkles = sparkles;
    group.userData.color = style.color;
    return group;
  }

  function setPalette(fromIndex, toIndex, t) {
    const mix = mixPalette(fromIndex, toIndex, t);
    for (let i = 0; i < currentRing.length; i += 1) {
      currentRing[i] = mix.rings[i];
      coreMats[i].color.setHex(mix.rings[i].core);
      coreMats[i].emissive.setHex(mix.rings[i].glow);
      coreMats[i].emissiveIntensity = mix.rings[i].emit;
      glowMats[i].color.setHex(mix.rings[i].glow);
      glowMats[i].opacity = mix.rings[i].halo;
      slabMats[i].color.setHex(mix.rings[i].core);
      slabMats[i].emissive.setHex(mix.rings[i].glow);
      slabMats[i].emissiveIntensity = mix.rings[i].emit * 0.7;
    }
    renderer.setClearColor(mix.bg, 1);
    if (scene.fog) scene.fog.color.setHex(mix.bg);
    if (scene.background && scene.background.isColor) scene.background.setHex(mix.bg);
    applyPaletteCss(mix);
    return mix;
  }

  const plane = triangularPlane({
    body: 0xf7f4ef,
    accent: 0xff6b4a,
    engine: 0xff6b4a,
    glowColor: 0xff8a6a,
    glowScale: 1.1,
  });
  const planeLight = new THREE.PointLight(0xffe8dc, 2.2, 12, 2);

  const listHomes = list.map((ring) => ring.position.z);
  const tunnel = {
    group,
    list,
    wall: null,
    scroll(dz) {
      scrollRings(list, null, dz, spacing, count, 6);
    },
    reset() {
      list.forEach((ring, i) => {
        ring.position.z = listHomes[i];
      });
    },
  };

  return {
    leftovers,
    stars: null,
    tunnel,
    plane,
    planeLight,
    createMeteor,
    createBar,
    createPickup,
    setPalette,
    update(_dt, ctx = {}) {
      const t = (ctx.now ?? performance.now()) * 0.001;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.25);
      const boost = Math.max(0, Math.min(1, ctx.lens ?? 0));
      for (let i = 0; i < glowMats.length; i += 1) {
        const base = currentRing[i].halo;
        glowMats[i].opacity = base * (0.84 + 0.26 * pulse) * (1 + 0.35 * boost);
        coreMats[i].emissiveIntensity = currentRing[i].emit * (0.88 + 0.22 * pulse) * (1 + 0.28 * boost);
        slabMats[i].emissiveIntensity = currentRing[i].emit * 0.7 * (0.88 + 0.22 * pulse) * (1 + 0.28 * boost);
      }
    },
    dispose() {
      tunnel.group.removeFromParent();
      disposeObject(tunnel.group);
      plane.removeFromParent();
      disposeObject(plane);
      planeLight.removeFromParent();
      for (const obj of leftovers) {
        obj.removeFromParent();
        disposeObject(obj);
      }
    },
  };
}
