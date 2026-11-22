// @ts-check
/**
 * The "Reef" control panel (added below the world - the framework's WorldUI is
 * left untouched).
 *
 *  - Draw a shape: opens a drawing pad; whatever you draw, the school forms it
 *  - Preset shapes and "spell a word"
 *  - Feed the fish: click anywhere on the sea floor to drop food above that spot
 *  - Time of day: automatic cycle, or lock to day / night
 */

import * as T from "three";
import { reef } from "./reefState.js";
import { pointsFromStrokes, PRESETS, textPoints } from "./shapes.js";

const CSS = `
.reef-panel { width: 960px; max-width: 100%; box-sizing: border-box; margin-top: 8px; padding: 10px 12px;
  background: #0d2a3a; color: #e6f6fb; border-radius: 8px; font: 14px/1.4 system-ui, sans-serif; }
.reef-panel h3 { margin: 0 0 6px; font-size: 15px; color: #9fe3f5; }
.reef-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
.reef-row .label { min-width: 110px; color: #9cc3d0; }
.reef-panel button { background: #1d4f66; color: #fff; border: 1px solid #3a7f99; border-radius: 6px;
  padding: 5px 10px; cursor: pointer; font: inherit; }
.reef-panel button:hover { background: #276985; }
.reef-panel button.on { background: #f2b630; color: #1a1a1a; border-color: #f2b630; }
.reef-panel button.big { background: #f2b630; color: #1a1a1a; border-color: #f2b630; font-weight: 600; }
.reef-panel input[type=text] { background: #08202c; color: #fff; border: 1px solid #3a7f99; border-radius: 6px;
  padding: 5px 8px; width: 120px; font: inherit; }
.reef-status { color: #9cc3d0; font-size: 13px; }
.reef-pad-back { position: fixed; inset: 0; background: rgba(0,10,20,0.55); display: none;
  align-items: center; justify-content: center; z-index: 1000; }
.reef-pad { background: #0d2a3a; padding: 14px; border-radius: 10px; color: #e6f6fb;
  font: 14px system-ui, sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,0.5); max-width: calc(100vw - 32px); }
.reef-pad canvas { display: block; background: #0a3a52; border-radius: 6px; cursor: crosshair;
  touch-action: none; max-width: 100%; }
.reef-pad .reef-row { justify-content: flex-end; }
`;

/**
 * @param {Object} params
 * @param {import("CS559-Framework/GrWorld.js").GrWorld} params.world
 * @param {import("./fishSchool.js").FishSchool} params.school
 * @param {import("./shark.js").Shark} [params.shark]
 * @param {T.Mesh} params.floorMesh - for picking where to drop food
 * @param {HTMLElement} params.where
 */
