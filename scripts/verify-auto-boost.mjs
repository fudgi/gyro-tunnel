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

const state = () => page.evaluate(() => window.__gyro.getState());

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.waitForSelector("#action");

await page.evaluate(() => {
  window.__gyro.setControlMode("tap");
});
const hint = await page.evaluate(() => document.getElementById("hint")?.textContent || "");
if (!/stay steady to boost/i.test(hint)) fail(`tap hint should mention stay steady, got: ${hint}`);
if (/hold the middle/i.test(hint)) fail(`tap hint still mentions middle boost: ${hint}`);

await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.evaluate(() => window.__gyro.setInvincible(true));

const start = await state();
if (start.boosting || start.autoBoost) fail("boost should be off at run start");
if (start.autoBoostDelay !== 2) fail(`delay ${start.autoBoostDelay}`);
if (start.steerDeadzoneDeg !== 8) fail(`deadzone ${start.steerDeadzoneDeg}`);

// Middle of the screen and Space must not engage boost.
await page.mouse.move(195, 422);
await page.mouse.down();
await page.waitForTimeout(400);
const midHold = await state();
if (midHold.boosting) fail("holding the middle of the screen should not boost");
await page.mouse.up();
await page.keyboard.down("Space");
await page.waitForTimeout(400);
const spaceHold = await state();
if (spaceHold.boosting) fail("Space should not boost");
await page.keyboard.up("Space");
if (spaceHold.steerIdleT <= 0) fail("idle timer should keep counting during non-steer taps");

// Idle 2s → auto boost, with the English cue.
await page.waitForFunction(() => window.__gyro.getState().boosting === true, { timeout: 4000 });
const autoOn = await state();
if (!autoOn.autoBoost) fail("autoBoost flag should be set");
if (!/Auto boost/i.test(autoOn.floatLabel)) fail(`missing Auto boost label, got "${autoOn.floatLabel}"`);
console.log("auto on", { idle: autoOn.steerIdleT, label: autoOn.floatLabel, kmh: autoOn.speedKmh });

// Steering cancels immediately and restarts the timer.
await page.keyboard.down("ArrowLeft");
await page.waitForTimeout(80);
const turning = await state();
if (turning.boosting || turning.autoBoost) fail("steering should cancel auto-boost");
if (turning.steerIdleT > 0.05) fail(`idle timer should reset on steer, got ${turning.steerIdleT}`);
await page.waitForTimeout(400);
const stillTurning = await state();
if (stillTurning.boosting) fail("boost stayed on while holding a turn");
await page.keyboard.up("ArrowLeft");

// After release, need another full 2s. A short wait must not re-enable it.
await page.waitForTimeout(800);
const midWait = await state();
if (midWait.boosting) fail("boost came back before 2s of idle");
await page.waitForFunction(() => window.__gyro.getState().boosting === true, { timeout: 4000 });
const autoOn2 = await state();
if (!autoOn2.autoBoost) fail("auto-boost should return after another 2s idle");

// Gyro: stay still → boost; a changing targetRoll above 8°/s cancels it.
await page.evaluate(() => window.__gyro.setControlMode("gyro"));
await page.keyboard.down("ArrowRight");
await page.waitForTimeout(80);
const gyroTurn = await state();
if (gyroTurn.boosting) fail("gyro/keyboard steer should cancel boost");
await page.keyboard.up("ArrowRight");
await page.waitForFunction(() => window.__gyro.getState().boosting === true, { timeout: 4000 });

await page.evaluate(() => {
  window.__gtNudge = setInterval(() => {
    const s = window.__gyro.getState();
    window.__gyro.setTargetRoll(s.targetRoll + 0.25);
  }, 16);
});
await page.waitForTimeout(250);
const gyroWiggle = await state();
await page.evaluate(() => clearInterval(window.__gtNudge));
if (gyroWiggle.boosting) fail(`gyro rotation should cancel boost, rateDeg=${gyroWiggle.steerRateDeg}`);
if (!(gyroWiggle.steerRateDeg > 8)) fail(`expected rate above 8°/s, got ${gyroWiggle.steerRateDeg}`);

await page.evaluate(() => window.__gyro.crash());
await page.waitForTimeout(200);
const crashed = await state();
if (crashed.boosting || crashed.autoBoost) fail("boost should stop after a crash");

await page.evaluate(() => window.__gyro.restart());
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.evaluate(() => window.__gyro.setInvincible(true));
await page.waitForTimeout(400);
const afterRestart = await state();
if (afterRestart.boosting || afterRestart.autoBoost) fail("timer should reset on a new run");
if (afterRestart.steerIdleT > 0.8) fail(`new run idle timer too high: ${afterRestart.steerIdleT}`);

if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
console.log("ALL AUTO-BOOST OK", {
  delay: start.autoBoostDelay,
  deadzone: start.steerDeadzoneDeg,
  hint,
  rateWhenWiggling: gyroWiggle.steerRateDeg,
});
await browser.close();
