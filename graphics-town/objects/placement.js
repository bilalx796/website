// @ts-check
/**
 * Helps scatter things (coral, rocks, kelp, anemones) without putting them on
 * top of buildings, the tram track or the dock.
 */

import { ClosedCardinalSpline } from "./util/curves.js";
import { DOMES, TRAM_ROUTE, SUB_ROUTE, WRECK, BEACON, VENTS, MINING_RIG, SPOIL_HEAP, CRAB_FLATS } from "./layout.js";

/** circles that must stay clear: [x, z, radius] */
const zones = [
  ...DOMES.map(([x, z, r]) => [x, z, r + 2.2]),
  [WRECK[0], WRECK[1], 9],
  [BEACON[0], BEACON[1], 3.5],
  [MINING_RIG[0], MINING_RIG[1], 7],
  [SPOIL_HEAP[0], SPOIL_HEAP[1], 4],
  [CRAB_FLATS[0], CRAB_FLATS[1], CRAB_FLATS[2] - 2],
  ...VENTS.map(([x, z]) => [x, z, 2.5]),
];
// the tram track and the dock area
const tram = new ClosedCardinalSpline(TRAM_ROUTE);
for (let d = 0; d < tram.length; d += 1.5) {
  const { pos } = tram.atDistance(d);
  zones.push([pos[0], pos[2], 2.6]);
}
const sub = new ClosedCardinalSpline(SUB_ROUTE);
const dockPos = sub.atDistance(sub.distanceAtParam(0)).pos;
zones.push([dockPos[0], dockPos[2], 8]);

/**
 * is (x, z) clear of all structures, with this much extra margin?
 * @param {number} x @param {number} z @param {number} [margin=0]
 */
export function isFree(x, z, margin = 0) {
  if (Math.abs(x) > 68 || Math.abs(z) > 68) return false;
  for (const [cx, cz, r] of zones) {
    if (Math.hypot(x - cx, z - cz) < r + margin) return false;
  }
  return true;
}
