// @ts-check
/**
 * Crabs - articulated characters (Workbook 2's "articulated character with
 * multiple chains", in 3D).
 *
 * Each crab: a body, two eyes on stalks, 8 legs (each leg is a 2-joint chain:
 * upper and lower segment) and 2 claws (arm -> forearm -> pincer jaw).
 *
 * Behavior: a state machine
 *    walk  - scuttle SIDEWAYS (crabs walk sideways!) with an alternating gait:
 *            neighboring legs move in opposite phase
 *    pause - stand still, eyes look around
 *    wave  - raise one claw and snap it open and shut
 *    turn  - turn in place to a new direction (back toward the middle of the
 *            crab flats if it has wandered too far)
 * The crab stays on the sand (height from floorHeight) and tilts with the slope.
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { makeRng } from "./util/noise.js";
import { CRAB_FLATS } from "./layout.js";

export class Crab extends GrObject {
  /** @param {number} x @param {number} z @param {number} seed @param {string} name */
  constructor(x, z, seed, name) {
    const rng = makeRng(seed);
    const shellColor = [0xd9462c, 0xe8742c, 0xc23b5a, 0xd96b2c][seed % 4];
    const shell = new T.MeshStandardMaterial({ color: shellColor, roughness: 0.5 });
    const legMat = new T.MeshStandardMaterial({ color: new T.Color(shellColor).offsetHSL(0, 0, -0.08), roughness: 0.6 });
    const dark = new T.MeshStandardMaterial({ color: 0x111111 });

    const root = new T.Group();
    const body = new T.Group();
    body.position.y = 0.32;
    root.add(body);
    const carapace = new T.Mesh(new T.SphereGeometry(0.42, 18, 10), shell);
    carapace.scale.set(1.25, 0.5, 0.9);
    body.add(carapace);

    // eyes on stalks
    /** @type {T.Group[]} */
    const eyes = [];
    for (const s of [-1, 1]) {
      const eye = new T.Group();
      eye.position.set(s * 0.14, 0.12, 0.3);
      const stalk = new T.Mesh(new T.CylinderGeometry(0.025, 0.03, 0.2, 6), legMat);
      stalk.position.y = 0.1;
      eye.add(stalk);
      const ball = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), dark);
      ball.position.y = 0.21;
      eye.add(ball);
      body.add(eye);
      eyes.push(eye);
    }

    // legs: 4 per side, each upper -> lower
    /** @type {Array<{upper: T.Group, lower: T.Group, side: number, k: number}>} */
    const legs = [];
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const upper = new T.Group();
        upper.position.set(s * 0.42, 0, 0.18 - k * 0.14);
        upper.rotation.y = s * (0.25 - k * 0.18);
        body.add(upper);
        const up = new T.Mesh(new T.CylinderGeometry(0.03, 0.035, 0.36, 6), legMat);
        up.rotation.z = Math.PI / 2;
        up.position.x = s * 0.18;
        upper.add(up);
        const lower = new T.Group();
        lower.position.x = s * 0.36;
        upper.add(lower);
        const lo = new T.Mesh(new T.ConeGeometry(0.03, 0.4, 6), legMat);
        lo.position.y = -0.2;
        lo.rotation.z = Math.PI;
        lower.add(lo);
        legs.push({ upper, lower, side: s, k });
      }
    }

    // claws: arm -> forearm -> pincer (fixed finger + moving jaw)
    /** @type {Array<{arm: T.Group, fore: T.Group, jaw: T.Group, side: number}>} */
    const claws = [];
    for (const s of [-1, 1]) {
      const arm = new T.Group();
      arm.position.set(s * 0.3, 0, 0.32);
      body.add(arm);
      const a = new T.Mesh(new T.CylinderGeometry(0.045, 0.05, 0.3, 6), legMat);
      a.rotation.x = Math.PI / 2;
      a.position.z = 0.15;
      arm.add(a);
      const fore = new T.Group();
      fore.position.z = 0.3;
      arm.add(fore);
      const palm = new T.Mesh(new T.SphereGeometry(0.13, 10, 8), shell);
      palm.scale.set(0.8, 0.7, 1.2);
      palm.position.z = 0.12;
      fore.add(palm);
      const finger = new T.Mesh(new T.ConeGeometry(0.05, 0.22, 6), shell);
      finger.rotation.x = Math.PI / 2;
      finger.position.set(-s * 0.03, -0.03, 0.34);
      fore.add(finger);
      const jaw = new T.Group();
      jaw.position.set(0, 0.04, 0.24);
      fore.add(jaw);
      const j = new T.Mesh(new T.ConeGeometry(0.045, 0.2, 6), shell);
      j.rotation.x = Math.PI / 2;
      j.position.z = 0.1;
      jaw.add(j);
      claws.push({ arm, fore, jaw, side: s });
    }

    root.position.set(x, floorHeight(x, z), z);
    root.rotation.y = rng() * Math.PI * 2;
    super(name, root);
    this.root = root;
    this.body = body;
    this.legs = legs;
    this.claws = claws;
    this.eyes = eyes;
    this.rng = rng;
    /** @type {"walk"|"pause"|"wave"|"turn"} */
    this.state = "walk";
    this.timer = 0;
    this.duration = 3;
    this.walkDir = 1; // +1 = walk toward local +x, -1 = toward -x
    this.returning = false;
    this.gait = 0;
    this.turnTo = 0;
    this.waveSide = 0;
  }

  /** pick the next state */
  next() {
    const r = this.rng();
    const p = this.root.position;
    const far = Math.hypot(p.x - CRAB_FLATS[0], p.z - CRAB_FLATS[1]) > CRAB_FLATS[2];
    if (this.returning) {
      // just turned to face home: now walk back toward the middle
      this.returning = false;
      this.state = "walk";
      this.walkDir = 1;
      this.duration = 3 + this.rng() * 2;
    } else if (far) {
      this.returning = true;
      // face so that walking sideways (+x) heads back to the middle
      const toCenter = Math.atan2(CRAB_FLATS[0] - p.x, CRAB_FLATS[1] - p.z);
      this.turnTo = toCenter - Math.PI / 2;
      this.state = "turn";
      this.walkDir = 1;
      this.duration = 1.5;
    } else if (r < 0.45) {
      this.state = "walk";
      this.walkDir = this.rng() < 0.5 ? 1 : -1;
      this.duration = 2 + this.rng() * 3;
    } else if (r < 0.65) {
      this.state = "pause";
      this.duration = 1 + this.rng() * 2;
    } else if (r < 0.85) {
      this.state = "wave";
      this.waveSide = this.rng() < 0.5 ? 0 : 1;
      this.duration = 2.4;
    } else {
      this.state = "turn";
      this.turnTo = this.root.rotation.y + (this.rng() - 0.5) * 2.5;
      this.duration = 1.2;
    }
    this.timer = 0;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.timer += dt;
    if (this.timer > this.duration) this.next();

    let moving = 0;
    if (this.state === "walk") {
      moving = 1;
      const speed = 0.9;
      // local +x in world coordinates
      const a = this.root.rotation.y;
      this.root.position.x += Math.cos(a) * speed * this.walkDir * dt;
      this.root.position.z += -Math.sin(a) * speed * this.walkDir * dt;
    } else if (this.state === "turn") {
      moving = 0.6;
      let d = this.turnTo - this.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.root.rotation.y += Math.sign(d) * Math.min(Math.abs(d), dt * 1.8);
    }
    this.gait += dt * 12 * moving;

    // legs: alternating gait (neighbors in opposite phase), knees bent down
    for (const l of this.legs) {
      const ph = this.gait + (l.k % 2 === 0 ? 0 : Math.PI) + (l.side > 0 ? Math.PI / 2 : 0);
      l.upper.rotation.z = l.side * (0.35 + 0.25 * Math.max(0, Math.sin(ph)) * moving);
      l.upper.rotation.y = l.side * (0.25 - l.k * 0.18) + 0.25 * Math.cos(ph) * moving;
      l.lower.rotation.z = -l.side * (0.4 + 0.15 * Math.sin(ph) * moving);
    }

    // claws: resting pose, or waving + snapping
    this.claws.forEach((c, i) => {
      const waving = this.state === "wave" && i === this.waveSide;
      const lift = waving ? Math.sin(Math.min(1, this.timer / 0.4) * Math.PI / 2) * (this.timer > 2 ? Math.max(0, 1 - (this.timer - 2) * 3) : 1) : 0;
      c.arm.rotation.x = -0.2 - 1.0 * lift;
      c.arm.rotation.y = c.side * (0.5 - 0.3 * lift);
      c.fore.rotation.y = -c.side * (0.9 - 0.4 * lift);
      c.jaw.rotation.x = waving ? -0.25 - 0.25 * Math.sin(this.timer * 18) : -0.1;
    });
    // eyes look around while paused
    this.eyes.forEach((e, i) => (e.rotation.y = this.state === "pause" ? 0.6 * Math.sin(this.timer * 2 + i) : 0));

    // stay on the sand, tilted with the slope
    const p = this.root.position;
    p.y = floorHeight(p.x, p.z);
    this.body.position.y = 0.32 + 0.02 * Math.abs(Math.sin(this.gait));
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 2.2, p.y + 1.6, p.z + 2.2, p.x, p.y + 0.3, p.z];
  }
}
