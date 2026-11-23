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

// ---------------------------------------------------------------------------
// Textures for the hubs and corridors (all painted in code)
// ---------------------------------------------------------------------------

const texCache = {};
/** @param {string} key @param {() => T.Texture} make */
function cached(key, make) {
  if (!texCache[key]) texCache[key] = make();
  return texCache[key];
}

/** geodesic glass: faint glass with bright triangular panel frames */
export function glassPanelTexture() {
  return cached("glassPanel", () => {
    const W = 512, H = 256;
    const { c, g } = canvas(W, H);
    g.fillStyle = "rgba(200, 238, 255, 0.18)";
    g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(235, 250, 255, 0.95)";
    g.lineWidth = 2;
    const cell = 32;
    for (let y = 0; y <= H; y += cell) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    for (let x = -H; x <= W + H; x += cell) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke();
      g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke();
    }
    // a soft highlight in some panels
    g.fillStyle = "rgba(255,255,255,0.06)";
    const rng = makeRng(3);
    for (let k = 0; k < 40; k++) g.fillRect(rng() * W, rng() * H, cell * 0.6, cell * 0.3);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    return t;
  });
}

/** weathered concrete with panel seams and bolts (dome bases) */
export function concreteTexture() {
  return cached("concrete", () => {
    const S = 256;
    const { c, g } = canvas(S, S / 2);
    g.fillStyle = "#b7bcb6";
    g.fillRect(0, 0, S, S / 2);
    const rng = makeRng(21);
    for (let k = 0; k < 900; k++) {
      const v = 150 + rng() * 60;
      g.fillStyle = `rgba(${v},${v + 4},${v},${0.25 + rng() * 0.3})`;
      g.fillRect(rng() * S, rng() * S / 2, 1 + rng() * 3, 1 + rng() * 3);
    }
    // algae stains near the bottom
    const grad = g.createLinearGradient(0, S / 2, 0, S / 4);
    grad.addColorStop(0, "rgba(70,110,70,0.45)");
    grad.addColorStop(1, "rgba(70,110,70,0)");
    g.fillStyle = grad;
    g.fillRect(0, S / 4, S, S / 4);
    // seams and bolts
    g.strokeStyle = "rgba(60,65,60,0.8)";
    g.lineWidth = 2;
    for (let x = 0; x <= S; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S / 2); g.stroke(); }
    g.beginPath(); g.moveTo(0, 18); g.lineTo(S, 18); g.stroke();
    g.fillStyle = "#6d7276";
    for (let x = 8; x < S; x += 16) { g.beginPath(); g.arc(x, 10, 2.2, 0, Math.PI * 2); g.fill(); }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    return t;
  });
}

/**
 * floor textures for the hubs
 * @param {"checker"|"lab"|"raised"|"pavers"} kind
 */
