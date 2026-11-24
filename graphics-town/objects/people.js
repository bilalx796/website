// @ts-check
/**
 * Little people for the hubs (residents, diners, scientists, engineers...).
 * A person stands with their feet at the origin and faces +z.
 *
 * Parts (all jointed, so people can walk and sit):
 *   upper  - torso with a neck (and coat / clipboard), the head (hair, eyes,
 *            optional chef hat) and two arms that swing at the shoulders
 *   legs   - two legs: a thigh hinged at the hip and a shin + shoe hinged at
 *            the knee
 *
 * Every person can STAND or SIT (setSeated):
 *  - standing: legs straight down, the upper body sits on the hips
 *  - seated:   the upper body is lowered ONTO the seat, the thighs swing
 *              forward along it and the shins hang down to the floor
 * Place a seated person at the CENTER of the chair seat, facing away from the
 * backrest, so the torso rests against the back and the knees point forward.
 *
 * walkPose() swings the arms and legs for walking.
 *
 * Speed: each body part is ONE mesh (its pieces merged, colored with vertex
 * colors), all people share ONE material, and geometries are cached and shared
 * between people with the same colors. So a person costs 8 draw calls and no
 * extra materials or shader compiles.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const skinTones = [0xe0b48c, 0xc68c5a, 0x8d5a3b, 0xf1c9a5, 0x6b4430];
const hairColors = [0x2a1d14, 0x5a3a1e, 0x1a1a1a, 0xa8742e, 0x6e2f1a, 0x3b2a20];
const pantsColors = [0x2b3a55, 0x3a3a3a, 0x5a4a3a, 0x24496b];
const SHOE = 0x1c1c1e;
let count = 0;

/** leg sizes: the hip is HIP above the feet when standing */
const THIGH = 0.3;
const SHIN = 0.26;
const HIP = THIGH + SHIN + 0.04;
const SHOULDER_Y = 0.45; // in the upper body's frame (torso bottom at 0)

/** the one material every person uses */
let sharedMat = null;
function personMaterial() {
  if (!sharedMat) sharedMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.02 });
  return sharedMat;
}

/** paint a geometry one color (vertex colors) and keep only what merging needs */
function paint(g, hex) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(ng.attributes)) if (!["position", "normal"].includes(n)) ng.deleteAttribute(n);
  const c = new T.Color(hex);
  const n = ng.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  ng.setAttribute("color", new T.Float32BufferAttribute(arr, 3));
  return ng;
}

/** geometries shared between people with the same colors */
const cache = new Map();
/** @param {string} key @param {() => T.BufferGeometry} make */
function cached(key, make) {
  let g = cache.get(key);
  if (!g) {
    g = make();
    g.computeBoundingSphere();
    cache.set(key, g);
  }
  return g;
}

function torsoGeo(shirt, skin, coat, clipboard) {
  return cached(`torso${shirt}|${skin}|${coat}|${clipboard}`, () => {
    const parts = [];
    // chest: a capsule, a little flatter front to back, wider at the shoulders
    const chest = new T.CapsuleGeometry(0.12, 0.28, 4, 12);
    chest.scale(1, 1, 0.72);
    chest.translate(0, 0.28, 0);
    parts.push(paint(chest, coat ? 0xf4f6f8 : shirt));
    const shoulders = new T.CapsuleGeometry(0.06, 0.2, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.9).translate(0, SHOULDER_Y - 0.02, 0);
    parts.push(paint(shoulders, coat ? 0xf4f6f8 : shirt));
    parts.push(paint(new T.CylinderGeometry(0.04, 0.045, 0.08, 8).translate(0, 0.53, 0), skin)); // neck
    if (coat) parts.push(paint(new T.BoxGeometry(0.07, 0.22, 0.02).translate(0, 0.36, 0.088), shirt)); // shirt under the lab coat
    // belt
    parts.push(paint(new T.CylinderGeometry(0.123, 0.123, 0.035, 12).scale(1, 1, 0.74).translate(0, 0.05, 0), 0x2a2420));
    if (clipboard) {
      const board = new T.BoxGeometry(0.12, 0.16, 0.015).rotateX(-0.5).translate(0.06, 0.3, 0.13);
      parts.push(paint(board, 0x8a6a44));
      parts.push(paint(new T.BoxGeometry(0.1, 0.12, 0.004).rotateX(-0.5).translate(0.06, 0.3, 0.14), 0xf8f8f0));
    }
    return mergeGeometries(parts);
  });
}

/**
 * Facial expressions: [mouth, brows]
 *  mouth: "smile" | "grin" | "flat" | "frown" | "o"
 *  brows: tilt of the eyebrows (+ = worried / surprised up in the middle, - = cross)
 */
const EXPRESSIONS = /** @type {const} */ ([
  ["smile", 0], ["grin", 0.15], ["flat", 0], ["frown", 0.35], ["o", 0.25],
  ["smile", -0.1], ["flat", -0.4], ["grin", 0], ["smile", 0.3],
]);

