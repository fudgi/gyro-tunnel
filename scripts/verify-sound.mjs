import { chromium } from "playwright";
import path from "node:path";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4183/";
const shotDir = path.resolve("/workspace/gyro-tunnel/screenshots");

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto(baseURL, { waitUntil: "networkidle" });
await page.waitForSelector("#mute");
await page.evaluate(() => localStorage.removeItem("gyro-tunnel-muted"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#mute");
await page.waitForTimeout(300);

const start = await page.evaluate(() => {
  const btn = document.getElementById("mute");
  return {
    present: !!btn,
    muted: window.__gyro?.getState()?.muted,
    pressed: btn?.getAttribute("aria-pressed"),
    label: btn?.getAttribute("aria-label"),
    className: btn?.className,
    title: document.getElementById("overlay-title")?.innerText,
  };
});
if (!start.present) throw new Error("Mute button missing");
if (start.muted) throw new Error("Should start unmuted when storage is empty");
if (start.pressed !== "false") throw new Error(`aria-pressed: ${start.pressed}`);
if (start.label !== "Mute sound") throw new Error(`label: ${start.label}`);
if (start.className.includes("is-muted")) throw new Error("unmuted button has is-muted");
if (start.title !== "Gyro Tunnel") throw new Error("start screen should still be visible");

await page.screenshot({ path: path.join(shotDir, "sound-mute-toggle.png"), fullPage: true });

await page.click("#mute");
await page.waitForTimeout(80);
const muted = await page.evaluate(() => ({
  muted: window.__gyro.getState().muted,
  pressed: document.getElementById("mute")?.getAttribute("aria-pressed"),
  label: document.getElementById("mute")?.getAttribute("aria-label"),
  classed: document.getElementById("mute")?.classList.contains("is-muted"),
  stored: localStorage.getItem("gyro-tunnel-muted"),
  mode: window.__gyro.getState().mode,
}));
if (!muted.muted || muted.pressed !== "true" || !muted.classed) throw new Error(`mute failed: ${JSON.stringify(muted)}`);
if (muted.label !== "Unmute sound") throw new Error(`muted label: ${muted.label}`);
if (muted.stored !== "1") throw new Error(`localStorage: ${muted.stored}`);
if (muted.mode !== "start") throw new Error("Mute should not start the game");

await page.click("#mute");
const unmuted = await page.evaluate(() => ({
  muted: window.__gyro.getState().muted,
  pressed: document.getElementById("mute")?.getAttribute("aria-pressed"),
  stored: localStorage.getItem("gyro-tunnel-muted"),
}));
if (unmuted.muted || unmuted.pressed !== "false") throw new Error(`unmute failed: ${JSON.stringify(unmuted)}`);
if (unmuted.stored !== "0") throw new Error(`storage after unmute: ${unmuted.stored}`);

await page.evaluate(() => window.__gyro.setMuted(true));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#mute");
const persisted = await page.evaluate(() => ({
  muted: window.__gyro.getState().muted,
  classed: document.getElementById("mute")?.classList.contains("is-muted"),
  stored: localStorage.getItem("gyro-tunnel-muted"),
}));
if (!persisted.muted || !persisted.classed || persisted.stored !== "1") {
  throw new Error(`mute should persist: ${JSON.stringify(persisted)}`);
}

await page.evaluate(() => window.__gyro.setMuted(false));
await page.click("#action");
await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
await page.evaluate(() => {
  const g = window.__gyro;
  g.setMeteorSpawning(false);
  g.setBarSpawning(false);
  g.setPickupSpawning(false);
  g.clearHazards();
});
await page.evaluate(() => window.__gyro.grantPowerup("shield"));
await page.evaluate(() => window.__gyro.spawnNearMissAhead(14, { sizeScale: 1, speedScale: 1.2 }));
await page.waitForFunction(() => (window.__gyro?.getState().floatLabel || "").includes("Close call"), { timeout: 5000 });
const playing = await page.evaluate(() => window.__gyro.getState().mode);
if (playing !== "playing") throw new Error(`gameplay broke, mode=${playing}`);

if (errors.length) throw new Error(`console errors: ${errors.join(" | ")}`);

await browser.close();
console.log("ALL SOUND OK", { start, muted, persisted });
