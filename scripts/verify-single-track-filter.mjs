import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4189/";
const TRACK = "neon-sign-circuit";
const SFX = [
  "engine", "close-call", "pickup-shield", "pickup-slow", "pickup-x2",
  "shield-absorb", "power-end-slow", "power-end-x2", "crash", "milestone",
];
const OLD = [
  "01-techno", "08-neon-sign-circuit", "01-synth-wave-5-darker", "15-clean-commit-highway",
];

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

const fail = (msg) => {
  throw new Error(msg);
};

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.waitForSelector("#action");

const creditRes = await page.request.get(new URL("CREDITS.md", baseURL).href);
if (creditRes.status() !== 200) fail(`CREDITS.md ${creditRes.status()}`);
const creditText = await creditRes.text();
if (!/Neon Sign Circuit/.test(creditText) || !/MintoDog/.test(creditText) || !/spaceEngineLow_000/.test(creditText)) {
  fail("CREDITS.md missing expected entries");
}
if (/HoliznaCC0|Jellyfish|Futuristic|Clean Commit Highway|four-on-the-floor/.test(creditText)) {
  fail("CREDITS.md still lists the old 15-track playlist");
}

for (const name of SFX) {
  for (const ext of ["ogg", "m4a"]) {
    const res = await page.request.get(new URL(`audio/sfx/${name}.${ext}`, baseURL).href);
    if (res.status() !== 200) fail(`sfx ${name}.${ext} -> ${res.status()}`);
  }
}
const trackRes = await page.request.get(new URL(`audio/music/${TRACK}.m4a`, baseURL).href);
if (trackRes.status() !== 200) fail(`music ${TRACK} -> ${trackRes.status()}`);
const trackType = (trackRes.headers()["content-type"] || "").toLowerCase();
if (!trackType.includes("audio") && !trackType.includes("octet-stream")) {
  fail(`music ${TRACK} content-type ${trackType}`);
}
const trackBuf = await trackRes.body();
if (trackBuf.length < 20000) fail(`music ${TRACK} too small: ${trackBuf.length}`);
for (const id of OLD) {
  const res = await page.request.get(new URL(`audio/music/${id}.m4a`, baseURL).href);
  const typ = (res.headers()["content-type"] || "").toLowerCase();
  const isAudio = typ.includes("audio") || typ.includes("octet-stream");
  if (res.status() === 200 && isAudio) fail(`old track ${id} still served as audio`);
  if (![200, 404].includes(res.status())) fail(`old track ${id} unexpected ${res.status()}`);
}
console.log("assets ok", { trackBytes: trackBuf.length });

await page.evaluate(() => {
  localStorage.removeItem("gyro-tunnel-board");
  localStorage.removeItem("gyro-tunnel-music");
  localStorage.removeItem("gyro-tunnel-music-v2");
  localStorage.removeItem("gyro-tunnel-music-v3");
});

await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.waitForTimeout(400);

const startMusic = await page.evaluate(() => window.__gyro.getMusicState());
if (startMusic.trackId !== "neon-sign-circuit") fail(`expected neon-sign-circuit, got ${JSON.stringify(startMusic)}`);
if (startMusic.count !== 1) fail(`expected 1 track, got ${startMusic.count}`);
const startCut = startMusic.cutoffHz ?? startMusic.targetCutoffHz;
if (!(startCut >= 400 && startCut <= 650)) fail(`start cutoff should be ~500, got ${startCut}`);

const cuts = await page.evaluate(() => {
  const g = window.__gyro;
  const at = (d) => {
    g.setDistance(d, true);
    const m = g.getMusicState();
    return { d, cutoff: m.cutoffHz, target: m.targetCutoffHz, expected: g.musicCutoffForDistance(d) };
  };
  return [0, 1000, 2000, 3000, 4000, 5000, 8000].map(at);
});
for (const row of cuts) {
  if (Math.abs(row.cutoff - row.expected) > 1 && Math.abs(row.target - row.expected) > 1) {
    fail(`cutoff at ${row.d}m: got ${row.cutoff}/${row.target}, expected ${row.expected}`);
  }
  console.log("cutoff", row);
}
const expectedMap = { 0: 500, 1000: 1000, 2000: 2000, 3000: 4500, 4000: 9000, 5000: 20000, 8000: 20000 };
for (const row of cuts) {
  if (row.expected !== expectedMap[row.d]) fail(`table at ${row.d}: ${row.expected}`);
}

await page.evaluate(() => window.__gyro.setDistance(0, true));
await page.evaluate(() => window.__gyro.restart());
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.waitForTimeout(250);
const afterRestart = await page.evaluate(() => window.__gyro.getMusicState());
const restartCut = afterRestart.cutoffHz ?? afterRestart.targetCutoffHz;
if (!(restartCut >= 400 && restartCut <= 650)) fail(`restart cutoff should snap back to ~500, got ${restartCut}`);

await page.evaluate(() => window.__gyro.setMuted(true));
const muted = await page.evaluate(() => window.__gyro.getMusicState());
if (muted.playing) fail("mute should silence music");
await page.evaluate(() => window.__gyro.setMuted(false));

// Long simulated run at late-game speed with boost held; count must stay in cap.
await page.evaluate(() => {
  const g = window.__gyro;
  g.setInvincible(true);
  g.setElapsed(70);
  g.setDistance(2500, true);
});
await page.keyboard.down("Space");
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < 8000) {
  const snap = await page.evaluate(() => {
    const s = window.__gyro.getState();
    return {
      approaching: s.approachingCount,
      cap: s.hazardCap,
      capMin: s.hazardCapMin,
      capMax: s.hazardCapMax,
      waveCap: s.maxWaveMeteors,
      meteorCount: s.meteorCount,
      barCount: s.barCount,
      boosting: s.boosting,
      speedFactor: s.speedFactor,
    };
  });
  samples.push(snap);
  if (snap.approaching > snap.cap) fail(`approaching ${snap.approaching} exceeded cap ${snap.cap}`);
  if (snap.cap < snap.capMin || snap.cap > snap.capMax) fail(`cap ${snap.cap} outside ${snap.capMin}-${snap.capMax}`);
  await page.waitForTimeout(50);
}
await page.keyboard.up("Space");
const maxApproaching = Math.max(...samples.map((s) => s.approaching));
const last = samples[samples.length - 1];
if (!samples.some((s) => s.boosting)) fail("boost was not held during the cap run");
if (maxApproaching < 1) fail("no hazards appeared during the cap run");
console.log("cap run", { samples: samples.length, maxApproaching, last });

// Wave size and a passable gap, including a close second wave.
await page.evaluate(() => {
  const g = window.__gyro;
  g.clearHazards();
  g.setMeteorSpawning(false);
  g.setBarSpawning(false);
});
const waveA = await page.evaluate(() => window.__gyro.spawnMeteorWave(-180, { count: 8 }));
if (waveA.count > 3) fail(`wave cap failed: ${waveA.count}`);
if (waveA.safeArc < 0.79) fail(`wave gap too small: ${waveA.safeArc}`);
const waveB = await page.evaluate(() => window.__gyro.spawnMeteorWave(-200, { count: 3, force: false }));
console.log("waves", { waveA, waveB });

if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
console.log("ALL SINGLE-TRACK FILTER + CAP OK", {
  startCut,
  restartCut,
  maxApproaching,
  cap: last.cap,
  waveA: waveA.count,
  track: TRACK,
});
await browser.close();
