// @ts-check
/**
 * Procedurally generated coral.
 *
 * Five generators make coral geometry from code (no models):
 *   branching - recursive branching: each branch spawns 2-3 thinner, shorter
 *               children at random angles (an L-system-like recursion), with
 *               round tips
 *   brain     - a sphere whose vertices are pushed in/out by a ridged noise
 *               function (folds like a brain coral)
 *   fan       - a flat sea fan: recursive branching that stays in one plane
 *   tube      - a cluster of open tubes of different heights
 *   table     - a flat plate on a short stem
 * Each generator's pieces are merged into ONE geometry.
 *
 * Performance: several random variants of each generator are made, and each
 * variant is drawn as an InstancedMesh with per-instance position, rotation,
 * scale and COLOR - so ~200 corals take about a dozen draw calls.
 * Coral materials use a bump map for a rough surface (Workbook 5).
 *
 * Behavior: sea fans sway gently in the current (instance matrices updated).
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { texturePack, polypTexture } from "./materials.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { isFree } from "./placement.js";
import { bumpyTexture } from "./materials.js";
import { makeRng, noise3 } from "./util/noise.js";
import { reef } from "./reefState.js";

/** a cylinder from point a to point b */
function limb(a, b, r0, r1, radial = 6) {
  const dir = new T.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new T.CylinderGeometry(r1, r0, len, radial, 1, false);
  g.translate(0, len / 2, 0);
  const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

/** strip a geometry down to position/normal/uv so different kinds can be merged */
function clean(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(ng.attributes)) {
    if (!["position", "normal", "uv"].includes(name)) ng.deleteAttribute(name);
  }
  return ng;
}

/** @param {() => number} rng */
function branching(rng, planar = false) {
  const parts = [];
  /** @param {T.Vector3} start @param {T.Vector3} dir @param {number} len @param {number} r @param {number} depth */
  const grow = (start, dir, len, r, depth) => {
    const end = start.clone().addScaledVector(dir, len);
    parts.push(clean(limb(start, end, r, r * 0.72, planar ? 4 : 6)));
    if (depth === 0) {
      if (!planar) {
        const tip = new T.SphereGeometry(r * 0.9, 6, 4);
        tip.translate(end.x, end.y, end.z);
        parts.push(clean(tip));
      }
      return;
    }
    const kids = planar ? 2 : 2 + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const nd = dir.clone();
      if (planar) {
        // stay in the x-y plane: rotate around z
        const a = (k === 0 ? -1 : 1) * (0.3 + rng() * 0.4);
        nd.applyAxisAngle(new T.Vector3(0, 0, 1), a);
      } else {
        const axis = new T.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize();
        nd.applyAxisAngle(axis, 0.35 + rng() * 0.5);
        nd.y = Math.max(nd.y, 0.25);
        nd.normalize();
      }
      grow(end, nd, len * (0.7 + rng() * 0.15), r * 0.72, depth - 1);
    }
  };
  grow(new T.Vector3(0, -0.1, 0), new T.Vector3(0, 1, 0), planar ? 0.5 : 0.6, planar ? 0.06 : 0.14, planar ? 5 : 4);
  return mergeGeometries(parts);
}

/** @param {() => number} rng */
function brain(rng) {
  const g = new T.IcosahedronGeometry(0.8, 4);
  const p = g.attributes.position;
  const seed = rng() * 100;
  const v = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    // ridged noise: 1 - |noise| makes sharp ridges (the "folds")
    const ridge = 1 - Math.abs(noise3(n.x * 3 + seed, n.y * 3, n.z * 3));
    const r = 0.8 * (0.88 + 0.14 * ridge * ridge);
    v.copy(n).multiplyScalar(r);
    v.y = v.y < 0 ? v.y * 0.3 : v.y * 0.75; // flatten into a mound
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return clean(g);
}

/** @param {() => number} rng */
function tubes(rng) {
  const parts = [];
  const n = 5 + Math.floor(rng() * 4);
  for (let k = 0; k < n; k++) {
    const h = 0.6 + rng() * 1.2;
    const r = 0.1 + rng() * 0.08;
    const g = new T.CylinderGeometry(r * 1.2, r, h, 10, 1, true);
    g.translate((rng() - 0.5) * 0.7, h / 2 - 0.05, (rng() - 0.5) * 0.7);
    parts.push(clean(g));
    const lip = new T.TorusGeometry(r * 1.2, 0.03, 4, 10);
    lip.rotateX(Math.PI / 2);
    const pos = g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox);
    lip.translate((pos.min.x + pos.max.x) / 2, pos.max.y, (pos.min.z + pos.max.z) / 2);
    parts.push(clean(lip));
  }
  return mergeGeometries(parts);
}

/** @param {() => number} rng */
function table(rng) {
  const stem = new T.CylinderGeometry(0.12, 0.2, 0.6, 8);
  stem.translate(0, 0.25, 0);
  const plate = new T.CylinderGeometry(0.8 + rng() * 0.3, 0.55, 0.16, 9);
  plate.rotateZ(0.12);
  plate.translate(0, 0.6, 0);
  return mergeGeometries([clean(stem), clean(plate)]);
}

