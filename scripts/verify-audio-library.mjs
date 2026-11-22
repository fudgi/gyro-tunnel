import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4186/";

const SFX = [
  "engine",
  "close-call",
  "pickup-shield",
  "pickup-slow",
  "pickup-x2",
  "shield-absorb",
  "power-end-slow",
  "power-end-x2",
  "crash",
  "milestone",
];
const TRACKS = [
  "01-synth-wave-5-darker",
  "02-retro-synths",
  "03-endochde",
  "04-cyber-runner",
  "05-synth-wave-80s",
  "06-synth-wave-2",
  "07-space-city",
  "08-neon-sign-circuit",
  "09-futuristic",
  "10-shadows",
  "11-neon-runner",
  "12-neon-transit",
  "13-long-night-drive",
  "14-mist-city",
  "15-clean-commit-highway",
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

const musicReqs = [];
page.on("response", (res) => {
  const url = res.url();
  if (url.includes("/audio/")) {
    musicReqs.push({ url, status: res.status() });
  }
});

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.waitForSelector("#action");

const credits = await page.evaluate(() => {
  const link = document.querySelector(".credits-line a");
  return { href: link?.getAttribute("href"), text: link?.textContent?.trim(), visible: !!link && getComputedStyle(link.parentElement).display !== "none" };
});
if (credits.href !== "/CREDITS.md") fail(`credits href ${credits.href}`);
if (!credits.visible) fail("credits should be visible on the start screen");

const creditRes = await page.request.get(new URL("CREDITS.md", baseURL).href);
if (creditRes.status() !== 200) fail(`CREDITS.md ${creditRes.status()}`);
const creditText = await creditRes.text();
if (!/CC0/.test(creditText) || !/spaceEngineLow_000/.test(creditText) || !/four-on-the-floor/.test(creditText) || !/Neon Runner/.test(creditText) || !/HoliznaCC0/.test(creditText)) {
  fail("CREDITS.md missing expected entries");
}

for (const name of SFX) {
  for (const ext of ["ogg", "m4a"]) {
    const res = await page.request.get(new URL(`audio/sfx/${name}.${ext}`, baseURL).href);
    if (res.status() !== 200) fail(`sfx ${name}.${ext} -> ${res.status()}`);
    const buf = await res.body();
    if (buf.length < 400) fail(`sfx ${name}.${ext} too small: ${buf.length}`);
  }
}
for (const id of TRACKS) {
  const res = await page.request.get(new URL(`audio/music/${id}.m4a`, baseURL).href);
  if (res.status() !== 200) fail(`music ${id} -> ${res.status()}`);
  const buf = await res.body();
  if (buf.length < 20000) fail(`music ${id} too small: ${buf.length}`);
}
console.log("asset 200s ok", { sfx: SFX.length * 2, tracks: TRACKS.length });

await page.evaluate(() => {
  localStorage.removeItem("gyro-tunnel-board");
  localStorage.removeItem("gyro-tunnel-music");
  localStorage.removeItem("gyro-tunnel-music-v2");
  localStorage.removeItem("gyro-tunnel-music-v3");
  localStorage.removeItem("gyro-tunnel-music-v2");
});

await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.evaluate(() => {
  const g = window.__gyro;
  g.setMeteorSpawning(false);
  g.setBarSpawning(false);
  g.setPickupSpawning(false);
  g.clearHazards();
});
await page.waitForTimeout(600);

const first = await page.evaluate(() => window.__gyro.getMusicState());
if (!first.trackId) fail(`no track after start: ${JSON.stringify(first)}`);
if (!TRACKS.includes(first.trackId)) fail(`unknown track ${first.trackId}`);
if (first.count !== 15) fail(`expected 15 tracks, got ${first.count}`);

await page.waitForFunction(() => {
  const src = window.__gyro.getMusicState().src || "";
  return /\/audio\/music\/.+\.m4a/.test(src);
}, { timeout: 4000 });

const firstSrcOk = musicReqs.some((r) => r.url.includes(first.trackId) && r.status === 200);
if (!firstSrcOk) {
  // the element may have loaded after we recorded; fetch via the page
  const status = await page.evaluate(async (id) => {
    const res = await fetch(`/audio/music/${id}.m4a`, { method: "HEAD" });
    return res.status;
  }, first.trackId);
  if (status !== 200) fail(`playing track not 200: ${first.trackId} ${status}`);
}
console.log("run 1 track", first);

await page.evaluate(() => window.__gyro.crash());
await page.waitForFunction(() => window.__gyro?.getState().mode === "over", { timeout: 4000 });
await page.waitForTimeout(400);
await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.waitForTimeout(500);
const second = await page.evaluate(() => window.__gyro.getMusicState());
if (!second.trackId) fail("no track on second run");
if (second.trackId === first.trackId) fail(`second run repeated ${second.trackId}`);
console.log("run 2 track", second);

// Mute still works and does not break controls
const mutedBefore = await page.evaluate(() => window.__gyro.getState().muted);
await page.click("#mute");
const mutedAfter = await page.evaluate(() => window.__gyro.getState().muted);
if (mutedAfter === mutedBefore) fail("mute should toggle");
await page.click("#mute");

if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
console.log("ALL AUDIO LIBRARY OK", { first: first.trackId, second: second.trackId });
await browser.close();
