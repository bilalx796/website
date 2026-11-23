// @ts-check
/**
 * Walkable glass corridors (dome ↔ dome, dome ↔ tram station).
 *
 * A corridor is a SWEEP along a curve through floor-level points:
 *  - the DECK: a flat slab (a rectangle swept along the curve, kept level
 *    side-to-side even on a ramp)
 *  - the ARCH: a half-ellipse cross-section swept along the curve, in glass
 *  - RIBS every meter: half-tori turned to face along the curve
 *  - a glowing LIGHT STRIP along the ceiling (a thin tube)
 *  - COLLARS where the corridor meets a dome or a platform
 *  - support posts down to the sand where the deck floats above it
 * All the static pieces of one material are merged into one mesh.
 *
 * The corridor also returns its walking path (floor-level points), which the
 * first-person explorer and the commuters walk along.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { floorHeight } from "./terrain.js";

const UP = new T.Vector3(0, 1, 0);

/**
 * @typedef {Object} CorridorMaterials
 * @property {T.Material} glass @property {T.Material} deck @property {T.Material} metal @property {T.Material} light
 */

/**
 * @param {Array<T.Vector3>} points - floor-level path (at least 2 points)
 * @param {CorridorMaterials} mats
 * @param {{width?: number, height?: number, collarStart?: boolean, collarEnd?: boolean}} [opts]
 * @returns {{meshes: Array<T.Mesh>, walk: Array<T.Vector3>, half: number}}
 */