export function floorTexture(kind) {
  return cached("floor-" + kind, () => {
    const S = 256;
    const { c, g } = canvas(S, S);
    const rng = makeRng(kind.length * 7);
    if (kind === "checker") {
      const n = 8;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 ? "#2f4a5c" : "#efe9dc";
        g.fillRect((i * S) / n, (j * S) / n, S / n, S / n);
      }
    } else if (kind === "lab") {
      g.fillStyle = "#e9eef0";
      g.fillRect(0, 0, S, S);
      g.strokeStyle = "#b9c4c8";
      g.lineWidth = 2;
      for (let x = 0; x <= S; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(S, x); g.stroke(); }
      for (let k = 0; k < 300; k++) { g.fillStyle = `rgba(150,170,175,${rng() * 0.25})`; g.fillRect(rng() * S, rng() * S, 2, 2); }
    } else if (kind === "raised") {
      // raised data-center floor: dark tiles, some perforated
      g.fillStyle = "#3b4146";
      g.fillRect(0, 0, S, S);
      const n = 4;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = (i * S) / n, y = (j * S) / n;
        g.fillStyle = "#4a5157";
        g.fillRect(x + 3, y + 3, S / n - 6, S / n - 6);
        if ((i + j) % 3 === 0) {
          g.fillStyle = "#23282c";
          for (let a = 10; a < S / n - 8; a += 8) for (let b = 10; b < S / n - 8; b += 8) {
            g.beginPath(); g.arc(x + a, y + b, 2, 0, Math.PI * 2); g.fill();
          }
        }
      }
    } else {
      // stone pavers with moss in the gaps
      g.fillStyle = "#4f6b3a";
      g.fillRect(0, 0, S, S);
      for (let k = 0; k < 26; k++) {
        const x = rng() * S, y = rng() * S, w = 30 + rng() * 40, h = 24 + rng() * 30;
        const v = 150 + rng() * 50;
        g.fillStyle = `rgb(${v},${v - 8},${v - 25})`;
        g.beginPath();
        g.ellipse(x, y, w / 2, h / 2, rng() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    return t;
  });
}

/** server rack front: stacked units with vents and handles */
export function rackTexture() {
  return cached("rack", () => {
    const W = 64, H = 256;
    const { c, g } = canvas(W, H);
    g.fillStyle = "#16191d";
    g.fillRect(0, 0, W, H);
    for (let y = 6; y < H - 6; y += 14) {
      g.fillStyle = "#2a2f35";
      g.fillRect(5, y, W - 10, 11);
      g.fillStyle = "#11141a";
      for (let x = 10; x < W - 22; x += 4) g.fillRect(x, y + 3, 2, 5); // vent slots
      g.fillStyle = "#8a939c";
      g.fillRect(W - 15, y + 4, 6, 3); // handle
    }
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  });
}

/** a screen full of code (scrolls when you move its offset) */
export function codeScreenTexture(seed = 1) {
  const W = 128, H = 128;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#071a12";
  g.fillRect(0, 0, W, H);
  const rng = makeRng(seed);
  const colors = ["#5dff9a", "#7fd6ff", "#ffd36a", "#ff8fb1", "#cfe8ff"];
  for (let y = 4; y < H; y += 7) {
    let x = 4 + Math.floor(rng() * 4) * 6;
    while (x < W - 10 && rng() < 0.85) {
      const len = 6 + rng() * 22;
      g.fillStyle = colors[Math.floor(rng() * colors.length)];
      g.fillRect(x, y, len, 3);
      x += len + 4;
    }
  }
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/** corridor floor: diamond-plate metal */
export function deckTexture() {
  return cached("deck", () => {
    const S = 128;
    const { c, g } = canvas(S, S);
    g.fillStyle = "#9aa3a8";
    g.fillRect(0, 0, S, S);
    g.fillStyle = "#b9c2c6";
    for (let y = 0; y < S; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < S; x += 16) {
      g.save(); g.translate(x + 4, y + 4); g.rotate(0.7); g.fillRect(-5, -1.5, 10, 3); g.restore();
    }
    g.fillStyle = "rgba(40,45,50,0.6)";
    g.fillRect(0, 0, S, 2); // a seam between plates
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    return t;
  });
}

/**
 * CC0 texture sets from ambientCG (https://ambientcg.com), resized to 512 px:
 * Ground054 (sand), Rock063, Planks037A, Concrete034, DiamondPlate008A,
 * MetalPlates004. Each has a color map and an OpenGL-style normal map.
 * @param {"Ground054"|"Rock063"|"Planks037A"|"Concrete034"|"DiamondPlate008A"|"MetalPlates004"} name
 * @param {number} [rx=1] @param {number} [ry=1] - how many times it repeats
 */
export function texturePack(name, rx = 1, ry = 1) {
  const loader = new T.TextureLoader();
  const map = loader.load(`./textures/${name}_Color.jpg`);
  map.colorSpace = T.SRGBColorSpace;
  const normalMap = loader.load(`./textures/${name}_NormalGL.jpg`);
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(rx, ry);
  }
  return { map, normalMap };
}
