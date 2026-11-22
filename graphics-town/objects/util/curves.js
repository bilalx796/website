// @ts-check
/**
 * Closed cardinal spline in 3D, with an arc-length table.
 *
 * This is the 3D version of the train track from Workbook 3 (03-24):
 *  - each segment between control points p1 and p2 is a cubic Bézier whose inner
 *    control points come from the neighbors (cardinal spline):
 *        b1 = p1 + s (p2 - p0) / 3      b2 = p2 - s (p3 - p1) / 3
 *    with tension s = 0.5 this is a Catmull-Rom spline.
 *  - the curve parameter u is not proportional to distance, so we build a table
 *    of accumulated distance at many small steps. Looking up a distance in that
 *    table (binary search + linear interpolation) gives arc-length
 *    parameterization, so things move at constant speed along the curve.
 */

/** @typedef {[number, number, number]} Vec3 */

export class ClosedCardinalSpline {
  /**
   * @param {Array<Vec3>} points - control points (the curve passes through them)
   * @param {number} [tension=0.5] - 0.5 = Catmull-Rom
   * @param {number} [steps=64] - table samples per segment
   */
  constructor(points, tension = 0.5, steps = 64) {
    this.points = points;
    this.tension = tension;
    this.steps = steps;
    this.n = points.length;
    /** @type {Array<number>} accumulated distance at u = k / steps */
    this.table = [0];
    let prev = this.evalAt(0).pos;
    for (let k = 1; k <= this.n * steps; k++) {
      const p = this.evalAt(k / steps).pos;
      this.table.push(this.table[k - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
      prev = p;
    }
    this.length = this.table[this.table.length - 1];
  }

  /**
   * the 4 Bézier control points for segment i
   * @param {number} i
   * @returns {Array<Vec3>}
   */
  segment(i) {
    const n = this.n;
    const s = this.tension;
    const p0 = this.points[(i - 1 + n) % n];
    const p1 = this.points[i % n];
    const p2 = this.points[(i + 1) % n];
    const p3 = this.points[(i + 2) % n];
    /** @type {Vec3} */ const b1 = [0, 1, 2].map(k => p1[k] + (s * (p2[k] - p0[k])) / 3);
    /** @type {Vec3} */ const b2 = [0, 1, 2].map(k => p2[k] - (s * (p3[k] - p1[k])) / 3);
    return [p1, b1, b2, p2];
  }

  /**
   * position and unit tangent at curve parameter u (u in [0, n) - wraps)
   * @param {number} u
   * @returns {{pos: Vec3, tan: Vec3}}
   */
  evalAt(u) {
    const n = this.n;
    u = ((u % n) + n) % n;
    const i = Math.floor(u);
    const t = u - i;
    const [b0, b1, b2, b3] = this.segment(i);
    const v = 1 - t;
    /** @type {Vec3} */ const pos = [0, 0, 0];
    /** @type {Vec3} */ const der = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      pos[k] = v * v * v * b0[k] + 3 * v * v * t * b1[k] + 3 * v * t * t * b2[k] + t * t * t * b3[k];
      der[k] = 3 * v * v * (b1[k] - b0[k]) + 6 * v * t * (b2[k] - b1[k]) + 3 * t * t * (b3[k] - b2[k]);
    }
    const len = Math.hypot(der[0], der[1], der[2]) || 1;
    return { pos, tan: [der[0] / len, der[1] / len, der[2] / len] };
  }

  /**
   * curve parameter for a given distance along the curve (wraps around)
   * @param {number} dist
   */
  paramAtDistance(dist) {
    const L = this.length;
    dist = ((dist % L) + L) % L;
    const tb = this.table;
    // binary search for the table interval containing dist
    let lo = 0;
    let hi = tb.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tb[mid] <= dist) lo = mid;
      else hi = mid;
    }
    const span = tb[hi] - tb[lo] || 1;
    return (lo + (dist - tb[lo]) / span) / this.steps;
  }

  /**
   * distance along the curve for a curve parameter
   * @param {number} u
   */
  distanceAtParam(u) {
    const n = this.n;
    u = ((u % n) + n) % n;
    const k = Math.min(Math.floor(u * this.steps), this.table.length - 2);
    const f = u * this.steps - k;
    return this.table[k] + f * (this.table[k + 1] - this.table[k]);
  }

  /**
   * position and tangent at a distance along the curve
   * @param {number} dist
   */
  atDistance(dist) {
    return this.evalAt(this.paramAtDistance(dist));
  }
}

/**
 * Resample an open polyline so the points are equally spaced along it
 * (equal arc-length spacing, like the "20 evenly spaced points" exercise in WB3).
 * @param {Array<[number, number]>} pts
 * @param {number} count
 * @returns {Array<[number, number]>}
 */
export function resamplePolyline(pts, count) {
  if (pts.length === 0) return [];
  if (pts.length === 1 || count === 1) return Array.from({ length: count }, () => [pts[0][0], pts[0][1]]);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = acc[acc.length - 1];
  /** @type {Array<[number, number]>} */
  const out = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const d = (total * k) / (count - 1);
    while (seg < acc.length - 2 && acc[seg + 1] < d) seg++;
    const span = acc[seg + 1] - acc[seg] || 1;
    const f = Math.min(1, Math.max(0, (d - acc[seg]) / span));
    out.push([
      pts[seg][0] + f * (pts[seg + 1][0] - pts[seg][0]),
      pts[seg][1] + f * (pts[seg + 1][1] - pts[seg][1]),
    ]);
  }
  return out;
}