/** a curved mouth: an arc of a thin torus, curving up (smile) or down (frown) */
function mouthGeo(kind) {
  const lip = 0x7a2e2a;
  const z = 0.084, y = -0.04;
  if (kind === "o") return [paint(new T.TorusGeometry(0.014, 0.005, 6, 12).translate(0, y, z + 0.002), lip)];
  if (kind === "flat") return [paint(new T.BoxGeometry(0.04, 0.007, 0.008).translate(0, y, z), lip)];
  const r = kind === "grin" ? 0.03 : 0.026;
  const arc = kind === "grin" ? 1.6 : 1.2;
  const m = new T.TorusGeometry(r, 0.0045, 5, 10, arc);
  m.rotateZ(-Math.PI / 2 - arc / 2); // centered at the bottom of the circle: a smile
  if (kind === "frown") m.rotateZ(Math.PI);
  m.translate(0, y + (kind === "frown" ? -r + 0.004 : r - 0.004), z - 0.004);
  const out = [paint(m, lip)];
  if (kind === "grin") out.push(paint(new T.BoxGeometry(0.03, 0.008, 0.004).translate(0, y + 0.002, z - 0.002), 0xffffff)); // teeth
  return out;
}

function headGeo(skin, hair, chefHat, expr) {
  return cached(`head${skin}|${hair}|${chefHat}|${expr}`, () => {
    const parts = [];
    const [mouth, brow] = EXPRESSIONS[expr % EXPRESSIONS.length];
    parts.push(paint(new T.SphereGeometry(0.09, 14, 10).scale(0.95, 1.05, 1), skin));
    // hair: the top and back of the head
    const h = new T.SphereGeometry(0.096, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    h.rotateX(-0.35);
    h.translate(0, 0.008, -0.006);
    parts.push(paint(h, hair));
    for (const sx of [-0.032, 0.032]) {
      parts.push(paint(new T.SphereGeometry(0.012, 8, 6).scale(1, 0.85, 0.35).translate(sx, 0.012, 0.081), 0xf4f1ea)); // eye white
      parts.push(paint(new T.SphereGeometry(0.0075, 6, 4).scale(1, 1, 0.5).translate(sx, 0.011, 0.085), 0x1a1410)); // pupil
      // eyebrow, tilted by the expression
      const b = new T.BoxGeometry(0.03, 0.006, 0.006).rotateZ(sx > 0 ? -brow : brow);
      parts.push(paint(b.translate(sx, 0.038 + Math.abs(brow) * 0.008, 0.082), hair));
    }
    parts.push(...mouthGeo(mouth));
    parts.push(paint(new T.SphereGeometry(0.016, 6, 4).scale(0.8, 1, 1).translate(0, -0.012, 0.09), skin)); // nose
    for (const sx of [-0.09, 0.09]) parts.push(paint(new T.SphereGeometry(0.02, 6, 4).scale(0.5, 1, 0.8).translate(sx, 0, 0), skin)); // ears
    if (chefHat) {
      parts.push(paint(new T.CylinderGeometry(0.09, 0.08, 0.13, 12).translate(0, 0.13, 0), 0xffffff));
      parts.push(paint(new T.SphereGeometry(0.1, 10, 6).scale(1, 0.6, 1).translate(0, 0.21, 0), 0xffffff));
    }
    return mergeGeometries(parts);
  });
}

/** an arm hanging down from the shoulder (y = 0 at the shoulder joint) */
function armGeo(shirt, skin, coat) {
  return cached(`arm${shirt}|${skin}|${coat}`, () => mergeGeometries([
    paint(new T.CapsuleGeometry(0.038, 0.16, 3, 8).translate(0, -0.11, 0), coat ? 0xf4f6f8 : shirt), // sleeve
    paint(new T.CapsuleGeometry(0.032, 0.16, 3, 8).translate(0, -0.3, 0), skin), // forearm
    paint(new T.SphereGeometry(0.036, 8, 6).scale(0.8, 1.1, 1).translate(0, -0.42, 0.005), skin), // hand
  ]));
}

/** a thigh hanging down from the hip (y = 0 at the hip) */
function thighGeo(pants) {
  return cached(`thigh${pants}`, () => mergeGeometries([paint(new T.CapsuleGeometry(0.058, THIGH - 0.06, 3, 8).translate(0, -THIGH / 2, 0), pants)]));
}

/** shin and shoe hanging down from the knee (y = 0 at the knee) */
function shinGeo(pants) {
  return cached(`shin${pants}`, () => mergeGeometries([
    paint(new T.CapsuleGeometry(0.048, SHIN - 0.05, 3, 8).translate(0, -SHIN / 2, 0), pants),
    paint(new T.BoxGeometry(0.085, 0.045, 0.17).translate(0, -SHIN - 0.018, 0.035), SHOE),
  ]));
}

/**
 * @param {number} shirt - shirt color
 * @param {{coat?: boolean, chefHat?: boolean, clipboard?: boolean, skin?: number}} [opts]
 */
export function makePerson(shirt, opts = {}) {
  const mat = personMaterial();
  const skin = opts.skin ?? skinTones[count % skinTones.length];
  const hair = hairColors[(count * 7 + 3) % hairColors.length];
  const pants = pantsColors[count % pantsColors.length];
  count++;
  const coat = !!opts.coat;

  const person = new T.Group();

  // upper body: everything that moves down onto the seat when sitting
  const upper = new T.Group();
  upper.name = "upper";
  upper.position.y = HIP - 0.03;
  person.add(upper);
  const body = new T.Mesh(torsoGeo(shirt, skin, coat, !!opts.clipboard), mat);
  body.name = "body";
  upper.add(body);
  // a random expression (deterministic per person, so it's the same every load)
  const expr = Math.floor(((Math.sin(count * 12.9898) * 43758.5453) % 1 + 1) % 1 * EXPRESSIONS.length);
  const head = new T.Mesh(headGeo(skin, hair, !!opts.chefHat, expr), mat);
  head.position.y = 0.6;
  head.name = "head";
  upper.add(head);
  /** @type {Array<T.Mesh>} */
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new T.Mesh(armGeo(shirt, skin, coat), mat);
    arm.position.set(sx * 0.155, SHOULDER_Y, 0);
    arm.rotation.z = sx * 0.06; // hang a little away from the body
    arm.name = sx < 0 ? "armR" : "armL";
    upper.add(arm);
    arms.push(arm);
  }

  // legs: hip joint -> thigh, knee joint -> shin + shoe
  const legs = new T.Group();
  legs.name = "legs";
  person.add(legs);
  /** @type {Array<{hip: T.Mesh, knee: T.Mesh}>} */
  const legParts = [];
  for (const sx of [-0.065, 0.065]) {
    const hip = new T.Mesh(thighGeo(pants), mat);
    hip.position.set(sx, HIP, 0);
    const knee = new T.Mesh(shinGeo(pants), mat);
    knee.position.y = -THIGH;
    hip.add(knee);
    legs.add(hip);
    legParts.push({ hip, knee });
  }
  person.userData.rig = { upper, arms, legs: legParts, seated: false };
  return person;
}

