import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(root, "screenshots");
const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173/";

async function mockOrientation(page, angle) {
  await page.evaluate((deg) => {
    const type =
      deg === 0
        ? "portrait-primary"
        : deg === 90
          ? "landscape-primary"
          : deg === 180
            ? "portrait-secondary"
            : "landscape-secondary";
    const orientation = screen.orientation || {};
    try {
      Object.defineProperty(screen, "orientation", {
        configurable: true,
        get: () => orientation,
      });
    } catch {
      // already configurable or replaced
    }
    try {
      Object.defineProperty(orientation, "angle", {
        configurable: true,
        get: () => deg,
      });
      Object.defineProperty(orientation, "type", {
        configurable: true,
        get: () => type,
      });
    } catch {
      // fall back to viewport-aspect path on mobile
    }
    window.__gyro?.applyViewportCompensation?.();
    window.dispatchEvent(new Event("orientationchange"));
    window.dispatchEvent(new Event("resize"));
  }, angle);
}

async function main() {
  await mkdir(shotDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForSelector("#action");
  await page.waitForTimeout(400);

  if (await page.locator(".style-btn, #styles").count()) {
    throw new Error("Style switcher should have been removed");
  }

  const hint = await page.locator("#lock-hint").innerText();
  if (!hint.toLowerCase().includes("lock your screen rotation")) {
    throw new Error(`Missing rotation-lock hint, got: ${hint}`);
  }
  if (await page.locator("#landscape").count()) {
    throw new Error("Landscape blocker overlay should have been removed");
  }

  await page.screenshot({ path: path.join(shotDir, "01-start.png"), fullPage: true });

  await page.click("#action");
  await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
  await page.waitForFunction(() => window.__gyro?.getState().score >= 8, { timeout: 4000 });
  const playingHud = await page.evaluate(() => {
    const s = window.__gyro.getState();
    return { score: s.score, hud: document.getElementById("score-hud")?.innerText || "", speedKmh: s.speedKmh };
  });
  if (!(playingHud.score >= 8)) throw new Error(`Score should increase while flying, got ${playingHud.score}`);
  const hudScore = playingHud.score.toLocaleString("en-US");
  if (!playingHud.hud.includes(hudScore)) {
    throw new Error(`Score HUD should show ${hudScore}, got: ${playingHud.hud}`);
  }
  if (/(^|\s)m(\s|$)/i.test(playingHud.hud.replace("km/h", ""))) {
    throw new Error(`Score HUD should not show an m unit, got: ${playingHud.hud}`);
  }
  await page.screenshot({ path: path.join(shotDir, "score.png"), fullPage: true });
  await page.screenshot({ path: path.join(shotDir, "02-playing.png"), fullPage: true });
  await page.screenshot({ path: path.join(shotDir, "wider.png"), fullPage: true });
  await page.screenshot({ path: path.join(shotDir, "minimal-final.png"), fullPage: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shotDir, "varied-meteors.png"), fullPage: true });
  const variety = await page.evaluate(() => window.__gyro.getState().meteors || []);
  const sizes = new Set(variety.map((m) => m.sizeScale?.toFixed(2)));
  const speeds = new Set(variety.map((m) => m.speedScale?.toFixed(2)));
  if (variety.length >= 2 && sizes.size < 2 && speeds.size < 2) {
    throw new Error(`Expected varied meteor size/speed, got ${JSON.stringify(variety)}`);
  }

  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowLeft");
  await page.screenshot({ path: path.join(shotDir, "03-keyboard-roll.png"), fullPage: true });

  const rollBefore = await page.evaluate(() => window.__gyro.getState().roll);

  // Landscape: OS auto-rotate fallback. Scene should stay portrait-relative
  // via CSS counter-rotation; world roll must not jump.
  // Headless Chromium cannot resize a fullscreen window, so leave fullscreen
  // first (on a phone the OS rotation happens inside fullscreen instead).
  await page.evaluate(async () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await mockOrientation(page, 90);
  await page.waitForTimeout(400);

  const land = await page.evaluate(() => {
    const s = window.__gyro.getState();
    const style = window.getComputedStyle(document.getElementById("app"));
    return {
      ...s,
      transform: style.transform,
      appWidth: document.getElementById("app").style.width,
      appHeight: document.getElementById("app").style.height,
      hasBlocker: !!document.getElementById("landscape"),
    };
  });
  if (land.hasBlocker) throw new Error("Landscape blocker reappeared");
  if (!land.compensated) throw new Error("Expected compensated=true in landscape");
  if (land.orientAngle !== 90) throw new Error(`Expected orientAngle 90, got ${land.orientAngle}`);
  if (!/matrix|rotate/i.test(land.transform) || land.transform === "none") {
    throw new Error(`Expected CSS counter-rotation, got transform=${land.transform}`);
  }
  const jump = Math.abs(land.roll - rollBefore);
  const wrappedJump = Math.min(jump, Math.abs(jump - Math.PI * 2));
  if (wrappedJump > 0.2) {
    throw new Error(`World roll jumped on landscape: ${rollBefore} -> ${land.roll}`);
  }

  await page.screenshot({ path: path.join(shotDir, "06-landscape-playing.png"), fullPage: true });

  // Back to portrait, then collision + restart still work.
  await page.setViewportSize({ width: 390, height: 844 });
  await mockOrientation(page, 0);
  await page.waitForTimeout(250);

  const spawned = await page.evaluate(() => window.__gyro.spawnHazardAhead(10));
  if (!spawned) throw new Error("spawnHazardAhead returned nothing");

  await page.waitForFunction(() => window.__gyro?.getState().mode === "exploding", { timeout: 4000 });
  await page.waitForTimeout(180);
  const exploding = await page.evaluate(() => window.__gyro.getState());
  if (exploding.mode !== "exploding") throw new Error(`Expected exploding, got ${exploding.mode}`);
  const frozenScore = exploding.score;
  if (!(frozenScore >= 8)) throw new Error(`Expected a frozen positive score, got ${frozenScore}`);
  await page.waitForTimeout(400);
  const stillFrozen = await page.evaluate(() => window.__gyro.getState().score);
  if (stillFrozen !== frozenScore) {
    throw new Error(`Score should freeze on collision: ${frozenScore} -> ${stillFrozen}`);
  }
  await page.screenshot({ path: path.join(shotDir, "explosion.png"), fullPage: true });

  await page.waitForFunction(() => window.__gyro?.getState().mode === "over", { timeout: 4000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(shotDir, "04-collision.png"), fullPage: true });

  const overTitle = await page.locator("#overlay-title").innerText();
  if (overTitle !== "Crash") {
    throw new Error(`Expected game-over title, got: ${overTitle}`);
  }
  const over = await page.evaluate(() => window.__gyro.getState());
  if (over.score !== frozenScore) {
    throw new Error(`Game-over score changed after freeze: ${frozenScore} -> ${over.score}`);
  }
  if (over.best !== frozenScore) {
    throw new Error(`Expected best to match first-run score ${frozenScore}, got ${over.best}`);
  }
  if (!over.newRecord) throw new Error("First qualifying run should show a new record");
  if (!over.madeBoard) throw new Error("Current run should appear on the board");
  const finalScore = await page.locator("#final-score").innerText();
  if (finalScore.trim() !== frozenScore.toLocaleString("en-US")) {
    throw new Error(`Final score text mismatch, got: ${finalScore}`);
  }
  if (await page.locator("#record-badge").isHidden()) {
    throw new Error("New best! badge should be visible on a new best");
  }
  const boardTitle = (await page.locator(".board-title").textContent())?.trim();
  if (boardTitle !== "Best flights") {
    throw new Error(`Expected board title «Best flights», got: ${boardTitle}`);
  }
  const head = (await page.locator(".board-head").textContent()) || "";
  if (!head.includes("When") || !head.includes("Score")) {
    throw new Error(`Expected board headers When + Score, got: ${head}`);
  }
  const currentRow = page.locator(".board-row.is-current");
  if (await currentRow.count() !== 1) throw new Error("Current run should be highlighted once");
  const currentText = await currentRow.innerText();
  if (!currentText.includes(String(frozenScore))) {
    throw new Error(`Highlighted row should include score ${frozenScore}, got: ${currentText}`);
  }
  const atLabel = over.board?.[0]?.atLabel || "";
  if (!/^today, \d{2}:\d{2}$/.test(atLabel)) {
    throw new Error(`Expected timestamp like «today, 21:05», got: ${atLabel}`);
  }
  if (!currentText.includes(atLabel)) {
    throw new Error(`Highlighted row should include ${atLabel}, got: ${currentText}`);
  }
  const recordedAt = over.board?.[0]?.at;
  if (!Number.isFinite(recordedAt) || Math.abs(Date.now() - recordedAt) > 60_000) {
    throw new Error(`Board timestamp should be recent, got: ${recordedAt}`);
  }
  await page.screenshot({ path: path.join(shotDir, "gameover-score.png"), fullPage: true });

  await page.click("#action");
  await page.waitForFunction((prev) => {
    const s = window.__gyro?.getState();
    return s?.mode === "playing" && s.score < prev;
  }, frozenScore, { timeout: 5000 });
  const reset = await page.evaluate(() => window.__gyro.getState());
  if (reset.mode !== "playing") throw new Error("Restart did not return to playing");
  if (reset.score >= frozenScore) {
    throw new Error(`Score should reset on restart, got ${reset.score} (was ${frozenScore})`);
  }
  if (reset.best !== frozenScore) {
    throw new Error(`Best should persist after restart, got ${reset.best}`);
  }
  if (Math.abs((reset.speedKmh ?? 0) - 151) > 2) {
    throw new Error(`Base speed should be ~151 km/h after restart, got ${reset.speedKmh}`);
  }
  if (Math.abs((reset.speedFactor ?? 0) - 1) > 0.03) {
    throw new Error(`Speed should reset on restart, factor=${reset.speedFactor}`);
  }
  await page.waitForFunction((start) => window.__gyro?.getState().score > start, reset.score, { timeout: 3000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(shotDir, "05-restarted.png"), fullPage: true });

  const after = await page.evaluate(() => window.__gyro.getState());
  if (after.mode !== "playing") throw new Error("Restart did not return to playing");

  await page.evaluate(() => window.__gyro.setBarSpawning(false));
  const growth = 1.12 ** 4;
  await page.evaluate(() => window.__gyro.setElapsed(10));
  const at10 = await page.evaluate(() => window.__gyro.getState());
  if (Math.abs(at10.speedFactor - growth) > 0.003) {
    throw new Error(`Expected +57.35% after 10s (former boost rate), factor=${at10.speedFactor}`);
  }
  if (Math.abs((at10.speedKmh ?? 0) - 238) > 1) {
    throw new Error(`Expected ~238 km/h after 10s, got ${at10.speedKmh}`);
  }

  await page.evaluate(() => window.__gyro.setElapsed(20));
  const midInfo = await page.evaluate(() => {
    const s = window.__gyro.getState();
    const hud = document.querySelector("#speed-hud");
    return {
      speedKmh: s.speedKmh,
      text: hud?.innerText || "",
      unit: hud?.querySelector(".speed-unit")?.textContent || "",
    };
  });
  if (!midInfo.unit.toLowerCase().includes("km/h")) {
    throw new Error(`Speedometer should show km/h, got: ${midInfo.text}`);
  }
  const midHudNum = parseInt(midInfo.text, 10);
  if (!Number.isFinite(midHudNum) || Math.abs(midHudNum - midInfo.speedKmh) > 1) {
    throw new Error(`Speedometer should show ${midInfo.speedKmh}, got: ${midInfo.text}`);
  }
  await page.screenshot({ path: path.join(shotDir, "speedometer.png"), fullPage: true });

  await page.evaluate(() => window.__gyro.setElapsed(400));
  const capped = await page.evaluate(() => window.__gyro.getState());
  if (capped.speedFactor !== 8) {
    throw new Error(`Speed should cap at 8×, factor=${capped.speedFactor}`);
  }
  if (capped.speedKmh !== 1210) {
    throw new Error(`Capped speed should be 1210 km/h, got ${capped.speedKmh}`);
  }

  await page.evaluate(() => window.__gyro.restart());
  await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
  const spedReset = await page.evaluate(() => window.__gyro.getState());
  if (Math.abs((spedReset.speedFactor ?? 0) - 1) > 0.03 || Math.abs((spedReset.speedKmh ?? 0) - 151) > 2) {
    throw new Error(`Speed should reset after another restart, got factor=${spedReset.speedFactor} kmh=${spedReset.speedKmh}`);
  }

  const restLens = await page.evaluate(() => window.__gyro.getState());
  const restNdcY = restLens.planeNdcY;
  const restFov = restLens.fov;
  if (Math.abs((restFov ?? 0) - 80) > 1) {
    throw new Error(`Base FOV should be ~80, got ${restFov}`);
  }

  const sceneBox = await page.locator("#scene").boundingBox();
  if (!sceneBox) throw new Error("Canvas has no bounding box");
  await page.mouse.move(sceneBox.x + sceneBox.width / 2, sceneBox.y + sceneBox.height * 0.6);
  await page.mouse.down();
  await page.waitForFunction(() => window.__gyro?.getState().boosting, { timeout: 3000 });
  const boosted = await page.evaluate(() => {
    window.__gyro.setElapsed(0);
    window.__gyro.advance(10);
    return window.__gyro.getState();
  });
  const expectedBoost = (1.12 ** 4) ** 2;
  if (Math.abs(boosted.speedFactor - expectedBoost) > 0.003) {
    throw new Error(`Boost should grow 4× faster (10s hold ≈ ${expectedBoost.toFixed(4)}), got ${boosted.speedFactor}`);
  }
  if (!boosted.boosting) throw new Error("Pointer hold should keep boosting=true");
  if (!boosted.flameVisible || boosted.flame < 0.8) {
    throw new Error(`Flame should be visible while boosting, flame=${boosted.flame} visible=${boosted.flameVisible}`);
  }
  if (Math.abs((boosted.fov ?? 0) - 115) > 1) {
    throw new Error(`Boost FOV should widen to ~115, got ${boosted.fov}`);
  }
  if ((boosted.lens ?? 0) < 0.95) {
    throw new Error(`Lens effect should be fully on while boosting, lens=${boosted.lens}`);
  }
  if (restNdcY != null && boosted.planeNdcY != null && Math.abs(boosted.planeNdcY - restNdcY) > 0.06) {
    throw new Error(`Plane should stay near the same screen spot, ndc ${restNdcY} -> ${boosted.planeNdcY}`);
  }
  const boostClass = await page.locator("#speed-hud").evaluate((el) => el.classList.contains("is-boosting"));
  if (!boostClass) throw new Error("Speedometer should show a boost indicator");
  const lensOpacity = await page.locator("#lens-fx").evaluate((el) => Number(getComputedStyle(el).opacity));
  if (!(lensOpacity > 0.8)) {
    throw new Error(`Wide-lens overlay should be visible, opacity=${lensOpacity}`);
  }
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(shotDir, "boost.png"), fullPage: true });
  await page.screenshot({ path: path.join(shotDir, "boost-lens.png"), fullPage: true });

  const held = await page.evaluate(() => window.__gyro.getState());
  await page.mouse.up();
  await page.waitForFunction(() => window.__gyro?.getState().boosting === false, { timeout: 3000 });
  const kept = await page.evaluate(() => window.__gyro.getState());
  if (Math.abs(kept.speedFactor - held.speedFactor) > 0.02) {
    throw new Error(`Releasing boost should keep speed, got ${kept.speedFactor} (was ${held.speedFactor})`);
  }
  const afterRelease = await page.evaluate(() => {
    window.__gyro.advance(10);
    return window.__gyro.getState();
  });
  const expectedNormal = (1.12 ** 4) ** (kept.growthTime / 10 + 1);
  if (Math.abs(afterRelease.speedFactor - expectedNormal) > 0.004) {
    throw new Error(`After release, ramp should return to normal (new standard), got ${afterRelease.speedFactor}, expected ${expectedNormal}`);
  }
  if (Math.abs((afterRelease.fov ?? 0) - 80) > 1) {
    throw new Error(`FOV should ease back to ~80 after release, got ${afterRelease.fov}`);
  }
  if ((afterRelease.lens ?? 1) > 0.05) {
    throw new Error(`Lens effect should turn off after release, lens=${afterRelease.lens}`);
  }
  if (afterRelease.boosting) throw new Error("Boosting should be false after pointer up");
  if (afterRelease.flameVisible) throw new Error("Flame should turn off after release");

  await page.evaluate(() => {
    window.__gyro.setBarSpawning(true);
    window.__gyro.restart();
    window.__gyro.setDistance(499);
  });
  await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
  const beforeBars = await page.evaluate(() => {
    window.__gyro.setDistance(499);
    return window.__gyro.getState();
  });
  if (beforeBars.barThreshold !== 500) {
    throw new Error(`Expected bar threshold 500 m, got ${beforeBars.barThreshold}`);
  }
  if (beforeBars.barsUnlocked) throw new Error("Bars should stay locked before 500 m");
  const autoBefore = await page.evaluate(() => {
    window.__gyro.advance(3);
    return window.__gyro.getState().barCount;
  });
  if (autoBefore !== 0) throw new Error(`No bars should auto-spawn before 500 m, got ${autoBefore}`);

  const unlocked = await page.evaluate(() => {
    window.__gyro.setDistance(500);
    return window.__gyro.getState();
  });
  if (!unlocked.barsUnlocked) throw new Error("Bars should unlock at 500 m");
  const barSpawned = await page.evaluate(() =>
    window.__gyro.spawnBarAhead(36, { angle: 0.55, offset: 2.2 }),
  );
  if (!barSpawned) throw new Error("spawnBarAhead returned nothing");
  const withBar = await page.evaluate(() => window.__gyro.getState());
  if (!(withBar.barCount >= 1)) throw new Error(`Expected a bar after the threshold, got ${withBar.barCount}`);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(shotDir, "bars.png"), fullPage: true });

  // Avoidable: a mid-offset bar does not hit at roll=0.
  await page.evaluate(() => {
    window.__gyro.restart();
    window.__gyro.setDistance(500);
    window.__gyro.setRoll(0);
    window.__gyro.spawnBarAhead(10, { angle: 0, offset: 2.7 });
  });
  await page.waitForFunction(() => {
    const s = window.__gyro.getState();
    const bar = s.bars?.[0];
    return s.mode === "playing" && bar && bar.z > 2;
  }, { timeout: 4000 });
  const avoided = await page.evaluate(() => window.__gyro.getState());
  if (avoided.mode !== "playing") {
    throw new Error(`Bar at offset 2.7 should be dodgeable at roll=0, mode=${avoided.mode}`);
  }

  // Collision: rotate onto the chord and confirm a crash.
  await page.evaluate(() => {
    window.__gyro.restart();
    window.__gyro.setDistance(500);
    window.__gyro.setRoll(Math.acos(2.7 / 5.4));
    window.__gyro.spawnBarAhead(10, { angle: 0, offset: 2.7 });
  });
  await page.waitForFunction(() => {
    const s = window.__gyro.getState();
    return s.mode === "exploding" || s.mode === "over";
  }, { timeout: 4000 });
  const hit = await page.evaluate(() => window.__gyro.getState());
  if (hit.mode !== "exploding" && hit.mode !== "over") {
    throw new Error(`Expected a bar collision, mode=${hit.mode}`);
  }

  // Density ramps over the first 2000 m, then plateaus. Waves stay dodgeable.
  const densityStats = await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.restart();
    gyro.setBarSpawning(false);
    gyro.clearHazards();
    const sample = (distance, waves) => {
      gyro.setDistance(distance);
      const rows = [];
      for (let i = 0; i < waves; i += 1) {
        rows.push(gyro.spawnMeteorWave(-40 - i * 0.4));
        gyro.clearHazards();
      }
      const s = gyro.getState();
      const avg = rows.reduce((n, r) => n + r.count, 0) / rows.length;
      const minArc = Math.min(...rows.map((r) => r.safeArc));
      return {
        densityFactor: s.densityFactor,
        densityMax: s.densityMax,
        densityRamp: s.densityRamp,
        avg,
        minArc,
        counts: rows.map((r) => r.count),
      };
    };
    const early = sample(0, 40);
    const midDist = sample(1000, 40);
    const late = sample(2000, 40);
    const plateau = sample(4000, 20);
    return { early, midDist, late, plateau };
  });
  const { early, midDist, late, plateau } = densityStats;
  if (early.densityRamp !== 2000 || early.densityMax !== 2.75) {
    throw new Error(`Unexpected density constants: ramp=${early.densityRamp} max=${early.densityMax}`);
  }
  if (Math.abs(early.densityFactor - 1) > 0.001) {
    throw new Error(`Expected density 1 at 0 m, got ${early.densityFactor}`);
  }
  if (Math.abs(midDist.densityFactor - (1 + 1.75 * 0.5)) > 0.02) {
    throw new Error(`Expected density ~1.875 at 1000 m, got ${midDist.densityFactor}`);
  }
  if (Math.abs(late.densityFactor - 2.75) > 0.001) {
    throw new Error(`Expected density 2.75 at 2000 m, got ${late.densityFactor}`);
  }
  if (Math.abs(plateau.densityFactor - 2.75) > 0.001) {
    throw new Error(`Density should plateau after 2000 m, got ${plateau.densityFactor}`);
  }
  if (early.avg < 1.1 || early.avg > 1.55) {
    throw new Error(`Early wave size should stay near 1.28, got ${early.avg}`);
  }
  if (late.avg < 2.15 || late.avg > 2.9) {
    throw new Error(`Late wave size should be ~2.55, got ${late.avg}`);
  }
  if (late.avg < early.avg * 1.6) {
    throw new Error(`Late waves should be substantially denser than early (${early.avg} vs ${late.avg})`);
  }
  if (early.minArc < 0.7 || midDist.minArc < 0.7 || late.minArc < 0.7) {
    throw new Error(`Wave must leave a dodgeable gap, minArc early=${early.minArc} mid=${midDist.minArc} late=${late.minArc}`);
  }

  // Dense field screenshot at 2000 m.
  await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.restart();
    gyro.setBarSpawning(false);
    gyro.setMeteorSpawning(false);
    gyro.setBoosting(false);
    gyro.setElapsed(0);
    gyro.advance(0);
    gyro.clearHazards();
    gyro.setDistance(2000);
    for (let i = 0; i < 7; i += 1) {
      gyro.spawnMeteorWave(-28 - i * 16);
    }
    const near = gyro.getState().meteors
      .filter((m) => m.z > -55)
      .sort((a, b) => b.z - a.z);
    const focusZ = near[0]?.z;
    const wave = near.filter((m) => Math.abs(m.z - focusZ) < 5);
    const angles = wave.map((m) => m.angle).sort((a, b) => a - b);
    if (angles.length) {
      let bestSpan = -1;
      let bestMid = 0;
      for (let i = 0; i < angles.length; i += 1) {
        const a = angles[i];
        const b = angles[(i + 1) % angles.length] + (i + 1 === angles.length ? Math.PI * 2 : 0);
        const span = b - a;
        if (span > bestSpan) {
          bestSpan = span;
          bestMid = a + span / 2;
        }
      }
      gyro.setRoll(bestMid);
    }
  });
  await page.waitForTimeout(180);
  const denseState = await page.evaluate(() => window.__gyro.getState());
  if (!(denseState.meteorCount >= 10)) {
    throw new Error(`Expected a dense field on screen, got ${denseState.meteorCount} meteors`);
  }
  if (denseState.mode !== "playing") {
    throw new Error(`Dense shot should stay in play, mode=${denseState.mode}`);
  }
  await page.screenshot({ path: path.join(shotDir, "dense.png"), fullPage: true });

  await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.restart();
    gyro.setBarSpawning(false);
    gyro.setMeteorSpawning(false);
    gyro.setBoosting(false);
    gyro.setElapsed(0);
    gyro.advance(0);
    gyro.clearHazards();
    gyro.setDistance(80);
    gyro.setRoll(0);
  });
  await page.waitForTimeout(160);
  const noStars = await page.evaluate(() => window.__gyro.getState());
  if (noStars.mode !== "playing") throw new Error(`No-stars shot crashed, mode=${noStars.mode}`);
  if ((noStars.starCount ?? 0) !== 0) {
    throw new Error(`Starfield should be gone, starCount=${noStars.starCount}`);
  }
  if (noStars.lens > 0.08) throw new Error(`Resting shot should not be boosting, lens=${noStars.lens}`);
  await page.screenshot({ path: path.join(shotDir, "no-stars.png"), fullPage: true });

  await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.clearHazards();
    gyro.setBoosting(true);
    gyro.advance(0.4);
  });
  await page.waitForTimeout(80);
  const noStarsBoost = await page.evaluate(() => window.__gyro.getState());
  if (noStarsBoost.mode !== "playing") {
    throw new Error(`No-stars boost shot crashed, mode=${noStarsBoost.mode}`);
  }
  if ((noStarsBoost.starCount ?? 0) !== 0) {
    throw new Error(`Starfield should stay gone while boosting, starCount=${noStarsBoost.starCount}`);
  }
  if (noStarsBoost.lens < 0.85) {
    throw new Error(`Boost lens should still work, lens=${noStarsBoost.lens}`);
  }
  if (!noStarsBoost.flameVisible) {
    throw new Error("Boost flame should still be visible");
  }
  await page.screenshot({ path: path.join(shotDir, "no-stars-boost.png"), fullPage: true });
  await page.evaluate(() => {
    window.__gyro.setBoosting(false);
    window.__gyro.setMeteorSpawning(true);
  });

  // Longer view distance: at max speed, obstacles should be visible ~2s ahead.
  const farView = await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.restart();
    gyro.setBarSpawning(false);
    gyro.setMeteorSpawning(false);
    gyro.setBoosting(false);
    gyro.setElapsed(400);
    gyro.advance(0);
    gyro.clearHazards();
    gyro.setRoll(0);
    const depths = [-180, -320, -480, -640];
    const waves = depths.map((z) => gyro.spawnMeteorWave(z, { force: true }));
    const s = gyro.getState();
    return {
      cameraFar: s.cameraFar,
      fogDensity: s.fogDensity,
      ringCount: s.ringCount,
      ringSpacing: s.ringSpacing,
      tunnelEndZ: s.tunnelEndZ,
      visibleRange: s.visibleRange,
      leadTimeAtMax: s.leadTimeAtMax,
      leadTime: s.leadTime,
      speed: s.speed,
      speedFactor: s.speedFactor,
      mode: s.mode,
      meteorCount: s.meteorCount,
      farthestZ: Math.min(...(s.meteors || []).map((m) => m.z), 0),
      waves: waves.map((w) => w.count),
    };
  });
  if (farView.mode !== "playing") {
    throw new Error(`Far-view setup crashed, mode=${farView.mode}`);
  }
  if (farView.cameraFar < 1000) {
    throw new Error(`Camera far plane should be extended, far=${farView.cameraFar}`);
  }
  if (!(farView.fogDensity > 0) || farView.fogDensity > 0.004) {
    throw new Error(`Fog should be thinner for long sight, density=${farView.fogDensity}`);
  }
  if (farView.ringCount < 80 || farView.visibleRange < 700) {
    throw new Error(`Tunnel should extend much farther, rings=${farView.ringCount} range=${farView.visibleRange}`);
  }
  if (farView.speedFactor !== 8) {
    throw new Error(`Far-view shot should be at max speed, factor=${farView.speedFactor}`);
  }
  if (farView.leadTimeAtMax < 1.5 || farView.leadTimeAtMax > 2.6) {
    throw new Error(`Max-speed lead time should be ~1.5–2s, got ${farView.leadTimeAtMax}`);
  }
  if (farView.meteorCount < 4 || farView.farthestZ > -580) {
    throw new Error(`Expected far obstacles on screen, count=${farView.meteorCount} farthest=${farView.farthestZ}`);
  }
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(shotDir, "far-view.png"), fullPage: true });

  // Subtle neon sheen on the tunnel rings, at rest and while boosting.
  await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.restart();
    gyro.setBarSpawning(false);
    gyro.setMeteorSpawning(false);
    gyro.setBoosting(false);
    gyro.setElapsed(0);
    gyro.advance(0);
    gyro.clearHazards();
    gyro.setRoll(0);
    gyro.setDistance(80);
  });
  await page.waitForTimeout(220);
  const neonRest = await page.evaluate(() => window.__gyro.getState());
  if (neonRest.mode !== "playing") throw new Error(`Neon rings shot crashed, mode=${neonRest.mode}`);
  if ((neonRest.starCount ?? 0) !== 0) throw new Error("Stars should stay removed");
  await page.screenshot({ path: path.join(shotDir, "neon-rings.png"), fullPage: true });

  await page.evaluate(() => {
    window.__gyro.setBoosting(true);
    window.__gyro.advance(0.4);
  });
  await page.waitForTimeout(80);
  const neonBoost = await page.evaluate(() => window.__gyro.getState());
  if (neonBoost.mode !== "playing") throw new Error(`Neon boost shot crashed, mode=${neonBoost.mode}`);
  if (neonBoost.lens < 0.85) throw new Error(`Boost lens should be on, lens=${neonBoost.lens}`);
  if (!neonBoost.flameVisible) throw new Error("Boost flame should still be visible");
  await page.screenshot({ path: path.join(shotDir, "neon-rings-boost.png"), fullPage: true });
  await page.evaluate(() => {
    window.__gyro.setBoosting(false);
    window.__gyro.setMeteorSpawning(true);
    window.__gyro.setBarSpawning(true);
  });

  // Legacy board entries without a timestamp should show «—».
  const pageLegacy = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await pageLegacy.addInitScript(() => {
    localStorage.setItem(
      "gyro-tunnel-board",
      JSON.stringify([{ id: "legacy", score: 40, time: 2.5 }]),
    );
  });
  await pageLegacy.goto(baseURL, { waitUntil: "networkidle" });
  await pageLegacy.evaluate(() => window.__gyro.start());
  await pageLegacy.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
  await pageLegacy.evaluate(() => window.__gyro.spawnHazardAhead(10));
  await pageLegacy.waitForFunction(() => window.__gyro?.getState().mode === "over", { timeout: 6000 });
  const legacy = await pageLegacy.evaluate(() => window.__gyro.getState());
  const legacyRow = legacy.board?.find((row) => row.id === "legacy");
  if (!legacyRow) throw new Error("Legacy board entry was dropped");
  if (legacyRow.atLabel !== "—") {
    throw new Error(`Legacy entry should show «—», got: ${legacyRow.atLabel}`);
  }
  const labels = await pageLegacy.locator(".board-row").allInnerTexts();
  if (!labels.some((t) => t.includes("—") && t.includes("40"))) {
    throw new Error(`Expected a visible «—» row for the legacy flight, got: ${JSON.stringify(labels)}`);
  }
  await pageLegacy.close();

  // Landscape start screen too (fresh page).
  const page2 = await browser.newPage({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page2.goto(baseURL, { waitUntil: "networkidle" });
  await mockOrientation(page2, 90);
  await page2.waitForTimeout(400);
  const startLand = await page2.evaluate(() => window.__gyro.getState());
  if (!startLand.compensated) throw new Error("Start screen was not compensated in landscape");
  await page2.screenshot({ path: path.join(shotDir, "07-landscape-start.png"), fullPage: true });
  await page2.close();

  // Near-miss, power-ups, and palette cycle.
  const featErrors = [];
  page.on("pageerror", (err) => featErrors.push(String(err)));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.restart();
    gyro.setMeteorSpawning(false);
    gyro.setBarSpawning(false);
    gyro.setPickupSpawning(false);
    gyro.clearHazards();
    gyro.setRoll(0);
    gyro.setBoosting(false);
  });
  await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });

  const scoreBefore = await page.evaluate(() => window.__gyro.getState().score);
  await page.evaluate(() => window.__gyro.spawnNearMissAhead(14, { sizeScale: 1, speedScale: 1.2 }));
  await page.waitForFunction(() => {
    const s = window.__gyro.getState();
    return s.lastNearMiss > 0 && (s.floatLabel || "").includes("Close call");
  }, { timeout: 5000 });
  const near = await page.evaluate(() => window.__gyro.getState());
  if (near.mode !== "playing") throw new Error(`Near-miss should not crash, mode=${near.mode}`);
  if (near.combo < 1) throw new Error(`Near-miss should start a combo, combo=${near.combo}`);
  if (near.score < scoreBefore + 50) throw new Error(`Near-miss should add bonus points, ${scoreBefore} -> ${near.score}`);
  if (!(near.floatLabel || "").includes("Close call")) {
    throw new Error(`Expected «Close call!» label, got: ${near.floatLabel}`);
  }
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(shotDir, "nearmiss.png"), fullPage: true });

  await page.evaluate(() => window.__gyro.spawnNearMissAhead(12, { sizeScale: 1, sign: -1, speedScale: 1.35 }));
  await page.waitForFunction(() => window.__gyro.getState().combo >= 2, { timeout: 5000 });
  const combo2 = await page.evaluate(() => window.__gyro.getState());
  if (combo2.combo < 2) throw new Error(`Second near-miss should raise combo, combo=${combo2.combo}`);
  if (!combo2.comboVisible) throw new Error("Combo HUD should be visible at ×2");

  await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.clearHazards();
    gyro.grantPowerup("shield");
  });
  await page.waitForTimeout(60);
  const shielded = await page.evaluate(() => window.__gyro.getState());
  if (!shielded.shield) throw new Error("Shield should be active after grant");
  if (!(shielded.powerHud || "").includes("Shield")) throw new Error(`Shield HUD missing, got: ${shielded.powerHud}`);
  await page.screenshot({ path: path.join(shotDir, "shield.png"), fullPage: true });
  await page.evaluate(() => window.__gyro.spawnHazardAhead(10));
  await page.waitForFunction(() => {
    const s = window.__gyro.getState();
    return s.mode === "playing" && s.shield === false && s.meteorCount === 0;
  }, { timeout: 5000 });
  const afterShield = await page.evaluate(() => window.__gyro.getState());
  if (afterShield.mode !== "playing") throw new Error(`Shield should absorb a hit, mode=${afterShield.mode}`);
  if (afterShield.shield) throw new Error("Shield should be consumed after a hit");
  if (afterShield.combo !== 0) throw new Error("Combo should reset on a shield hit");

  await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.clearHazards();
    gyro.grantPowerup("slow");
  });
  await page.waitForTimeout(40);
  const slow = await page.evaluate(() => {
    const gyro = window.__gyro;
    const before = gyro.getState();
    const growth0 = before.growthTime;
    const z0 = -80;
    const mesh = gyro.spawnHazardAhead(80);
    const st = gyro.getState();
    return { timeScale: st.timeScale, slowHold: st.slowHold, growth0, growth: st.growthTime, powerHud: st.powerHud };
  });
  if (Math.abs(slow.timeScale - 0.5) > 0.05) throw new Error(`Slow-mo should scale time to ~50%, got ${slow.timeScale}`);
  if (slow.slowHold <= 0) throw new Error("Slow-mo hold timer should be running");
  if (!(slow.powerHud || "").toLowerCase().includes("slow")) throw new Error(`Slow-mo HUD missing, got: ${slow.powerHud}`);
  const growthPaused = await page.evaluate(async () => {
    const gyro = window.__gyro;
    const g0 = gyro.getState().growthTime;
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 400));
    const st = gyro.getState();
    return { g0, g1: st.growthTime, dt: (performance.now() - t0) / 1000, timeScale: st.timeScale };
  });
  if (growthPaused.g1 - growthPaused.g0 > 0.05) {
    throw new Error(`Speed ramp should pause during slow-mo, growth ${growthPaused.g0} -> ${growthPaused.g1}`);
  }
  await page.screenshot({ path: path.join(shotDir, "slowmo.png"), fullPage: true });

  await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.clearHazards();
    gyro.restart();
    gyro.setMeteorSpawning(false);
    gyro.setBarSpawning(false);
    gyro.setPickupSpawning(false);
    gyro.clearHazards();
  });
  await page.waitForFunction(() => window.__gyro?.getState().mode === "playing", { timeout: 5000 });
  const x2 = await page.evaluate(() => {
    const gyro = window.__gyro;
    const before = gyro.getState();
    const baseGain = (() => {
      const d0 = before.scoreFromDistance;
      gyro.advance(2);
      return gyro.getState().scoreFromDistance - d0;
    })();
    gyro.grantPowerup("x2");
    const mid = gyro.getState();
    const d1 = mid.scoreFromDistance;
    gyro.advance(2);
    const after = gyro.getState();
    return {
      baseGain,
      boostedGain: after.scoreFromDistance - d1,
      multiplier: mid.scoreMultiplier,
      x2T: mid.x2T,
      powerHud: mid.powerHud,
    };
  });
  if (x2.multiplier !== 2) throw new Error(`×2 should set score multiplier to 2, got ${x2.multiplier}`);
  if (x2.x2T <= 0) throw new Error("×2 timer should be running");
  if (x2.boostedGain < x2.baseGain * 1.8) {
    throw new Error(`×2 should roughly double score gain, ${x2.baseGain} vs ${x2.boostedGain}`);
  }
  if (!(x2.powerHud || "").includes("×2")) throw new Error(`×2 HUD missing, got: ${x2.powerHud}`);
  await page.screenshot({ path: path.join(shotDir, "x2.png"), fullPage: true });

  await page.evaluate(() => {
    const gyro = window.__gyro;
    gyro.clearHazards();
    gyro.setDistance(1000);
  });
  await page.waitForFunction(() => window.__gyro.getState().paletteTo === 1 && window.__gyro.getState().paletteT >= 0.99, { timeout: 4000 });
  const pal2 = await page.evaluate(() => window.__gyro.getState());
  if (pal2.paletteId !== "magenta") throw new Error(`At 1000 m expected magenta palette, got ${pal2.paletteId}`);
  const milestone1000 = await page.locator("#milestone").innerText();
  if (!/magenta/i.test(milestone1000) || /\bm\b/i.test(milestone1000)) throw new Error(`Expected Magenta milestone without m, got: ${milestone1000}`);
  await page.screenshot({ path: path.join(shotDir, "palette-2.png"), fullPage: true });

  await page.evaluate(() => window.__gyro.setDistance(2000));
  await page.waitForFunction(() => window.__gyro.getState().paletteTo === 2 && window.__gyro.getState().paletteT >= 0.99, { timeout: 4000 });
  const pal3 = await page.evaluate(() => window.__gyro.getState());
  if (pal3.paletteId !== "teal") throw new Error(`At 2000 m expected teal palette, got ${pal3.paletteId}`);
  await page.screenshot({ path: path.join(shotDir, "palette-3.png"), fullPage: true });

  // Swept near-miss / hits at max speed, and boost meteor rate.
  await page.evaluate(() => {
    const g = window.__gyro;
    g.restart();
    g.setMeteorSpawning(false);
    g.setBarSpawning(false);
    g.setPickupSpawning(false);
    g.clearHazards();
    g.setRoll(0);
    g.setBoosting(false);
    g.setElapsed(60);
  });
  await page.waitForFunction(() => window.__gyro.getState().mode === "playing" && window.__gyro.getState().speedFactor >= 7.9, { timeout: 5000 });

  const swept = await page.evaluate(() => {
    const g = window.__gyro;
    const hitR = 0.45 + 1.35;
    const margin = g.getState().nearMissMargin;
    const run = (lateral, label) => {
      if (g.getState().mode !== "playing") {
        g.restart();
        g.setMeteorSpawning(false);
        g.setBarSpawning(false);
        g.setPickupSpawning(false);
        g.setElapsed(60);
        g.setRoll(0);
      }
      g.clearHazards();
      const before = g.getState();
      g.spawnByLateral(lateral, 10, { sizeScale: 1, speedScale: 1 });
      const after = g.sweepForward(40);
      return {
        label,
        lateral,
        hitR,
        margin,
        mode: after.mode,
        awarded: after.bonusScore - before.bonusScore,
      };
    };
    return {
      speed: g.getState().speed,
      hit: run(hitR * 0.5, "hit"),
      nearIn: run(hitR + 0.4, "near-in"),
      nearOut: run(hitR + margin + 0.3, "near-out"),
      nearEdgeIn: run(hitR + margin - 0.08, "near-edge-in"),
    };
  });
  if (swept.speed < 300) throw new Error(`Expected max speed for sweep tests, got ${swept.speed}`);
  if (swept.hit.mode === "playing") throw new Error("A centered meteor should still hit at max speed when it jumps past the ship");
  if (swept.nearIn.mode !== "playing" || swept.nearIn.awarded < 50) {
    throw new Error(`Near-miss just outside the hit radius should score at max speed, ${JSON.stringify(swept.nearIn)}`);
  }
  if (swept.nearOut.mode !== "playing" || swept.nearOut.awarded !== 0) {
    throw new Error(`A clean pass outside the margin should not score, ${JSON.stringify(swept.nearOut)}`);
  }
  if (swept.nearEdgeIn.mode !== "playing" || swept.nearEdgeIn.awarded < 50) {
    throw new Error(`A near-miss just inside the margin should score, ${JSON.stringify(swept.nearEdgeIn)}`);
  }

  await page.evaluate(() => {
    const g = window.__gyro;
    if (g.getState().mode !== "playing") {
      g.restart();
      g.setElapsed(60);
    }
    g.setMeteorSpawning(false);
    g.setBarSpawning(false);
    g.setPickupSpawning(false);
    g.clearHazards();
    g.setRoll(0);
    g.setBoosting(true);
    g.setElapsed(60);
    g.spawnByLateral(2.2, 28, { sizeScale: 1, speedScale: 1.2 });
  });
  await page.waitForFunction(() => {
    const s = window.__gyro.getState();
    return s.lastNearMiss > 0 || s.mode !== "playing";
  }, { timeout: 4000 });
  const naturalBoost = await page.evaluate(() => window.__gyro.getState());
  if (naturalBoost.mode !== "playing") throw new Error("Natural near-miss at boost speed should not crash");
  if (naturalBoost.lastNearMiss < 50) throw new Error("Natural near-miss at boost speed should award points");

  const measureRate = async (boost) => {
    await page.evaluate((on) => {
      const g = window.__gyro;
      g.restart();
      g.setBarSpawning(false);
      g.setPickupSpawning(false);
      g.setMeteorSpawning(false);
      g.clearHazards();
      g.setDistance(1500, true);
      g.setElapsed(60);
      g.setInvincible(true);
      g.setBoosting(on);
      g.resetPassCounters();
      g.setMeteorSpawning(true);
    }, boost);
    const t0 = Date.now();
    await page.waitForTimeout(8000);
    const st = await page.evaluate(() => window.__gyro.getState());
    const dt = (Date.now() - t0) / 1000;
    if (st.mode !== "playing") throw new Error(`Rate sample ended in mode=${st.mode}`);
    return { passed: st.meteorsPassed, spawned: st.meteorsSpawned, passRate: st.meteorsPassed / dt, spawnRate: st.meteorsSpawned / dt, dt };
  };
  const rateOff = await measureRate(false);
  const rateOn = await measureRate(true);
  if (rateOn.passRate < rateOff.passRate * 0.98) {
    throw new Error(`Boost should not reduce oncoming meteors/s, off=${rateOff.passRate.toFixed(2)} on=${rateOn.passRate.toFixed(2)}`);
  }
  if (rateOn.spawnRate < rateOff.spawnRate * 1.12) {
    throw new Error(`Boost should raise meteor spawn rate, off=${rateOff.spawnRate.toFixed(2)} on=${rateOn.spawnRate.toFixed(2)}`);
  }
  console.log(JSON.stringify({ boostRates: { rateOff, rateOn } }));

  if (errors.length) {
    console.warn("Page errors:", errors);
  }
  if (featErrors.length) {
    throw new Error(`Feature tests hit page errors: ${featErrors.join("; ")}`);
  }

  await browser.close();
  console.log(JSON.stringify({ ok: true, shots: shotDir, errors, rollBefore, land }, null, 2));
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
