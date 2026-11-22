// @ts-check
/**
 * The shape of the sea floor, as a function: height = floorHeight(x, z).
 *
 * Everything that needs to sit on (or stay above) the floor uses this same
 * function: the floor mesh, pylons, coral, crabs, the fish school...
 *
 * The height is built from layers:
 *  - noise dunes everywhere (fBm)
 *  - flattened near the town square so the buildings sit on level ground
 *  - rocky ridges at the east and west edges
 *  - a deep trench to the north
 *  - a rock outcrop under the beacon and a mound under the wreck
 */

import { fbm2, smoothstep } from "./util/noise.js";
import { BEACON, WRECK } from "./layout.js";

/**
 * @param {number} x
 * @param {number} z
 * @returns {number} height of the sea floor
 */
export function floorHeight(x, z) {
  // rolling dunes
  let h = 1.1 * fbm2(x * 0.045, z * 0.045, 4);
  // long sand waves running east-west
  h += 0.25 * Math.sin(z * 0.35 + 2.0 * fbm2(x * 0.03, z * 0.03, 2));

  // flatten the town square
  const r = Math.hypot(x, z);
  const flat = 1 - smoothstep(16, 26, r);
  h *= 1 - 0.85 * flat;

  // rocky ridges at the east/west edges
  const ridge = smoothstep(44, 70, Math.abs(x));
  h += ridge * (8 + 4 * fbm2(z * 0.07, x * 0.07, 3));

  // rising slope to the south
  h += 4 * smoothstep(48, 72, z);

  // deep trench to the north
  h -= 22 * smoothstep(38, 58, -z);

  // rock outcrop under the beacon tower
  const db = Math.hypot(x - BEACON[0], z - BEACON[1]);
  h += 3.2 * Math.exp(-(db * db) / 14) * (0.85 + 0.3 * fbm2(x * 0.5, z * 0.5, 2));

  // mound the wreck sank into
  const dw = Math.hypot(x - WRECK[0], z - WRECK[1]);
  h += 1.2 * Math.exp(-(dw * dw) / 60);

  return h;
}

/**
 * approximate slope (steepness) at a point - used for coloring rock vs sand
 * @param {number} x @param {number} z
 */
export function floorSlope(x, z) {
  const e = 0.5;
  const dx = floorHeight(x + e, z) - floorHeight(x - e, z);
  const dz = floorHeight(x, z + e) - floorHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}
