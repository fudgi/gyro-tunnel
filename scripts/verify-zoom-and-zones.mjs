import { chromium } from "playwright";
import path from "node:path";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4185/";
const shotDir = path.resolve("/workspace/gyro-tunnel/screenshots");

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
await page.waitForSelector("#control-mode");

const meta = await page.evaluate(() => {
  const content = document.querySelector('meta[name="viewport"]')?.content || "";
  const styleOf = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      touchAction: s.touchAction,
      userSelect: s.userSelect,
      webkitUserSelect: s.webkitUserSelect,
      webkitTouchCallout: s.webkitTouchCallout,
      overscrollBehavior: s.overscrollBehavior,
    };
  };
  return {
    content,
    zoomGuards: window.__gyro?.zoomGuards === true,
    html: styleOf("html"),
    body: styleOf("body"),
    app: styleOf("#app"),
    scene: styleOf("#scene"),
    left: styleOf("#tap-left"),
    mute: styleOf("#mute"),
    action: styleOf("#action"),
  };
});

if (!/maximum-scale\s*=\s*1/.test(meta.content)) fail(`viewport max: ${meta.content}`);
if (!/user-scalable\s*=\s*no/.test(meta.content)) fail(`viewport scalable: ${meta.content}`);
if (!/minimum-scale\s*=\s*1/.test(meta.content)) fail(`viewport min: ${meta.content}`);
if (!meta.zoomGuards) fail("zoomGuards hook missing");
for (const [name, s] of Object.entries({
  html: meta.html,
  body: meta.body,
  app: meta.app,
  scene: meta.scene,
  left: meta.left,
  mute: meta.mute,
  action: meta.action,
})) {
  if (!s) fail(`missing style target ${name}`);
  if (s.touchAction !== "none") fail(`${name} touch-action=${s.touchAction}`);
  if (s.userSelect !== "none") fail(`${name} user-select=${s.userSelect}`);
}
if (meta.html.overscrollBehavior !== "none") fail(`html overscroll=${meta.html.overscrollBehavior}`);
if (meta.body.overscrollBehavior !== "none") fail(`body overscroll=${meta.body.overscrollBehavior}`);
console.log("viewport and css ok", meta.content);

const gesture = await page.evaluate(() => {
  const fire = (type, target) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  return {
    start: fire("gesturestart", window),
    change: fire("gesturechange", window),
    end: fire("gestureend", window),
    dblclick: fire("dblclick", window),
  };
});
if (!gesture.start || !gesture.change || !gesture.end) fail(`gesture prevent: ${JSON.stringify(gesture)}`);
if (!gesture.dblclick) fail("dblclick should be prevented");

const pinch = await page.evaluate(() => {
  const ev = new TouchEvent("touchmove", {
    bubbles: true,
    cancelable: true,
    touches: [
      new Touch({ identifier: 1, target: document.body, clientX: 80, clientY: 200 }),
      new Touch({ identifier: 2, target: document.body, clientX: 300, clientY: 240 }),
    ],
  });
  document.dispatchEvent(ev);
  return ev.defaultPrevented;
});
if (!pinch) fail("multi-touch touchmove should be prevented");

