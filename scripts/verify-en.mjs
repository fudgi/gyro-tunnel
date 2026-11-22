import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4180/";
const shotDir = path.resolve("/workspace/gyro-tunnel/screenshots");

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (err) => console.error("pageerror", err));

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.waitForSelector("#action");
await page.waitForTimeout(300);
await page.evaluate(() => localStorage.removeItem("gyro-tunnel-board"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#action");
await page.waitForTimeout(400);

const lang = await page.locator("html").getAttribute("lang");
if (lang !== "en") throw new Error(`html lang should be en, got ${lang}`);

const start = await page.evaluate(() => ({
  title: document.title,
  h1: document.getElementById("overlay-title")?.innerText,
  body: document.getElementById("overlay-body")?.innerText,
  action: document.getElementById("action")?.innerText,
  hint: document.getElementById("lock-hint")?.innerText,
  when: document.querySelector(".board-head")?.innerText,
  board: document.querySelector(".board-title")?.innerText,
  record: document.getElementById("record-badge")?.innerText,
  unit: document.querySelector(".score-unit")?.textContent ?? "",
  kmh: document.querySelector(".speed-unit")?.textContent,
}));
for (const [k, v] of Object.entries(start)) {
  if (/[\u0400-\u04FF]/.test(v || "")) throw new Error(`Cyrillic in ${k}: ${v}`);
}
if (start.action !== "Tap to start") throw new Error(`action: ${start.action}`);
if (!start.body.includes("Dodge the meteors")) throw new Error(`body: ${start.body}`);
if (!start.hint.toLowerCase().includes("lock your screen rotation")) throw new Error(`hint: ${start.hint}`);
if (start.unit.trim() !== "") throw new Error(`score unit should be gone, got: ${start.unit}`);
if (start.kmh.trim() !== "km/h") throw new Error(`speed unit: ${start.kmh}`);
if (start.board !== "Best flights") throw new Error(`board: ${start.board}`);
if (!start.when.includes("When") || !start.when.includes("Score")) throw new Error(`head: ${start.when}`);
if (start.record !== "New best!") throw new Error(`record: ${start.record}`);

await page.screenshot({ path: path.join(shotDir, "en-start.png"), fullPage: true });
console.log("start ok", start.action, start.hint);

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
await page.evaluate(() => window.__gyro.spawnNearMissAhead(14, { sizeScale: 1, speedScale: 1.2 }));
await page.waitForFunction(() => (window.__gyro?.getState().floatLabel || "").includes("Close call"), { timeout: 5000 });
await page.waitForTimeout(80);
const hud = await page.evaluate(() => ({
  label: window.__gyro.getState().floatLabel,
  scoreHud: document.getElementById("score-hud")?.innerText,
  speedHud: document.getElementById("speed-hud")?.innerText,
  visible: document.querySelector("#float-layer .float-label, #float-layer *")?.textContent,
}));
if (!hud.label.includes("Close call!")) throw new Error(`float: ${hud.label}`);
if (/(^|\s)m(\s|$)/i.test(hud.scoreHud)) throw new Error(`score hud still has m unit: ${hud.scoreHud}`);
if (!/\d/.test(hud.scoreHud)) throw new Error(`score hud: ${hud.scoreHud}`);
if (!hud.speedHud.toLowerCase().includes("km/h")) throw new Error(`speed hud: ${hud.speedHud}`);
await page.screenshot({ path: path.join(shotDir, "en-hud.png"), fullPage: true });
console.log("hud ok", hud);

await page.evaluate(() => window.__gyro.spawnHazardAhead(10));
await page.waitForFunction(() => window.__gyro?.getState().mode === "over", { timeout: 6000 });
await page.waitForTimeout(200);
const over = await page.evaluate(() => {
  const s = window.__gyro.getState();
  return {
    title: document.getElementById("overlay-title")?.innerText,
    body: document.getElementById("overlay-body")?.innerText,
    action: document.getElementById("action")?.innerText,
    final: document.getElementById("final-score")?.innerText,
    record: document.getElementById("record-badge")?.innerText,
    recordHidden: document.getElementById("record-badge")?.classList.contains("hidden"),
    board: document.querySelector(".board-title")?.innerText,
    head: document.querySelector(".board-head")?.innerText,
    row: document.querySelector(".board-row")?.innerText,
    atLabel: s.board?.[0]?.atLabel,
    newRecord: s.newRecord,
  };
});
for (const [k, v] of Object.entries(over)) {
  if (typeof v === "string" && /[\u0400-\u04FF]/.test(v)) throw new Error(`Cyrillic in over.${k}: ${v}`);
}
if (over.title !== "Crash") throw new Error(`title: ${over.title}`);
if (!over.body.includes("Twist the tunnel")) throw new Error(`over body: ${over.body}`);
if (over.action !== "Tap to fly again") throw new Error(`over action: ${over.action}`);
if (!/^\d{1,3}(,\d{3})*$/.test(over.final.trim())) throw new Error(`final should be a unitless score, got: ${over.final}`);
if (!/new best/i.test(over.record || "") || over.recordHidden) throw new Error(`record badge: ${JSON.stringify(over)}`);
if (!/best flights/i.test(over.board || "")) throw new Error(`over board: ${over.board}`);
if (!/when/i.test(over.head || "") || !/score/i.test(over.head || "")) throw new Error(`over head: ${over.head}`);
if (!/^today, \d{2}:\d{2}$/.test(over.atLabel || "")) throw new Error(`atLabel: ${over.atLabel}`);
if (!over.row.includes(over.atLabel)) throw new Error(`row: ${over.row}`);
await page.screenshot({ path: path.join(shotDir, "en-gameover.png"), fullPage: true });
console.log("gameover ok", over);

// format older date
const older = await page.evaluate(() => window.__gyro.formatRecordAt(new Date(2026, 10, 14, 21, 5).getTime(), new Date(2026, 10, 21).getTime()));
if (older !== "Nov 14, 21:05") throw new Error(`older date: ${older}`);
console.log("date format ok", older);

await browser.close();
console.log("ALL EN OK");
