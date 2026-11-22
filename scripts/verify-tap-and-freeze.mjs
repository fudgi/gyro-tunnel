import { chromium } from "playwright";
import path from "node:path";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4184/";
const shotDir = path.resolve("/workspace/gyro-tunnel/screenshots");

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.waitForSelector("#control-mode");
await page.evaluate(() => {
  localStorage.removeItem("gyro-tunnel-board");
  window.__gyro.setControlMode("tap");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#control-mode");
await page.waitForTimeout(300);

const start = await page.evaluate(() => ({
  label: document.getElementById("control-mode")?.innerText,
  mode: window.__gyro.getState().controlMode,
  zonesHidden: document.getElementById("tap-zones")?.classList.contains("hidden"),
  muteTop: document.getElementById("corner-controls") ? true : false,
}));
if (start.label.trim() !== "TAP" && start.label.trim() !== "Tap") {
  // CSS uppercase - innerText may be TAP
  if (!/tap/i.test(start.label)) throw new Error(`start toggle: ${start.label}`);
}
if (start.mode !== "tap") throw new Error(`saved mode should be tap, got ${start.mode}`);
if (!start.zonesHidden) throw new Error("zones should be hidden on the start screen");
await page.screenshot({ path: path.join(shotDir, "tap-mode-start.png"), fullPage: true });
console.log("start ok", start);

await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.evaluate(() => {
  const g = window.__gyro;
  g.setMeteorSpawning(false);
  g.setBarSpawning(false);
  g.setPickupSpawning(false);
  g.clearHazards();
  g.setRoll(0);
  g.setBoosting(false);
});
await page.waitForTimeout(120);

const playUi = await page.evaluate(() => {
  const zones = document.getElementById("tap-zones");
  const hint = document.getElementById("hint")?.innerText || "";
  return {
    zonesHidden: zones?.classList.contains("hidden"),
    hint,
    mode: window.__gyro.getState().controlMode,
  };
});
if (playUi.zonesHidden) throw new Error("zones should be visible while playing in tap mode");
if (!/hold left or right/i.test(playUi.hint)) throw new Error(`hint: ${playUi.hint}`);

const left = page.locator("#tap-left");
const right = page.locator("#tap-right");
const boxL = await left.boundingBox();
const boxR = await right.boundingBox();
if (!boxL || !boxR) throw new Error("zone boxes missing");
if (boxL.y < 844 * 0.65) throw new Error(`left zone too high: ${boxL.y}`);
if (Math.abs(boxL.height - boxR.height) > 2) throw new Error("zones should be the same height");

const startRoll = await page.evaluate(() => window.__gyro.getState().roll);
await page.mouse.move(boxL.x + boxL.width / 2, boxL.y + boxL.height * 0.7);
await page.mouse.down();
await page.waitForTimeout(450);
const leftHeld = await page.evaluate(() => window.__gyro.getState());
if (!leftHeld.tapLeft) throw new Error("left zone should be held");
if (leftHeld.boosting) throw new Error("holding a turn zone should not boost");
if (!(leftHeld.roll > startRoll + 0.15)) {
  throw new Error(`left hold should increase roll, ${startRoll} -> ${leftHeld.roll}`);
}
await page.mouse.up();
await page.waitForTimeout(80);

const midRoll = await page.evaluate(() => {
  window.__gyro.setRoll(0);
  return window.__gyro.getState().roll;
});
await page.mouse.move(boxR.x + boxR.width / 2, boxR.y + boxR.height * 0.7);
await page.mouse.down();
await page.waitForTimeout(450);
const rightHeld = await page.evaluate(() => window.__gyro.getState());
if (!rightHeld.tapRight) throw new Error("right zone should be held");
if (!(rightHeld.roll < midRoll - 0.15)) {
  throw new Error(`right hold should decrease roll, ${midRoll} -> ${rightHeld.roll}`);
}
await page.mouse.up();
await page.waitForTimeout(80);

// both pressed = no net rotation
await page.evaluate(() => window.__gyro.setRoll(0));
const both = await page.evaluate(async () => {
  const l = document.getElementById("tap-left");
  const r = document.getElementById("tap-right");
  const fire = (el, type, id, x, y) => {
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: id, pointerType: "touch",
      clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1,
    }));
  };
  const lb = l.getBoundingClientRect();
  const rb = r.getBoundingClientRect();
  fire(l, "pointerdown", 11, lb.left + lb.width / 2, lb.top + lb.height * 0.7);
  fire(r, "pointerdown", 12, rb.left + rb.width / 2, rb.top + rb.height * 0.7);
  const start = window.__gyro.getState();
  await new Promise((res) => setTimeout(res, 400));
  const mid = window.__gyro.getState();
  fire(l, "pointerup", 11, lb.left + lb.width / 2, lb.top + lb.height * 0.7);
  fire(r, "pointerup", 12, rb.left + rb.width / 2, rb.top + rb.height * 0.7);
  return { start: start.roll, mid: mid.roll, left: start.tapLeft || mid.tapLeft, right: start.tapRight || mid.tapRight, steer: mid.tapSteer };
});
if (Math.abs(both.mid - both.start) > 0.08) {
  throw new Error(`both zones should cancel rotation, ${JSON.stringify(both)}`);
}
console.log("both-cancel ok", both);