const doubleTap = await page.evaluate(async () => {
  const fire = () => {
    const ev = new Event("touchend", { bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  const first = fire();
  await new Promise((r) => setTimeout(r, 80));
  const second = fire();
  return { first, second };
});
if (doubleTap.first) fail("first touchend should not be preventDefaulted");
if (!doubleTap.second) fail("second touchend (double-tap zoom) should be preventDefaulted");
console.log("zoom guards ok", { gesture, pinch, doubleTap });

await page.evaluate(() => {
  localStorage.removeItem("gyro-tunnel-board");
  window.__gyro.setControlMode("tap");
  if (window.__gyro.getState().muted) window.__gyro.toggleMuted();
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#action");
await page.waitForTimeout(200);

const startUi = await page.evaluate(() => ({
  mode: window.__gyro.getState().controlMode,
  zonesHidden: document.getElementById("tap-zones")?.classList.contains("hidden"),
  label: document.getElementById("control-mode")?.innerText,
}));
if (startUi.mode !== "tap") fail(`start mode ${startUi.mode}`);
if (!startUi.zonesHidden) fail("zones should be hidden on start");

const mutedBefore = await page.evaluate(() => window.__gyro.getState().muted);
await page.click("#mute");
const mutedAfter = await page.evaluate(() => window.__gyro.getState().muted);
if (mutedAfter === mutedBefore) fail("mute button should toggle on the start screen");
await page.click("#mute"); // restore

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

const layout = await page.evaluate(() => {
  const left = document.getElementById("tap-left").getBoundingClientRect();
  const right = document.getElementById("tap-right").getBoundingClientRect();
  const mute = document.getElementById("mute").getBoundingClientRect();
  const mode = document.getElementById("control-mode").getBoundingClientRect();
  const hint = document.getElementById("hint")?.innerText || "";
  const zc = getComputedStyle(document.getElementById("corner-controls")).zIndex;
  const zz = getComputedStyle(document.getElementById("tap-zones")).zIndex;
  return {
    left: { x: left.x, y: left.y, w: left.width, h: left.height },
    right: { x: right.x, y: right.y, w: right.width, h: right.height },
    mute: { x: mute.x, y: mute.y, r: mute.right },
    mode: { x: mode.x, y: mode.y },
    hint,
    zc: Number(zc),
    zz: Number(zz),
    vw: innerWidth,
    vh: innerHeight,
  };
});

const { vw, vh } = layout;
if (Math.abs(layout.left.x) > 1) fail(`left x ${layout.left.x}`);
if (Math.abs(layout.left.y) > 1) fail(`left y ${layout.left.y}`);
if (Math.abs(layout.left.w - vw * 0.3) > 3) fail(`left w ${layout.left.w} expected ${vw * 0.3}`);
if (Math.abs(layout.left.h - vh) > 3) fail(`left h ${layout.left.h} expected ${vh}`);
if (Math.abs(layout.right.x - vw * 0.7) > 3) fail(`right x ${layout.right.x} expected ${vw * 0.7}`);
if (Math.abs(layout.right.y) > 1) fail(`right y ${layout.right.y}`);
if (Math.abs(layout.right.w - vw * 0.3) > 3) fail(`right w ${layout.right.w}`);
if (Math.abs(layout.right.h - vh) > 3) fail(`right h ${layout.right.h}`);
if (!(layout.zc > layout.zz)) fail(`corner z-index ${layout.zc} should beat zones ${layout.zz}`);
if (!/hold the sides to turn/i.test(layout.hint) || !/middle to boost/i.test(layout.hint)) {
  fail(`hint: ${layout.hint}`);
}
if (layout.mute.r > vw * 0.3 + 8) fail("mute should sit inside the left 30%");
console.log("layout ok", layout);

// Screenshot with the left zone held so the faint edges + highlight are visible
await page.mouse.move(vw * 0.15, vh * 0.72);
await page.mouse.down();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(shotDir, "tap-zones-vertical.png"), fullPage: true });
const leftHeld = await page.evaluate(() => window.__gyro.getState());
if (!leftHeld.tapLeft) fail("holding left column should turn");
if (leftHeld.boosting) fail("holding left column should not boost");
if (!(leftHeld.roll > 0.12)) fail(`left roll ${leftHeld.roll}`);
await page.mouse.up();
await page.waitForTimeout(80);
await page.evaluate(() => {
  window.__gyro.setRoll(0);
  window.__gyro.setBoosting(false);
});

// Hold high on the left column (not the old bottom strip) still turns
await page.mouse.move(vw * 0.15, vh * 0.18);
await page.mouse.down();
await page.waitForTimeout(400);
const highLeft = await page.evaluate(() => window.__gyro.getState());
if (!highLeft.tapLeft) fail("top of left column should turn");
if (highLeft.boosting) fail("top of left column should not boost");
if (!(highLeft.roll > 0.12)) fail(`high left roll ${highLeft.roll}`);
await page.mouse.up();
await page.waitForTimeout(80);
await page.evaluate(() => {
  window.__gyro.setRoll(0);
  window.__gyro.setBoosting(false);
});

// Right column
const beforeRight = await page.evaluate(() => window.__gyro.getState().roll);
await page.mouse.move(vw * 0.85, vh * 0.5);
await page.mouse.down();
await page.waitForTimeout(400);
const rightHeld = await page.evaluate(() => window.__gyro.getState());
if (!rightHeld.tapRight) fail("holding right column should turn");
if (rightHeld.boosting) fail("holding right column should not boost");
if (!(rightHeld.roll < beforeRight - 0.12)) fail(`right roll ${rightHeld.roll}`);
await page.mouse.up();
await page.waitForTimeout(80);
await page.evaluate(() => {
  window.__gyro.setRoll(0);
  window.__gyro.setBoosting(false);
});

// Middle 40% boost, no turn
await page.mouse.move(vw * 0.5, vh * 0.45);
await page.mouse.down();
await page.waitForTimeout(250);
const mid = await page.evaluate(() => window.__gyro.getState());
if (!mid.boosting) fail("holding the middle should boost");
if (mid.tapLeft || mid.tapRight) fail("middle hold should not turn");
await page.mouse.up();
await page.waitForTimeout(80);
await page.evaluate(() => window.__gyro.setBoosting(false));

// Multitouch: left turn + middle boost
await page.evaluate(() => {
  window.__gyro.setRoll(0);
  window.__gyro.setBoosting(false);
});
const combo = await page.evaluate(async () => {
  const left = document.getElementById("tap-left");
  const app = document.getElementById("app");
  const fire = (el, type, id, x, y) => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: id,
        pointerType: "touch",
        isPrimary: id === 11,
        clientX: x,
        clientY: y,
      })
    );
  };
  fire(left, "pointerdown", 11, innerWidth * 0.15, innerHeight * 0.6);
  fire(app, "pointerdown", 12, innerWidth * 0.5, innerHeight * 0.45);
  await new Promise((r) => setTimeout(r, 450));
  const state = window.__gyro.getState();
  fire(left, "pointerup", 11, innerWidth * 0.15, innerHeight * 0.6);
  fire(app, "pointerup", 12, innerWidth * 0.5, innerHeight * 0.45);
  return state;
});
if (!combo.tapLeft) fail("combo: left should be held");
if (!combo.boosting) fail("combo: middle should boost while turning");
if (!(combo.roll > 0.12)) fail(`combo roll ${combo.roll}`);
console.log("controls ok", { leftHeld: leftHeld.roll, highLeft: highLeft.roll, right: rightHeld.roll, combo });

// Corner buttons still win over the left zone during play
await page.evaluate(() => {
  window.__gyro.setRoll(0);
  window.__gyro.setBoosting(false);
});
const mutedPlayBefore = await page.evaluate(() => window.__gyro.getState().muted);
await page.click("#mute");
const afterMuteClick = await page.evaluate(() => window.__gyro.getState());
if (afterMuteClick.muted === mutedPlayBefore) fail("mute should still work over the left zone");
if (afterMuteClick.tapLeft) fail("clicking mute should not hold the left zone");
await page.click("#mute");

const modeBefore = await page.evaluate(() => window.__gyro.getState().controlMode);
await page.click("#control-mode");
const modeAfter = await page.evaluate(() => window.__gyro.getState().controlMode);
if (modeAfter === modeBefore) fail("Gyro/Tap should still toggle over the left zone");
if (modeAfter !== "gyro") fail(`expected gyro after toggle, got ${modeAfter}`);
await page.click("#control-mode");
const modeBack = await page.evaluate(() => window.__gyro.getState().controlMode);
if (modeBack !== "tap") fail(`expected tap again, got ${modeBack}`);

if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
console.log("ALL ZOOM AND VERTICAL ZONES OK");
await browser.close();
