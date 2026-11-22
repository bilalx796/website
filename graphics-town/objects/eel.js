// @ts-check
/**
 * Moray eel that lives in a rocky den next to the shipwreck.
 *
 * Body: a tube (a generalized cylinder along a straight path) that tapers
 * toward the tail - we scale each ring of vertices by a taper function - with
 * a head, jaw and glowing eyes. It is SKINNED with a chain of bones along its
 * length, so it can wriggle smoothly: each bone turns side to side with a
 * phase lag (a wave travelling down the body).
 *
 * Behavior (state machine):
 *    hiding  - tucked into the den, only the head poking out, mouth breathing
 *    out     - slides out of the den
 *    look    - sways, looks left and right, snaps its jaw
 *    back    - slides back in
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { addSkinWeights } from "./util/skin.js";
import { reef } from "./reefState.js";

const LEN = 4.2;
const NB = 8; // bones

export class MorayEel extends GrObject {
  /** @param {number} x @param {number} z @param {number} heading - direction it comes out */
  constructor(x, z, heading) {
    const root = new T.Group();
    root.position.set(x, floorHeight(x, z), z);
    root.rotation.y = heading;

    // the den: a few rocks making a cave mouth facing +z
    const rockMat = new T.MeshStandardMaterial({ color: 0x5c5850, roughness: 1, flatShading: true });
    for (const [rx, ry, rz, s] of [[-1.1, 0.5, -0.6, 1.2], [1.1, 0.5, -0.6, 1.2], [0, 1.3, -0.8, 1.4], [0, 0.4, -2, 1.5]]) {
      const r = new T.Mesh(new T.DodecahedronGeometry(s, 0), rockMat);
      r.position.set(rx, ry, rz);
      r.rotation.set(rx, rz, ry);
      root.add(r);
    }
    const hole = new T.Mesh(new T.CircleGeometry(0.7, 16), new T.MeshBasicMaterial({ color: 0x050a0c }));
    hole.position.set(0, 0.6, 0.15);
    root.add(hole);

    // body: tube along +z (tail at z=0, head at z=LEN), tapered
    const path = new T.LineCurve3(new T.Vector3(0, 0, 0), new T.Vector3(0, 0, LEN));
    const geo = new T.TubeGeometry(path, 40, 0.28, 10, false);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const zz = p.getZ(i);
      const u = zz / LEN;
      const taper = 0.25 + 0.75 * Math.sin(Math.min(1, u * 1.25) * Math.PI / 2) * (u > 0.9 ? 1 - (u - 0.9) * 4 : 1);
      p.setX(i, p.getX(i) * taper);
      p.setY(i, p.getY(i) * taper * 1.25);
    }
    geo.computeVertexNormals();
    addSkinWeights(geo, v => {
      const s = (v.z / LEN) * (NB - 1);
      const b0 = Math.max(0, Math.min(NB - 2, Math.floor(s)));
      const f = Math.min(1, Math.max(0, s - b0));
      return [[b0, 1 - f], [b0 + 1, f]];
    });
    const bones = [];
    for (let b = 0; b < NB; b++) {
      const bone = new T.Bone();
      bone.position.z = b === 0 ? 0 : LEN / (NB - 1);
      if (b > 0) bones[b - 1].add(bone);
      bones.push(bone);
    }
    // the eel's skin: mottled green-brown via vertex-position based color in a canvas texture
    const c = document.createElement("canvas");
    c.width = 64; c.height = 64;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
    g.fillStyle = "#5d6b2a";
    g.fillRect(0, 0, 64, 64);
    for (let k = 0; k < 120; k++) {
      g.fillStyle = k % 2 ? "rgba(40,50,15,0.6)" : "rgba(170,170,90,0.5)";
      g.beginPath();
      g.arc(Math.random() * 64, Math.random() * 64, 1 + Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(6, 1);
    const body = new T.SkinnedMesh(geo, new T.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    body.add(bones[0]);
    body.bind(new T.Skeleton(bones));
    body.frustumCulled = false;

    // head parts on the last bone: jaw and eyes
    const headBone = bones[NB - 1];
    const jawPivot = new T.Group();
    jawPivot.position.set(0, -0.08, -0.15);
    headBone.add(jawPivot);
    const jaw = new T.Mesh(new T.ConeGeometry(0.17, 0.5, 8), new T.MeshStandardMaterial({ color: 0x6f7a36 }));
    jaw.rotation.x = Math.PI / 2;
    jaw.scale.set(1, 0.45, 1);
    jaw.position.z = 0.22;
    jawPivot.add(jaw);
    const eyeMat = new T.MeshStandardMaterial({ color: 0xffee88, emissive: 0xffdd55, emissiveIntensity: 0.6 });
    for (const s of [-1, 1]) {
      const eye = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), eyeMat);
      eye.position.set(s * 0.12, 0.12, -0.1);
      headBone.add(eye);
    }

    // the eel slides along its own axis inside a holder group
    const slider = new T.Group();
    slider.position.y = 0.6;
    slider.add(body);
    root.add(slider);

    super("Moray Eel", root);
    this.root = root;
    this.slider = slider;
    this.bones = bones;
    this.jawPivot = jawPivot;
    this.eyeMat = eyeMat;
    /** @type {"hiding"|"out"|"look"|"back"} */
    this.state = "hiding";
    this.timer = 0;
    this.time = 0;
    this.ext = 0; // 0 = hidden, 1 = fully out
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    this.timer += dt;
    const durations = { hiding: 4, out: 1.6, look: 5, back: 1.8 };
    const order = /** @type {const} */ (["hiding", "out", "look", "back"]);
    if (this.timer > durations[this.state]) {
      this.state = order[(order.indexOf(this.state) + 1) % order.length];
      this.timer = 0;
    }
    const target = this.state === "out" || this.state === "look" ? 1 : 0;
    this.ext += (target - this.ext) * Math.min(1, dt * 2.2);
    // slide: hidden = head just at the mouth of the den
    this.slider.position.z = -LEN + 0.6 + this.ext * 2.8;

    // wriggle: wave down the body, bigger when out and looking
    const amp = 0.05 + 0.18 * this.ext;
    this.bones.forEach((b, k) => {
      b.rotation.y = amp * Math.sin(this.time * 3.2 - k * 0.8) * (k / NB);
      b.rotation.x = 0.04 * Math.sin(this.time * 1.7 - k * 0.5);
    });
    // look around and snap
    const head = this.bones[NB - 1];
    head.rotation.y += this.state === "look" ? 0.5 * Math.sin(this.timer * 1.4) : 0;
    const snap = this.state === "look" && this.timer % 2.5 < 0.3;
    this.jawPivot.rotation.x = snap ? 0.6 : 0.15 + 0.1 * Math.sin(this.time * 2.5); // breathing
    this.eyeMat.emissiveIntensity = 0.4 + 1.6 * reef.night;
  }

  lookFromLookAt() {
    const p = new T.Vector3(0, 1, 4).applyAxisAngle(new T.Vector3(0, 1, 0), this.root.rotation.y).add(this.root.position);
    const q = this.root.position;
    return [p.x + 2, p.y + 1.5, p.z, q.x, q.y + 0.6, q.z];
  }
}
