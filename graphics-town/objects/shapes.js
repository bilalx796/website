// @ts-check
/**
 * Turning shapes into target points for the fish school.
 *
 * All functions return `count` 2D points, centered and scaled to fit in
 * [-0.5, 0.5] x [-0.5, 0.5], with y pointing UP.
 *
 * Two ways to get points:
 *  1. From the user's drawing (strokes): each stroke is resampled at EQUAL ARC
 *     LENGTH (Workbook 3), with the points shared between strokes in proportion
 *     to their length. A little jitter thickens the line so it reads well.
 *  2. From a filled picture (presets, text): draw it into an offscreen canvas,
 *     then pick random filled pixels, rejecting ones too close to points we
 *     already have (so they spread out evenly).
 */

import { resamplePolyline } from "./util/curves.js";
import { makeRng } from "./util/noise.js";

/** @typedef {Array<[number, number]>} Pts */

/**
 * center and scale points (given in canvas pixels, y down) into the unit box, y up
 * @param {Pts} pts
 * @returns {Pts}
 */
function normalize(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const s = Math.max(maxX - minX, maxY - minY, 1e-6);
  return pts.map(([x, y]) => [(x - cx) / s, -(y - cy) / s]);
}

/**
 * @param {Array<Pts>} strokes - each stroke is a list of [x, y] canvas points
 * @param {number} count
 * @returns {Pts}
 */
export function pointsFromStrokes(strokes, count) {
  const good = strokes.filter(s => s.length > 0);
  if (good.length === 0) return [];
  const lengths = good.map(s => {
    let L = 0;
    for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    return Math.max(L, 1);
  });
  // share the fish between strokes by length, but give every stroke at least a
  // few (so a dot for an eye still shows up)
  const minPer = Math.min(16, Math.floor(count / good.length / 2));
  const total = lengths.reduce((a, b) => a + b, 0);
  const shares = lengths.map(L => minPer + ((count - minPer * good.length) * L) / total);
  const counts = shares.map(Math.floor);
  let left = count - counts.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0; k = (k + 1) % counts.length, left--) counts[k]++;
  /** @type {Pts} */
  let pts = [];
  good.forEach((s, k) => {
    pts = pts.concat(resamplePolyline(s, Math.max(1, counts[k])));
  });
  pts = normalize(pts);
  // thicken the line a little
  const rng = makeRng(7);
  return pts.map(([x, y]) => [x + (rng() - 0.5) * 0.025, y + (rng() - 0.5) * 0.025]);
}

/**
 * Sample points from a filled drawing.
 * @param {(g: CanvasRenderingContext2D, W: number, H: number) => void} draw
 * @param {number} count
 * @returns {Pts}
 */
export function pointsFromDrawing(draw, count) {
  const W = 400;
  const H = 300;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { willReadFrequently: true }));
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  draw(g, W, H);
  const data = g.getImageData(0, 0, W, H).data;
  /** @type {Pts} */
  const filled = [];
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (data[(y * W + x) * 4] > 128) filled.push([x, y]);
    }
  }
  if (filled.length === 0) return [];
  // spread points out: try random candidates, keep the one farthest from the others
  const rng = makeRng(31);
  /** @type {Pts} */
  const chosen = [];
  for (let k = 0; k < count; k++) {
    let best = filled[Math.floor(rng() * filled.length)];
    let bestD = -1;
    for (let tries = 0; tries < 6; tries++) {
      const cand = filled[Math.floor(rng() * filled.length)];
      let d = Infinity;
      for (let j = Math.max(0, chosen.length - 200); j < chosen.length; j++) {
        d = Math.min(d, Math.hypot(cand[0] - chosen[j][0], cand[1] - chosen[j][1]));
      }
      if (d > bestD) { bestD = d; best = cand; }
    }
    chosen.push(best);
  }
  return normalize(chosen);
}

/** preset shapes */
export const PRESETS = {
  /** @param {number} n */
  heart: n =>
    pointsFromDrawing((g, W, H) => {
      g.beginPath();
      for (let k = 0; k <= 200; k++) {
        const t = (k / 200) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        const px = W / 2 + x * 8.5;
        const py = H / 2 - y * 8.5;
        if (k === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.fill();
    }, n),
  /** @param {number} n */
  star: n =>
    pointsFromDrawing((g, W, H) => {
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? 140 : 58;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        g.lineTo(W / 2 + r * Math.cos(a), H / 2 + 10 + r * Math.sin(a));
      }
      g.closePath();
      g.fill();
    }, n),
  /** @param {number} n */
  fish: n =>
    pointsFromDrawing((g, W, H) => {
      g.beginPath();
      g.ellipse(W / 2 + 30, H / 2, 120, 62, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(W / 2 - 70, H / 2);
      g.lineTo(W / 2 - 160, H / 2 - 70);
      g.lineTo(W / 2 - 160, H / 2 + 70);
      g.closePath();
      g.fill();
      g.fillStyle = "#000";
      g.beginPath();
      g.arc(W / 2 + 95, H / 2 - 14, 12, 0, Math.PI * 2);
      g.fill();
    }, n),
  /** @param {number} n */
  cs559: n =>
    pointsFromDrawing((g, W, H) => {
      g.font = "bold 120px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("559", W / 2, H / 2);
    }, n),
  /** @param {number} n */
  wave: n =>
    pointsFromStrokes(
      [
        Array.from({ length: 120 }, (_, k) => /** @type {[number, number]} */ ([k * 3, 150 + 60 * Math.sin(k * 0.105)])),
      ],
      n
    ),
};

/**
 * points from any text the user types
 * @param {string} text @param {number} n
 */
export function textPoints(text, n) {
  return pointsFromDrawing((g, W, H) => {
    let size = 150;
    g.font = `bold ${size}px sans-serif`;
    while (g.measureText(text).width > W - 20 && size > 20) {
      size -= 6;
      g.font = `bold ${size}px sans-serif`;
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, W / 2, H / 2);
  }, n);
}