export function buildCorridor(points, mats, opts = {}) {
  const W = opts.width ?? 1.4; // deck width
  const H = opts.height ?? 1.2; // arch height above the deck
  const R = W / 2 + 0.06; // arch half-width
  const curve = new T.CatmullRomCurve3(points, false, "centripetal");
  const len = curve.getLength();
  const N = Math.max(4, Math.ceil(len / 0.25));
  const K = 16; // arch segments

  // frames along the path: tangent, level sideways vector, world up
  const P = [], S = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const side = new T.Vector3().crossVectors(t, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    P.push(p);
    S.push(side);
  }

  // --- deck: top, two sides and a bottom, swept
  const deckPos = [];
  const deckIdx = [];
  const T0 = 0.12; // thickness
  const ring = (p, s) => [
    p.clone().addScaledVector(s, -W / 2), p.clone().addScaledVector(s, W / 2),
    p.clone().addScaledVector(s, W / 2).add(new T.Vector3(0, -T0, 0)), p.clone().addScaledVector(s, -W / 2).add(new T.Vector3(0, -T0, 0)),
  ];
  const deckUv = [];
  for (let i = 0; i <= N; i++) {
    for (const v of ring(P[i], S[i])) deckPos.push(v.x, v.y, v.z);
    const along = (len * i) / N / W; // texture repeats every deck-width along the corridor
    deckUv.push(0, along, 1, along, 1, along, 0, along);
  }
  for (let i = 0; i < N; i++) {
    for (let f = 0; f < 4; f++) {
      const a = i * 4 + f, b = i * 4 + ((f + 1) % 4), c = a + 4, d = b + 4;
      deckIdx.push(a, c, b, b, c, d);
    }
  }
  const deckGeo = new T.BufferGeometry();
  deckGeo.setAttribute("position", new T.Float32BufferAttribute(deckPos, 3));
  deckGeo.setAttribute("uv", new T.Float32BufferAttribute(deckUv, 2));
  deckGeo.setIndex(deckIdx);
  deckGeo.computeVertexNormals();
  const deck = new T.Mesh(deckGeo, mats.deck);

  // --- glass arch: half-ellipse swept along the path
  const archPos = [];
  const archUv = [];
  const archIdx = [];
  for (let i = 0; i <= N; i++) {
    for (let k = 0; k <= K; k++) {
      const a = (k / K) * Math.PI;
      const v = P[i].clone().addScaledVector(S[i], Math.cos(a) * R).addScaledVector(UP, Math.sin(a) * H);
      archPos.push(v.x, v.y, v.z);
      archUv.push((k / K) * 2, (len * i) / N / 1.6);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < K; k++) {
      const a = i * (K + 1) + k, b = a + 1, c = a + (K + 1), d = c + 1;
      archIdx.push(a, b, c, b, d, c);
    }
  }
  const archGeo = new T.BufferGeometry();
  archGeo.setAttribute("position", new T.Float32BufferAttribute(archPos, 3));
  archGeo.setAttribute("uv", new T.Float32BufferAttribute(archUv, 2));
  archGeo.setIndex(archIdx);
  archGeo.computeVertexNormals();
  const arch = new T.Mesh(archGeo, mats.glass);
  arch.renderOrder = 6;

  // --- ribs, base rails, posts and end collars (metal), merged
  const metal = [];
  const frame = (i) => new T.Matrix4().makeBasis(S[i], UP, new T.Vector3().crossVectors(S[i], UP));
  const ribEvery = Math.max(1, Math.round(1.0 / (len / N)));
  for (let i = 0; i <= N; i += ribEvery) {
    const rib = new T.TorusGeometry(1, 0.045, 5, 18, Math.PI);
    rib.scale(R + 0.02, H + 0.02, 1);
    rib.applyMatrix4(frame(i));
    rib.translate(P[i].x, P[i].y, P[i].z);
    metal.push(rib);
    // support post if the deck floats above the sand
    const ground = floorHeight(P[i].x, P[i].z);
    const gap = P[i].y - T0 - ground;
    if (gap > 0.15 && i % (ribEvery * 2) === 0) {
      for (const sgn of [-1, 1]) {
        const post = new T.CylinderGeometry(0.06, 0.08, gap, 6);
        const q = P[i].clone().addScaledVector(S[i], sgn * (W / 2 - 0.15));
        post.translate(q.x, ground + gap / 2, q.z);
        metal.push(post);
      }
    }
  }
  const collar = i => {
    const c = new T.TorusGeometry(1, 0.1, 6, 20, Math.PI);
    c.scale(R + 0.08, H + 0.08, 1);
    c.applyMatrix4(frame(i));
    c.translate(P[i].x, P[i].y, P[i].z);
    metal.push(c);
  };
  if (opts.collarStart !== false) collar(0);
  if (opts.collarEnd !== false) collar(N);
  // handrails along both walls, at hand height
  for (const sgn of [-1, 1]) {
    const railCurve = new T.CatmullRomCurve3(P.map((p, i) => p.clone().addScaledVector(S[i], sgn * (W / 2 - 0.05)).add(new T.Vector3(0, 0.5, 0))));
    metal.push(new T.TubeGeometry(railCurve, N, 0.025, 5, false));
  }
  for (const g of metal) for (const n of Object.keys(g.attributes)) if (!["position", "normal"].includes(n)) g.deleteAttribute(n);
  const metalMesh = new T.Mesh(mergeGeometries(metal.map(g => g.index ? g.toNonIndexed() : g)), mats.metal);

  // --- light strip along the ceiling
  const lightCurve = new T.CatmullRomCurve3(P.map(p => p.clone().add(new T.Vector3(0, H - 0.06, 0))));
  const lightGeos = [new T.TubeGeometry(lightCurve, N, 0.035, 5, false)];
  // little lights set into the floor along both edges
  for (let i = 1; i < N; i += 3) {
    for (const sgn of [-1, 1]) {
      const dot = new T.BoxGeometry(0.06, 0.02, 0.06);
      const q = P[i].clone().addScaledVector(S[i], sgn * (W / 2 - 0.12));
      dot.translate(q.x, q.y + 0.01, q.z);
      lightGeos.push(dot);
    }
  }
  for (const g of lightGeos) for (const n of Object.keys(g.attributes)) if (!["position", "normal"].includes(n)) g.deleteAttribute(n);
  const light = new T.Mesh(mergeGeometries(lightGeos.map(g => g.index ? g.toNonIndexed() : g)), mats.light);

  return {
    meshes: [deck, arch, metalMesh, light],
    walk: curve.getSpacedPoints(Math.max(2, Math.ceil(len / 0.5))),
    half: W / 2 - 0.12,
  };
}
