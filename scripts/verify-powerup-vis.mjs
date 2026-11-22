import { chromium } from "playwright";
import path from "node:path";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4181/";
const shotDir = path.resolve("/workspace/gyro-tunnel/screenshots");

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (err) => console.error("pageerror", err));

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.waitForSelector("#action");
await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });

async function clearAndPrep() {
  await page.evaluate(() => {
    const g = window.__gyro;
    g.setMeteorSpawning(false);
    g.setBarSpawning(false);
    g.setPickupSpawning(false);
    g.setBoosting(false);
    g.clearHazards();
    g.setRoll(0);
  });
}

await clearAndPrep();
await page.evaluate(() => {
  window.__gyro.spawnPickupAhead("shield", 16, { angle: 0.42, force: true });
});
await page.waitForFunction(() => window.__gyro.getState().pickupCount === 1, { timeout: 3000 });
await page.waitForTimeout(280);
const near = await page.evaluate(() => {
  const s = window.__gyro.getState();
  return { count: s.pickupCount, kind: s.pickups[0]?.kind, z: s.pickups[0]?.z, mode: s.mode };
});
if (near.kind !== "shield" || near.mode !== "playing") throw new Error(`near spawn failed: ${JSON.stringify(near)}`);
await page.screenshot({ path: path.join(shotDir, "powerup-visible-near.png"), fullPage: true });
console.log("near", near);

await clearAndPrep();
await page.evaluate(() => {
  window.__gyro.spawnPickupAhead("shield", 140, { angle: 0.12, force: true });
});
await page.waitForTimeout(280);
const far = await page.evaluate(() => {
  const s = window.__gyro.getState();
  return { count: s.pickupCount, kind: s.pickups[0]?.kind, z: s.pickups[0]?.z };
});
if (far.count !== 1) throw new Error(`far spawn failed: ${JSON.stringify(far)}`);
await page.screenshot({ path: path.join(shotDir, "powerup-visible-far.png"), fullPage: true });
console.log("far", far);

await clearAndPrep();
await page.evaluate(() => {
  const g = window.__gyro;
  g.spawnPickupAhead("shield", 24, { angle: -1.05, force: true });
  g.spawnPickupAhead("slow", 40, { angle: 0.2, force: true });
  g.spawnPickupAhead("x2", 32, { angle: 1.2, force: true });
});
await page.waitForTimeout(280);
const kinds = await page.evaluate(() => {
  const s = window.__gyro.getState();
  return s.pickups.map((p) => p.kind).sort();
});
if (kinds.join(",") !== "shield,slow,x2") throw new Error(`kinds: ${kinds}`);
await page.screenshot({ path: path.join(shotDir, "powerup-visible-kinds.png"), fullPage: true });
console.log("kinds", kinds);

// Collection still works at the unchanged hit radius
await clearAndPrep();
const before = await page.evaluate(() => window.__gyro.getState().shield);
await page.evaluate(() => window.__gyro.spawnPickupAhead("shield", 8, { angle: 0, force: true }));
await page.waitForFunction(() => window.__gyro.getState().shield === true, { timeout: 4000 });
const after = await page.evaluate(() => {
  const s = window.__gyro.getState();
  return { shield: s.shield, mode: s.mode, floatLabel: s.floatLabel, pickupCount: s.pickupCount };
});
if (!after.shield || after.mode !== "playing") throw new Error(`collect failed: ${JSON.stringify(after)}`);
if (!(after.floatLabel || "").includes("Shield")) throw new Error(`label: ${after.floatLabel}`);
console.log("collect ok", after, "was", before);

await browser.close();
console.log("ALL POWERUP VIS OK");
