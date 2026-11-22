// @ts-check
/**
 * The kelp forest - animated with LINEAR BLEND SKINNING (Workbook 7, page 3).
 *
 * Why skinning? A kelp stalk is long and flexible and bends smoothly along its
 * whole length. A chain of bones (like a spine) with each vertex blended
 * between the two nearest bones gives exactly that, and the mesh is sent to
 * the GPU once - each frame we only change a few bone rotations.
 *
 * Steps (as on the workbook page):
 *  1. Mesh: a thin stalk (cylinder with many height segments) plus leaf blades
 *     along it, merged into one geometry of height 1
 *  2. Bones: a chain of BONES bones, evenly spaced up the stalk (each a child of
 *     the one below), and a Skeleton from them
 *  3. Skin data: for a vertex at height h, find the bone segment it is in;
 *     skinIndex = (lower bone, upper bone), skinWeight = (1 - f, f) where f is
 *     how far between them it is. Weights always add up to 1.
 *  4. Bind: SkinnedMesh + add the root bone + bind(skeleton)
 *  5. Animate: rotate each bone a little, driven by 3D noise of
 *     (stalk position, bone number, time) plus the water current, so the sway
 *     travels up the stalk and neighboring stalks move similarly but not in sync.
 *
 * All stalks share one geometry; each has its own skeleton.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { isFree } from "./placement.js";
import { reef } from "./reefState.js";
import { makeRng, noise3 } from "./util/noise.js";
import { KELP } from "./layout.js";

const BONES = 7;

function kelpGeometry() {
  const parts = [];
  const stalk = new T.CylinderGeometry(0.035, 0.06, 1, 6, 30);
  stalk.translate(0, 0.5, 0);
  parts.push(stalk.toNonIndexed());
  // leaf blades alternating sides, angled up
  const rng = makeRng(5);
  for (let k = 0; k < 9; k++) {
    const h = 0.12 + k * 0.095;
    const blade = new T.PlaneGeometry(0.09, 0.22, 1, 4);
    blade.translate(0, 0.11, 0);
    blade.rotateZ((k % 2 ? 1 : -1) * 0.75);
    blade.rotateY(k * 2.1 + rng());
    blade.translate(0, h, 0);
    parts.push(blade.toNonIndexed());
  }
  // gas bladders at the top
  const bulb = new T.SphereGeometry(0.03, 6, 4);
  bulb.translate(0, 0.98, 0);
  parts.push(bulb.toNonIndexed());
  for (const p of parts) for (const n of Object.keys(p.attributes)) if (!["position", "normal", "uv"].includes(n)) p.deleteAttribute(n);
  const geo = mergeGeometries(parts);

  // step 3: skin indices and weights from the height of each vertex
  const pos = geo.attributes.position;
  const skinIndex = [];
  const skinWeight = [];
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const y = Math.min(0.9999, Math.max(0, pos.getY(i)));
    const s = y * (BONES - 1); // which bone segment
    const b0 = Math.floor(s);
    const f = s - b0;
    skinIndex.push(b0, Math.min(BONES - 1, b0 + 1), 0, 0);
    skinWeight.push(1 - f, f, 0, 0);
    // color: dark brown at the base to golden green at the top
    colors.push(0.28 + 0.22 * y, 0.32 + 0.3 * y, 0.12 + 0.05 * y);
  }
  geo.setAttribute("skinIndex", new T.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute("skinWeight", new T.Float32BufferAttribute(skinWeight, 4));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  return geo;
}

export class KelpForest extends GrObject {
  /** @param {number} [count=46] */
  constructor(count = 46) {
    const root = new T.Group();
    const geo = kelpGeometry();
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: T.DoubleSide });
    const rng = makeRng(808);
    /** @type {Array<{bones: T.Bone[], x: number, z: number, phase: number}>} */
    const stalks = [];

    let tries = 0;
    while (stalks.length < count && tries < 3000) {
      tries++;
      // most in the forest, a few scattered along the ridges
      let x, z;
      if (stalks.length < count * 0.8) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * KELP[2];
        x = KELP[0] + Math.cos(a) * d;
        z = KELP[1] + Math.sin(a) * d;
      } else {
        x = (rng() < 0.5 ? -1 : 1) * (40 + rng() * 15);
        z = (rng() - 0.5) * 70;
      }
      if (!isFree(x, z, 0.3)) continue;
      if (stalks.some(s => Math.hypot(s.x - x, s.z - z) < 1.0)) continue;

      // step 2: the bone chain
      const bones = [];
      for (let b = 0; b < BONES; b++) {
        const bone = new T.Bone();
        bone.position.y = b === 0 ? 0 : 1 / (BONES - 1);
        if (b > 0) bones[b - 1].add(bone);
        bones.push(bone);
      }
      const skeleton = new T.Skeleton(bones);
      // step 4: bind
      const mesh = new T.SkinnedMesh(geo, mat);
      mesh.add(bones[0]);
      mesh.bind(skeleton);
      const h = 7 + rng() * 8;
      mesh.scale.set(h * 0.42, h, h * 0.42);
      mesh.position.set(x, floorHeight(x, z) - 0.1, z);
      mesh.rotation.y = rng() * Math.PI * 2;
      mesh.frustumCulled = false;
      root.add(mesh);
      stalks.push({ bones, x, z, phase: rng() * 10 });
    }

    super("Kelp Forest", root);
    this.stalks = stalks;
    this.time = 0;
  }

  /**
   * step 5: animate the bones
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    this.time += Math.min(delta, 100) / 1000;
    const t = this.time;
    const [cx, cz] = reef.current;
    for (const s of this.stalks) {
      for (let b = 1; b < s.bones.length; b++) {
        const k = b / (BONES - 1);
        const amp = 0.1 + 0.1 * k;
        s.bones[b].rotation.x = amp * noise3(s.x * 0.08, b * 0.35 - t * 0.5, t * 0.25 + s.phase) + cz * 0.06;
        s.bones[b].rotation.z = amp * noise3(s.z * 0.08 + 40, b * 0.35 - t * 0.5, t * 0.25) - cx * 0.06;
      }
    }
  }

  lookFromLookAt() {
    return [KELP[0] - 14, 9, KELP[1] + 16, KELP[0], 5, KELP[1]];
  }
}