export function makeReefUI({ world, school, shark, floorMesh, where }) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "reef-panel";
  panel.innerHTML = `
    <h3>Coralhaven controls</h3>
    <div class="reef-row"><span class="label">Fish school</span>
      <button class="big" data-act="draw">✏️ Draw a shape</button>
      <button data-shape="heart">Heart</button>
      <button data-shape="star">Star</button>
      <button data-shape="fish">Fish</button>
      <button data-shape="wave">Wave</button>
      <button data-shape="cs559">559</button>
      <input type="text" maxlength="8" placeholder="type a word" data-input="word">
      <button data-act="spell">Spell it</button>
      <button data-act="release">Release</button>
    </div>
    <div class="reef-row"><span class="label">Feed / scare</span>
      <button data-act="shark">🦈 Send the shark</button>
      <button data-act="feed">🍤 Feed the fish</button>
      <span class="reef-status" data-out="feed">turn on, then click the sea floor to drop food</span>
    </div>
    <div class="reef-row"><span class="label">Time of day</span>
      <button data-time="cycle" class="on">Auto cycle</button>
      <button data-time="day">Day</button>
      <button data-time="night">Night</button>
      <span class="reef-status" data-out="clock"></span>
    </div>`;
  where.appendChild(panel);

  /** @param {string} sel */
  const q = sel => /** @type {HTMLElement} */ (panel.querySelector(sel));
  const N = school.N;

  // --- shapes
  const formFrom = pts => {
    if (pts.length > 0) school.formShape(pts, world.active_camera);
  };
  panel.querySelectorAll("[data-shape]").forEach(b => {
    /** @type {HTMLElement} */ (b).onclick = () => formFrom(PRESETS[/** @type {HTMLElement} */ (b).dataset.shape](N));
  });
  const word = /** @type {HTMLInputElement} */ (q('[data-input="word"]'));
  const spell = () => {
    const text = word.value.trim();
    if (text) formFrom(textPoints(text, N));
  };
  q('[data-act="spell"]').onclick = spell;
  word.addEventListener("keydown", e => {
    if (e.key === "Enter") spell();
    e.stopPropagation(); // don't let typing drive the fly camera
  });
  q('[data-act="release"]').onclick = () => school.release();
  q('[data-act="shark"]').onclick = () => shark?.hunt();

  // --- drawing pad
  const back = document.createElement("div");
  back.className = "reef-pad-back";
  back.innerHTML = `<div class="reef-pad">
      <div style="margin-bottom:8px">Draw anything - the school will swim into it. You can use several strokes.</div>
      <canvas width="520" height="360"></canvas>
      <div class="reef-row"><button data-pad="clear">Clear</button><button data-pad="cancel">Cancel</button>
      <button class="big" data-pad="go">Swim! 🐟</button></div></div>`;
  document.body.appendChild(back);
  const pad = /** @type {HTMLCanvasElement} */ (back.querySelector("canvas"));
  const pg = /** @type {CanvasRenderingContext2D} */ (pad.getContext("2d"));
  /** @type {Array<Array<[number, number]>>} */
  let strokes = [];
  let drawing = false;

  function redrawPad() {
    pg.fillStyle = "#0a3a52";
    pg.fillRect(0, 0, pad.width, pad.height);
    pg.strokeStyle = "rgba(255,255,255,0.06)";
    pg.lineWidth = 1;
    for (let x = 0; x < pad.width; x += 40) { pg.beginPath(); pg.moveTo(x, 0); pg.lineTo(x, pad.height); pg.stroke(); }
    for (let y = 0; y < pad.height; y += 40) { pg.beginPath(); pg.moveTo(0, y); pg.lineTo(pad.width, y); pg.stroke(); }
    pg.strokeStyle = "#ffd36a";
    pg.lineWidth = 6;
    pg.lineCap = "round";
    pg.lineJoin = "round";
    for (const s of strokes) {
      pg.beginPath();
      s.forEach(([x, y], i) => (i === 0 ? pg.moveTo(x, y) : pg.lineTo(x, y)));
      if (s.length === 1) pg.lineTo(s[0][0] + 0.1, s[0][1]);
      pg.stroke();
    }
  }
  /** @param {PointerEvent} e @returns {[number, number]} */
  const padPoint = e => {
    const r = pad.getBoundingClientRect();
    return [((e.clientX - r.left) * pad.width) / r.width, ((e.clientY - r.top) * pad.height) / r.height];
  };
  pad.addEventListener("pointerdown", e => {
    drawing = true;
    pad.setPointerCapture(e.pointerId);
    strokes.push([padPoint(e)]);
    redrawPad();
  });
  pad.addEventListener("pointermove", e => {
    if (!drawing) return;
    strokes[strokes.length - 1].push(padPoint(e));
    redrawPad();
  });
  pad.addEventListener("pointerup", () => (drawing = false));

  const openPad = () => {
    strokes = [];
    redrawPad();
    back.style.display = "flex";
  };
  const closePad = () => (back.style.display = "none");
  q('[data-act="draw"]').onclick = openPad;
  /** @type {HTMLElement} */ (back.querySelector('[data-pad="clear"]')).onclick = () => {
    strokes = [];
    redrawPad();
  };
  /** @type {HTMLElement} */ (back.querySelector('[data-pad="cancel"]')).onclick = closePad;
  /** @type {HTMLElement} */ (back.querySelector('[data-pad="go"]')).onclick = () => {
    closePad();
    formFrom(pointsFromStrokes(strokes, N));
  };

  // --- feeding: a click (not a drag) on the world drops food above the clicked spot
  let feeding = false;
  const feedBtn = q('[data-act="feed"]');
  feedBtn.onclick = () => {
    feeding = !feeding;
    feedBtn.classList.toggle("on", feeding);
  };
  const canvas = world.renderer.domElement;
  let downAt = [0, 0];
  canvas.addEventListener("pointerdown", e => (downAt = [e.clientX, e.clientY]));
  canvas.addEventListener("pointerup", e => {
    if (!feeding) return;
    if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return; // that was a drag
    const r = canvas.getBoundingClientRect();
    const ndc = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new T.Raycaster();
    ray.setFromCamera(ndc, world.active_camera);
    const hit = ray.intersectObject(floorMesh, false)[0];
    if (hit) {
      school.dropFood(hit.point.x, hit.point.y + 7, hit.point.z);
      q('[data-out="feed"]').textContent = `food dropped at (${hit.point.x.toFixed(0)}, ${hit.point.z.toFixed(0)})`;
    }
  });

  // --- time of day
  panel.querySelectorAll("[data-time]").forEach(b => {
    /** @type {HTMLElement} */ (b).onclick = () => {
      reef.mode = /** @type {HTMLElement} */ (b).dataset.time;
      panel.querySelectorAll("[data-time]").forEach(x => x.classList.toggle("on", x === b));
    };
  });
  const clock = q('[data-out="clock"]');
  setInterval(() => {
    const h = Math.floor(reef.hours);
    const m = Math.floor((reef.hours - h) * 60);
    const label = reef.daylight > 0.7 ? "day" : reef.daylight < 0.3 ? "night" : "twilight";
    clock.textContent = `reef clock ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} (${label})`;
  }, 250);

  return { panel, openPad };
}
