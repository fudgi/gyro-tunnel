import { chromium } from "playwright";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4189/";

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

const music = () => page.evaluate(() => window.__gyro.getMusicState());
const assertPlaying = async (label) => {
  const m = await music();
  if (m.paused || !m.playing) fail(`${label}: music element paused ${JSON.stringify(m)}`);
  return m;
};

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.waitForSelector("#action");

// Menu / start screen: first gesture starts the loop, muffled.
await page.evaluate(() => window.__gyro.unlockAudio());
await page.waitForTimeout(400);
const menu = await assertPlaying("menu");
if (menu.trackId !== "neon-sign-circuit") fail(`menu track ${menu.trackId}`);
const menuCut = menu.cutoffHz ?? menu.targetCutoffHz;
if (!(menuCut >= 400 && menuCut <= 650)) fail(`menu cutoff should be ~500, got ${menuCut}`);
if (menu.targetCutoffHz !== 500) fail(`menu target ${menu.targetCutoffHz}`);
const tMenu = menu.currentTime;

await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.waitForTimeout(300);
const run0 = await assertPlaying("run start");
if (!(run0.cutoffHz >= 400 && run0.cutoffHz <= 650) && !(run0.targetCutoffHz === 500)) {
  fail(`run start cutoff ${JSON.stringify(run0)}`);
}
if (run0.currentTime < tMenu - 0.05) {
  // allow tiny backwards jitter, but not a restart at 0 after we had progressed
  if (tMenu > 0.4 && run0.currentTime < 0.15) fail(`run restarted the track: menu=${tMenu} run=${run0.currentTime}`);
}

const mid = await page.evaluate(() => {
  window.__gyro.setDistance(2000, true);
  return window.__gyro.getMusicState();
});
if (mid.paused) fail("paused after setDistance 2000");
if (Math.abs((mid.cutoffHz ?? mid.targetCutoffHz) - 2000) > 1 && Math.abs(mid.targetCutoffHz - 2000) > 1) {
  fail(`2000 m cutoff ${JSON.stringify(mid)}`);
}
const tMid = mid.currentTime;

await page.evaluate(() => window.__gyro.crash());
await page.waitForTimeout(80);
const dying = await assertPlaying("just after crash");
if (dying.targetCutoffHz !== 500) fail(`crash target should be 500, got ${dying.targetCutoffHz}`);
// Mid-ramp: should still be well above muffled if we were at 2000 Hz
if (dying.cutoffHz != null && dying.cutoffHz < 600 && dying.cutoffHz <= 550) {
  // might have already snapped if almost at 500; at 2000 it should still be high
  fail(`crash cutoff dropped instantly: ${dying.cutoffHz}`);
}
const tCrash = dying.currentTime;

// Sample the 3s downward ramp.
await page.waitForTimeout(1500);
const midRamp = await assertPlaying("death ramp 1.5s");
await page.waitForTimeout(1800);
const afterDeath = await assertPlaying("after 3s death ramp");
if (afterDeath.targetCutoffHz !== 500) fail(`after death target ${afterDeath.targetCutoffHz}`);
if (!(afterDeath.cutoffHz >= 400 && afterDeath.cutoffHz <= 650)) {
  fail(`after death cutoff should be ~500, got ${afterDeath.cutoffHz}`);
}
if (tCrash > 1 && afterDeath.currentTime < 0.15) fail("track restarted during death ramp");

const tOver = afterDeath.currentTime;
await page.evaluate(() => window.__gyro.restart());
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.waitForTimeout(250);
const again = await assertPlaying("after restart");
if (!(again.cutoffHz >= 400 && again.cutoffHz <= 650) && again.targetCutoffHz !== 500) {
  fail(`restart should start muffled, got ${JSON.stringify(again)}`);
}
if (tOver > 1 && again.currentTime < 0.15) fail(`restart seeked to start: was ${tOver}, now ${again.currentTime}`);

await page.evaluate(() => window.__gyro.setMuted(true));
const muted = await assertPlaying("while muted");
if (muted.audible) fail("mute should silence music but keep the element playing");
await page.evaluate(() => window.__gyro.setMuted(false));
await assertPlaying("after unmute");

if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
console.log("ALL CONTINUOUS MUSIC OK", {
  menuCut,
  tMenu,
  tMid,
  tCrash,
  tOver,
  againAt: again.currentTime,
  afterDeathCut: afterDeath.cutoffHz,
  midRampCut: midRamp.cutoffHz,
});
await browser.close();
