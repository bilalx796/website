// @ts-check
/**
 * Things drawn on top of / next to the 3D view:
 *  - wrapCanvas: puts the canvas inside a positioned box so overlays can sit on it
 *  - makeZoomBar: a vertical zoom slider on the right edge of the view (changes
 *    the camera's field of view: a smaller FOV = zoomed in)
 *  - hideWorldUIRows: hides rows of the framework's lil-gui WorldUI panel
 */

import * as T from "three";

/** @param {import("CS559-Framework/GrWorld.js").GrWorld} world */
export function wrapCanvas(world) {
  const canvas = world.renderer.domElement;
  const wrap = document.createElement("div");
  wrap.className = "view-wrap";
  Object.assign(wrap.style, {
    position: "relative", display: "inline-block", lineHeight: "0", overflow: "hidden",
  });
  canvas.parentElement.insertBefore(wrap, canvas);
  wrap.appendChild(canvas);
  return wrap;
}

const ZOOM_CSS = `
.zoom-bar { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 6;
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 6px;
  background: rgba(0, 25, 40, 0.55); border-radius: 18px; line-height: 1.2;
  font: 12px system-ui, sans-serif; color: #e6f6fb; user-select: none; }
.zoom-bar button { width: 26px; height: 26px; border-radius: 50%; border: 1px solid #5fb3cc;
  background: #0d3a50; color: #fff; font: bold 16px system-ui, sans-serif; cursor: pointer; padding: 0; }
.zoom-bar button:hover { background: #1d5f7a; }
.zoom-bar input[type=range] { writing-mode: vertical-lr; direction: rtl; height: 180px; width: 22px;
  accent-color: #f2b630; cursor: pointer; margin: 0; }
`;

/**
 * @param {import("CS559-Framework/GrWorld.js").GrWorld} world
 * @param {HTMLElement} wrap
 */
export function makeZoomBar(world, wrap) {
  const style = document.createElement("style");
  style.textContent = ZOOM_CSS;
  document.head.appendChild(style);
  const bar = document.createElement("div");
  bar.className = "zoom-bar";
  bar.innerHTML = `<span>Zoom</span><button data-z="in" title="zoom in (=)">+</button>
    <input type="range" min="1" max="5" step="0.05" value="1" aria-label="zoom">
    <button data-z="out" title="zoom out (-)">−</button><span data-z="label">1.0×</span>`;
  wrap.appendChild(bar);
  const slider = /** @type {HTMLInputElement} */ (bar.querySelector("input"));
  const label = /** @type {HTMLElement} */ (bar.querySelector('[data-z="label"]'));
  // keep clicks on the bar from reaching the camera controls
  bar.addEventListener("pointerdown", e => e.stopPropagation());
  bar.addEventListener("wheel", e => e.stopPropagation());

  const baseFov = world.camera.fov;
  const apply = () => {
    const zoom = Number(slider.value);
    // zoom by narrowing the field of view: tan(fov/2) shrinks by the zoom factor
    const fov = (2 * Math.atan(Math.tan((baseFov * Math.PI) / 360) / zoom) * 180) / Math.PI;
    for (const cam of [world.camera, world.solo_camera]) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    label.textContent = `${zoom.toFixed(1)}×`;
  };
  const nudge = d => {
    slider.value = String(Math.min(5, Math.max(1, Number(slider.value) + d)));
    apply();
  };
  slider.addEventListener("input", apply);
  /** @type {HTMLElement} */ (bar.querySelector('[data-z="in"]')).onclick = () => nudge(0.25);
  /** @type {HTMLElement} */ (bar.querySelector('[data-z="out"]')).onclick = () => nudge(-0.25);
  window.addEventListener("keydown", e => {
    if (/** @type {HTMLElement} */ (e.target)?.closest?.("input[type=text], textarea")) return;
    if (e.key === "=" || e.key === "+") nudge(0.25);
    if (e.key === "-" || e.key === "_") nudge(-0.25);
  });
  apply();
  return bar;
}

/**
 * hide rows of the WorldUI (lil-gui) panel by their label
 * @param {Array<string>} labels
 */
export function hideWorldUIRows(labels) {
  document.querySelectorAll(".lil-gui .controller").forEach(c => {
    const name = c.querySelector(".name")?.textContent?.trim() ?? "";
    if (labels.some(l => name.startsWith(l))) /** @type {HTMLElement} */ (c).style.display = "none";
  });
}
