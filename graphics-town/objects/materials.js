// @ts-check
/**
 * Shared materials and procedurally painted textures (all made in code with
 * the canvas 2D API - no image files needed).
 *
 *  - an environment cube map (water gradient) for reflective glass/metal (WB5)
 *  - wood planks (for the shipwreck)
 *  - a rock normal map computed from a noise height field (WB5 normal maps)
 *  - a bumpy texture for coral (WB5 bump maps)
 *  - a hexagon shell pattern (for the turtle)
 *  - "glow" materials whose windows light up at night (like the WB5 buildings)
 */

import * as T from "three";
import { reef } from "./reefState.js";
import { fbm2, makeRng } from "./util/noise.js";

/** @param {number} w @param {number} h */
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: /** @type {CanvasRenderingContext2D} */ (c.getContext("2d")) };
}

let envMap = null;
/**
 * A cube map of the underwater surroundings: bright from above, deep blue below.
 * Used as envMap on glass and metal so they have something to reflect.
 */
export function waterEnvMap() {
  if (envMap) return envMap;
  const S = 128;
  const faces = [];
  // order: +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    const { c, g } = canvas(S, S);
    if (f === 2) {
      // looking up: bright surface with ripples
      const grad = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S * 0.75);
      grad.addColorStop(0, "#e8fbff");
      grad.addColorStop(1, "#4fb8d8");
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
    } else if (f === 3) {
      g.fillStyle = "#6a7f78"; // sand below
      g.fillRect(0, 0, S, S);
    } else {
      const grad = g.createLinearGradient(0, 0, 0, S);
      grad.addColorStop(0, "#7fd6ee");
      grad.addColorStop(0.5, "#1c7fa6");
      grad.addColorStop(1, "#0b3550");
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
      // a few soft light shafts
      g.globalAlpha = 0.18;
      g.fillStyle = "#ffffff";
      for (let k = 0; k < 3; k++) {
        const x = ((f * 37 + k * 41) % S);
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 10, 0);
        g.lineTo(x + 30, S);
        g.lineTo(x + 14, S);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    faces.push(c);
  }
  envMap = new T.CubeTexture(faces);
  envMap.colorSpace = T.SRGBColorSpace;
  envMap.needsUpdate = true;
  return envMap;
}

/** weathered wood planks, painted procedurally */
export function woodTexture() {
  const W = 256, H = 256;
  const { c, g } = canvas(W, H);
  const rng = makeRng(99);
  const plank = 32;
  for (let y = 0; y < H; y += plank) {
    const base = 70 + rng() * 30;
    g.fillStyle = `rgb(${base + 30}, ${base + 5}, ${base - 25})`;
    g.fillRect(0, y, W, plank);
    // grain
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(30, 18, 8, ${0.1 + rng() * 0.2})`;
      g.lineWidth = 1;
      const yy = y + rng() * plank;
      g.beginPath();
      g.moveTo(0, yy);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, yy + Math.sin(x * 0.05 + k) * 1.5);
      g.stroke();
    }
    // seams and nails
    g.fillStyle = "rgba(20, 12, 5, 0.8)";
    g.fillRect(0, y, W, 2);
    const seam = rng() * W;
    g.fillRect(seam, y, 2, plank);
    g.fillStyle = "rgba(60, 70, 60, 0.9)";
    g.fillRect(seam - 6, y + 6, 3, 3);
    g.fillRect(seam + 5, y + plank - 9, 3, 3);
  }
  // green algae and barnacle spots
  for (let k = 0; k < 220; k++) {
    g.fillStyle = rng() < 0.7 ? `rgba(70, 110, 60, ${0.15 + rng() * 0.25})` : `rgba(220, 220, 200, ${0.3 + rng() * 0.3})`;
    g.beginPath();
    g.arc(rng() * W, rng() * H, 1 + rng() * 5, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

/**
 * Normal map computed from a noise height field: the normal at each pixel comes
 * from the height differences to its neighbors (central differences), packed
 * into RGB as (n + 1) / 2.
 * @param {number} [seed=1] @param {number} [freq=0.05] @param {number} [strength=3]
 */
export function noiseNormalMap(seed = 1, freq = 0.05, strength = 3) {
  const S = 128;
  const { c, g } = canvas(S, S);
  const img = g.createImageData(S, S);
  // tileable height: sample noise on a torus-ish wrap by blending
  const h = (x, y) => {
    const u = (x / S) * Math.PI * 2;
    const v = (y / S) * Math.PI * 2;
    return fbm2(Math.cos(u) * S * freq * 0.3 + seed * 10 + Math.sin(v) * 3, Math.sin(u) * S * freq * 0.3 + Math.cos(v) * S * freq * 0.3, 4);
  };
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) H[y * S + x] = h(x, y);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = H[y * S + ((x - 1 + S) % S)];
      const r = H[y * S + ((x + 1) % S)];
      const d = H[((y - 1 + S) % S) * S + x];
      const u = H[((y + 1) % S) * S + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const k = (y * S + x) * 4;
      img.data[k] = (nx * 0.5 + 0.5) * 255;
      img.data[k + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[k + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  return tex;
}

/** small bumpy spots (grayscale) for coral bump maps */
export function bumpyTexture(seed = 5) {
  const S = 128;
  const { c, g } = canvas(S, S);
  const rng = makeRng(seed);
  g.fillStyle = "#808080";
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 260; k++) {
    const x = rng() * S, y = rng() * S, r = 1.5 + rng() * 3.5;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(128,128,128,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  return tex;
}

/** hexagon scute pattern for the turtle shell */
export function shellTexture() {
  const W = 256, H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#4a3a1e";
  g.fillRect(0, 0, W, H);
  const r = 26;
  const rng = makeRng(8);
  for (let row = -1; row < 7; row++) {
    for (let col = -1; col < 7; col++) {
      const cx = col * r * 1.75 + (row % 2) * r * 0.87;
      const cy = row * r * 1.5;
      const shade = 90 + rng() * 50;
      const grad = g.createRadialGradient(cx, cy, 2, cx, cy, r);
      grad.addColorStop(0, `rgb(${shade + 60}, ${shade + 30}, ${shade - 30})`);
      grad.addColorStop(1, `rgb(${shade - 20}, ${shade - 35}, ${shade - 70})`);
      g.fillStyle = grad;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        g.lineTo(cx + (r - 3) * Math.cos(a), cy + (r - 3) * Math.sin(a));
      }
      g.closePath();
      g.fill();
    }
  }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

/**
 * A material for windows / lamps that glows at night. Every glow material is
 * remembered and updated once per frame by updateGlowMaterials().
 * @type {Array<{mat: T.MeshStandardMaterial, day: number, night: number}>}
 */
const glowList = [];
/**
 * @param {number} color @param {number} [day=0.15] @param {number} [night=1.8]
 */
export function glowMaterial(color, day = 0.15, night = 1.8) {
  const mat = new T.MeshStandardMaterial({ color: 0x223040, emissive: color, emissiveIntensity: day, roughness: 0.4 });
  glowList.push({ mat, day, night });
  return mat;
}
export function updateGlowMaterials() {
  for (const g of glowList) g.mat.emissiveIntensity = g.day + (g.night - g.day) * reef.night;
}
