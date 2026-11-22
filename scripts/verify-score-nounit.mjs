import { chromium } from "playwright";
import path from "node:path";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4182/";
const shotDir = path.resolve("/workspace/gyro-tunnel/screenshots");

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (err) => console.error("pageerror", err));

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.waitForSelector("#action");
await page.evaluate(() => localStorage.removeItem("gyro-tunnel-board"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#action");

if (await page.locator(".score-unit").count()) throw new Error("score-unit should be removed from the DOM");
const startFinal = (await page.locator("#final-score").textContent())?.trim();
if (startFinal !== "0") throw new Error(`placeholder final score should be 0, got ${startFinal}`);
const speedUnit = (await page.locator(".speed-unit").textContent())?.trim();
if (speedUnit !== "km/h") throw new Error(`speed unit should stay km/h, got ${speedUnit}`);

await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.evaluate(() => {
  const g = window.__gyro;
  g.setMeteorSpawning(false);
  g.setBarSpawning(false);
  g.setPickupSpawning(false);
  g.setBoosting(false);
  g.clearHazards();
  g.setRoll(0);
  g.setDistance(12450, true);
});
await page.evaluate(() => window.__gyro.setDistance(12450, true));

const hud = await page.evaluate(() => {
  const s = window.__gyro.getState();
  return {
    score: s.score,
    formatted: window.__gyro.formatScore(s.score),
    hud: document.getElementById("score-hud")?.innerText || "",
    speed: document.getElementById("speed-hud")?.innerText || "",
  };
});
if (hud.formatted !== hud.score.toLocaleString("en-US")) throw new Error(`formatScore: ${hud.formatted} vs ${hud.score}`);
if (hud.score < 12450 || hud.score > 13000) throw new Error(`score value: ${hud.score}`);
if (!hud.hud.includes(hud.formatted)) throw new Error(`HUD missing ${hud.formatted}: ${hud.hud}`);
if (/\bm\b/i.test(hud.hud)) throw new Error(`HUD still has m: ${JSON.stringify(hud.hud)}`);
if (!/km\/h/i.test(hud.speed)) throw new Error(`speed HUD lost km/h: ${hud.speed}`);
await page.screenshot({ path: path.join(shotDir, "score-nounit-hud.png"), fullPage: true });
console.log("hud ok", hud);

// Milestone should be a palette name, not meters
await page.evaluate(() => window.__gyro.setDistance(1000, false));
await page.waitForTimeout(80);
const mile = await page.evaluate(() => document.getElementById("milestone")?.innerText || "");
if (!/magenta/i.test(mile) || /\bm\b/i.test(mile)) throw new Error(`milestone: ${mile}`);
console.log("milestone ok", mile);

await page.evaluate(() => window.__gyro.setDistance(12450, true));
const locked = await page.evaluate(() => {
  window.__gyro.setDistance(12450, true);
  return window.__gyro.getState().score;
});
await page.evaluate(() => window.__gyro.spawnHazardAhead(6));
await page.waitForFunction(() => window.__gyro?.getState().mode === "over", { timeout: 6000 });
await page.waitForTimeout(200);

const over = await page.evaluate(() => {
  const s = window.__gyro.getState();
  return {
    final: document.getElementById("final-score")?.innerText || "",
    record: document.getElementById("record-badge")?.innerText || "",
    board: document.querySelector(".board-title")?.innerText || "",
    head: document.querySelector(".board-head")?.innerText || "",
    row: document.querySelector(".board-row")?.innerText || "",
    score: s.score,
  };
});
const expected = locked.toLocaleString("en-US");
if (over.final.trim() !== expected && over.final.trim() !== over.score.toLocaleString("en-US")) {
  throw new Error(`final: ${over.final}, expected ~${expected} or ${over.score}`);
}
if (over.score < 12450) throw new Error(`over score too small: ${over.score}`);
if (/\bm\b/i.test(over.final)) throw new Error(`final has m: ${over.final}`);
if (!/new best/i.test(over.record)) throw new Error(`record: ${over.record}`);
if (!/best flights/i.test(over.board)) throw new Error(`board: ${over.board}`);
if (!/score/i.test(over.head)) throw new Error(`head: ${over.head}`);
if (!over.row.includes(over.score.toLocaleString("en-US"))) throw new Error(`row missing formatted score: ${over.row}`);
if (/\bm\b/i.test(over.row)) throw new Error(`row has m: ${over.row}`);
await page.screenshot({ path: path.join(shotDir, "score-nounit-gameover.png"), fullPage: true });
console.log("gameover ok", over);

await browser.close();
console.log("ALL SCORE NOUNIT OK");
