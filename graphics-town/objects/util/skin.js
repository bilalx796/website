// @ts-check
/**
 * Helpers for building skinned meshes (linear blend skinning).
 */

import * as T from "three";

/**
 * Add skinIndex / skinWeight attributes to a geometry. For every vertex,
 * `weightsFor` returns a list of [boneIndex, weight] pairs (up to 4); the
 * weights are normalized so they add up to 1 (a common skinning bug otherwise!).
 * @param {T.BufferGeometry} geo
 * @param {(v: T.Vector3, i: number) => Array<[number, number]>} weightsFor
 */
export function addSkinWeights(geo, weightsFor) {
  const pos = geo.attributes.position;
  const idx = [];
  const wts = [];
  const v = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let list = weightsFor(v, i).filter(([, w]) => w > 1e-4);
    list.sort((a, b) => b[1] - a[1]);
    list = list.slice(0, 4);
    if (list.length === 0) list = [[0, 1]];
    const sum = list.reduce((s, [, w]) => s + w, 0);
    for (let k = 0; k < 4; k++) {
      idx.push(k < list.length ? list[k][0] : 0);
      wts.push(k < list.length ? list[k][1] / sum : 0);
    }
  }
  geo.setAttribute("skinIndex", new T.Uint16BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new T.Float32BufferAttribute(wts, 4));
}

/**
 * keep only position/normal/uv (+color if all have it) so geometries can be merged
 * @param {T.BufferGeometry} g
 */
export function cleanGeo(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(ng.attributes)) {
    if (!["position", "normal", "uv"].includes(name)) ng.deleteAttribute(name);
  }
  return ng;
}

/**
 * paint a constant vertex color on a geometry
 * @param {T.BufferGeometry} g @param {number} hex
 */
export function paint(g, hex) {
  const c = new T.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new T.BufferAttribute(arr, 3));
  return g;
}

/** linear ramp: 0 at a, 1 at b (clamped) */
export function ramp(a, b, x) {
  return Math.min(1, Math.max(0, (x - a) / (b - a)));
}