// boost still works above the zones
await page.evaluate(() => window.__gyro.setBoosting(false));
await page.mouse.move(195, 280);
await page.mouse.down();
await page.waitForTimeout(80);
const boosted = await page.evaluate(() => window.__gyro.getState().boosting);
if (!boosted) throw new Error("tap above the zones should still boost");
await page.mouse.up();
await page.evaluate(() => window.__gyro.setBoosting(false));

await page.evaluate(() => window.__gyro.setRoll(0));
await page.mouse.move(boxL.x + boxL.width / 2, boxL.y + boxL.height * 0.7);
await page.mouse.down();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shotDir, "tap-mode-play.png"), fullPage: true });
await page.mouse.up();
console.log("play screenshot ok");

// keyboard still works in tap mode
await page.evaluate(() => window.__gyro.setRoll(0));
await page.keyboard.down("ArrowLeft");
await page.waitForTimeout(350);
const keyLeft = await page.evaluate(() => window.__gyro.getState().roll);
await page.keyboard.up("ArrowLeft");
if (!(keyLeft > 0.12)) throw new Error(`arrows should turn in tap mode, roll=${keyLeft}`);

// --- score freeze ---
await page.evaluate(() => {
  const g = window.__gyro;
  g.clearHazards();
  g.setMeteorSpawning(false);
  g.setBarSpawning(false);
  g.setPickupSpawning(false);
  g.setRoll(0);
  g.setBoosting(false);
});
await page.evaluate(() => window.__gyro.spawnHazardAhead(8));
await page.waitForFunction(() => {
  const s = window.__gyro?.getState();
  return s && (s.mode === "exploding" || s.mode === "over");
}, { timeout: 6000 });
const frozen = await page.evaluate(() => {
  const s = window.__gyro.getState();
  return { mode: s.mode, score: s.score, finalScore: s.finalScore, frozen: s.scoreFrozen };
});
if (!frozen.frozen) throw new Error(`score should freeze on crash: ${JSON.stringify(frozen)}`);
const crashScore = frozen.finalScore || frozen.score;
await page.waitForTimeout(2500);
const later = await page.evaluate(() => {
  const s = window.__gyro.getState();
  const finalText = document.getElementById("final-score")?.innerText || "";
  return { mode: s.mode, score: s.score, finalScore: s.finalScore, frozen: s.scoreFrozen, finalText };
});
if (later.score !== crashScore || later.finalScore !== crashScore) {
  throw new Error(`score changed after crash: ${crashScore} -> ${JSON.stringify(later)}`);
}
if (later.mode === "over") {
  const expected = crashScore.toLocaleString("en-US");
  if (later.finalText.trim() !== expected) throw new Error(`game-over score ${later.finalText} != ${expected}`);
} else {
  await page.waitForFunction(() => window.__gyro.getState().mode === "over", { timeout: 4000 });
  const over = await page.evaluate(() => ({
    score: window.__gyro.getState().score,
    text: document.getElementById("final-score")?.innerText,
    row: document.querySelector(".board-row")?.innerText,
  }));
  if (over.score !== crashScore) throw new Error(`over score ${over.score} != ${crashScore}`);
  if (over.text.trim() !== crashScore.toLocaleString("en-US")) throw new Error(`over text ${over.text}`);
  if (!over.row.includes(crashScore.toLocaleString("en-US"))) throw new Error(`board row ${over.row}`);
}
console.log("freeze ok", { crashScore, later });

await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
const reset = await page.evaluate(() => window.__gyro.getState());
if (reset.scoreFrozen) throw new Error("scoreFrozen should clear on restart");
if (reset.score >= crashScore) throw new Error(`score should reset on restart, got ${reset.score}`);
if (reset.controlMode !== "tap") throw new Error("control mode should persist after restart");

if (errors.length) throw new Error(`console errors: ${errors.join(" | ")}`);
await browser.close();
console.log("ALL TAP AND FREEZE OK");