const PALETTE = [0xff6f91, 0xff9671, 0xffc75f, 0xc34a8f, 0x9b5de5, 0xf15bb5, 0x00bbf9, 0xff4d4d, 0xf9f871, 0x5be3c4];

export class CoralGardens extends GrObject {
  /** @param {number} [count=220] */
  constructor(count = 220) {
    const root = new T.Group();
    const rng = makeRng(31337);
    const bump = bumpyTexture(3);

    // templates: [geometry, kind]
    /** @type {Array<{geo: T.BufferGeometry, kind: string, scale: [number, number]}>} */
    const templates = [];
    for (let k = 0; k < 3; k++) templates.push({ geo: branching(rng), kind: "branching", scale: [0.8, 1.6] });
    for (let k = 0; k < 2; k++) templates.push({ geo: branching(rng, true), kind: "fan", scale: [1.2, 2.2] });
    for (let k = 0; k < 2; k++) templates.push({ geo: brain(rng), kind: "brain", scale: [0.6, 1.4] });
    for (let k = 0; k < 2; k++) templates.push({ geo: tubes(rng), kind: "tube", scale: [0.8, 1.4] });
    templates.push({ geo: table(rng), kind: "table", scale: [0.45, 0.9] });

    // pick spots: dense gardens plus scattered singles
    const centers = [[18, 14], [-19, -12], [-10, 25], [23, -3], [-27, 6], [9, -22], [32, 12], [-6, -26], [-34, 24]];
    /** @type {Array<[number, number]>} */
    const spots = [];
    let tries = 0;
    while (spots.length < count && tries < count * 40) {
      tries++;
      let x, z;
      if (rng() < 0.75) {
        const c = centers[Math.floor(rng() * centers.length)];
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * 7;
        x = c[0] + Math.cos(a) * d;
        z = c[1] + Math.sin(a) * d;
      } else {
        x = (rng() - 0.5) * 110;
        z = (rng() - 0.5) * 80;
      }
      if (!isFree(x, z, 0.5)) continue;
      if (floorHeight(x, z) < -6) continue; // not down in the trench
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 1.3)) continue;
      spots.push([x, z]);
    }

    // hand out spots to templates
    /** @type {Array<Array<[number, number]>>} */
    const perTemplate = templates.map(() => []);
    spots.forEach(s => perTemplate[Math.floor(rng() * templates.length)].push(s));

    const m = new T.Matrix4();
    const q = new T.Quaternion();
    const color = new T.Color();
    /** @type {Array<{mesh: T.InstancedMesh, base: Array<{p: T.Vector3, q: T.Quaternion, s: T.Vector3, phase: number}>}>} */
    const fans = [];
    templates.forEach((t, ti) => {
      const list = perTemplate[ti];
      if (list.length === 0) return;
      // polyp cups (canvas texture) tinted by each coral's instance color, and the
      // pitted grain of a CC0 sponge normal map (ambientCG Sponge001)
      const rep = t.kind === "brain" ? 2 : 4;
      const pores = texturePack("Sponge001", rep, rep);
      const polyps = polypTexture().clone();
      polyps.repeat.set(rep * 0.75, rep * 0.75);
      const mat = new T.MeshStandardMaterial({
        color: 0xffffff, map: polyps, normalMap: pores.normalMap, normalScale: new T.Vector2(2.2, 2.2),
        roughness: 0.85, bumpMap: bump, bumpScale: 1.5, side: t.kind === "fan" || t.kind === "tube" ? T.DoubleSide : T.FrontSide,
      });
      const mesh = new T.InstancedMesh(t.geo, mat, list.length);
      const base = [];
      list.forEach(([x, z], i) => {
        const s = t.scale[0] + rng() * (t.scale[1] - t.scale[0]);
        q.setFromEuler(new T.Euler((rng() - 0.5) * 0.15, rng() * Math.PI * 2, (rng() - 0.5) * 0.15));
        const p = new T.Vector3(x, floorHeight(x, z) - 0.05, z);
        const sc = new T.Vector3(s, s * (0.85 + rng() * 0.3), s);
        m.compose(p, q, sc);
        mesh.setMatrixAt(i, m);
        color.set(PALETTE[Math.floor(rng() * PALETTE.length)]);
        mesh.setColorAt(i, color);
        base.push({ p, q: q.clone(), s: sc, phase: rng() * 10 });
      });
      mesh.computeBoundingSphere();
      root.add(mesh);
      if (t.kind === "fan") fans.push({ mesh, base });
    });

    super("Coral Gardens", root);
    this.fans = fans;
    this.time = 0;
    this._m = new T.Matrix4();
    this._q = new T.Quaternion();
    this._e = new T.Euler();
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    this.time += Math.min(delta, 100) / 1000;
    // sea fans sway in the current
    for (const f of this.fans) {
      f.base.forEach((b, i) => {
        const sway = 0.12 * Math.sin(this.time * 0.9 + b.phase) + reef.current[0] * 0.08;
        this._q.setFromEuler(this._e.set(sway, 0, 0.6 * sway)).premultiply(b.q);
        this._m.compose(b.p, this._q, b.s);
        f.mesh.setMatrixAt(i, this._m);
      });
      f.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  lookFromLookAt() {
    return [24, 8, 26, 18, 0, 14];
  }
}