/**
 * Sit on a seat whose top is `seatHeight` above the person's origin (or stand
 * up again with seatHeight = null).
 * @param {T.Object3D} person @param {number|null} seatHeight
 */
export function setSeated(person, seatHeight) {
  const rig = person.userData.rig;
  if (!rig) return;
  if (seatHeight === null) {
    rig.seated = false;
    rig.upper.position.set(0, HIP - 0.03, 0);
    for (const { hip, knee } of rig.legs) {
      hip.position.set(hip.position.x, HIP, 0);
      hip.rotation.x = 0;
      knee.rotation.x = 0;
      knee.scale.y = 1;
    }
    for (const a of rig.arms) a.rotation.x = 0;
    return;
  }
  rig.seated = true;
  // the torso's bottom sits on the seat, a little back
  rig.upper.position.set(0, seatHeight - 0.03, -0.04);
  const hipY = seatHeight + 0.05;
  for (const { hip, knee } of rig.legs) {
    hip.position.set(hip.position.x, hipY, -0.02);
    hip.rotation.x = -Math.PI / 2; // thigh forward along the seat
    knee.rotation.x = Math.PI / 2; // shin straight down
    knee.scale.y = Math.max(0.2, (hipY - 0.04) / (SHIN + 0.04)); // reach the floor
  }
  // hands forward, resting on the lap / table
  for (const a of rig.arms) a.rotation.x = -0.75;
}

/**
 * Walking pose: swing the legs and arms. `phase` advances with the distance
 * walked; `amount` 0 = standing still, 1 = full stride.
 * @param {T.Object3D} person @param {number} phase @param {number} [amount=1]
 */
export function walkPose(person, phase, amount = 1) {
  const rig = person.userData.rig;
  if (!rig || rig.seated) return;
  const s = Math.sin(phase);
  rig.legs.forEach(({ hip, knee }, i) => {
    const side = i === 0 ? 1 : -1;
    const sw = s * side;
    hip.rotation.x = -0.45 * sw * amount;
    // the knee bends while the leg swings forward
    knee.rotation.x = Math.max(0, Math.cos(phase) * side) * 0.7 * amount;
  });
  rig.arms.forEach((a, i) => {
    a.rotation.x = 0.4 * s * (i === 0 ? 1 : -1) * amount;
  });
  rig.upper.position.y = HIP - 0.03 + Math.abs(Math.cos(phase)) * 0.02 * amount;
}

/** how high a standing person's eyes are */
export const EYE_HEIGHT = HIP - 0.03 + 0.6 + 0.012;
