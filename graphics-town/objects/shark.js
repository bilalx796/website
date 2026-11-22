// @ts-check
/**
 * The shark - an articulated body that patrols, and sometimes hunts the school.
 *
 * Model: three body segments in a chain (head/torso -> mid -> tail), each a
 * piece of a surface of revolution (LatheGeometry). Swimming = each segment
 * rotates side to side with a phase lag, so a wave runs down the body to the
 * tail fin (hierarchical modeling, Workbook 2/5).
 *
 * Steering: the shark always steers toward a target with a LIMITED TURN RATE
 * (like turnToward in the Workbook 2 boids) - so it swims in smooth arcs.
 * State machine:
 *    patrol - the target is a "carrot" that moves along a big loop spline
 *    hunt   - every so often, it charges at the center of the fish school
 *             (the fish see it coming and scatter - see fishSchool.js)
 *    return - swims back to the patrol loop, then patrols again
 * Rideable: ride along on the hunt!
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { ClosedCardinalSpline } from "./util/curves.js";
import { floorHeight } from "./terrain.js";
import { reef } from "./reefState.js";

/** radius of the shark body as a function of u (0 = tail tip, 1 = nose) */
function bodyRadius(u) {
  if (u > 0.85) return 0.55 * Math.sqrt(Math.max(0, 1 - ((u - 0.85) / 0.15) ** 2));
  return 0.08 + 0.47 * Math.pow(u / 0.85, 0.9) * (u < 0.5 ? 1 : 1 - 0.15 * (u - 0.5));
}

/** a lathe piece of the body between u0 and u1, along +Z, starting at z = 0 */
function bodyPiece(u0, u1, length) {
  const pts = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    pts.push(new T.Vector2(Math.max(0.001, bodyRadius(u)), ((u - u0) / (u1 - u0)) * length));
  }
  const g = new T.LatheGeometry(pts, 20);
  g.rotateX(Math.PI / 2);
  g.scale(1, 1.1, 1); // a bit taller than wide
  return g;
}

/** a flat fin from a triangle-ish shape, in the x-y plane */
function fin(points, thickness = 0.06) {
  const s = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)));
  return new T.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false });
}

export class Shark extends GrObject {
  /**
   * @param {Object} p
   * @param {Array<[number, number, number]>} p.route
   */
  constructor(p) {
    const skin = new T.MeshStandardMaterial({ color: 0x6f8190, roughness: 0.5, metalness: 0.2 });
    const belly = new T.MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.6 });
    const L = 5.2;

    const root = new T.Group();
    // segment 1: head + torso (from u = 0.5 to 1), pivot at its back end
    const seg1 = new T.Group();
    root.add(seg1);
    seg1.add(new T.Mesh(bodyPiece(0.5, 1.0, L * 0.5), skin));
    const bellyStrip = new T.Mesh(bodyPiece(0.55, 0.97, L * 0.42), belly);
    bellyStrip.scale.set(0.95, 0.85, 1);
    bellyStrip.position.set(0, -0.08, L * 0.025);
    seg1.add(bellyStrip);
    // dorsal fin and pectoral fins on the front segment
    const dorsal = new T.Mesh(fin([[0, 0], [0.9, 0], [0.1, 1.0]]), skin);
    dorsal.rotation.y = Math.PI / 2;
    dorsal.position.set(0.03, 0.45, 1.6);
    seg1.add(dorsal);
    for (const s of [-1, 1]) {
      const pec = new T.Mesh(fin([[0, 0], [0.9, 0.2], [0.2, -0.35]]), skin);
      pec.rotation.set(Math.PI / 2, 0, s > 0 ? -2.5 : -0.64);
      pec.position.set(s * 0.4, -0.25, 1.7);
      seg1.add(pec);
      // eyes and gill slits
      const eye = new T.Mesh(new T.SphereGeometry(0.06, 8, 6), new T.MeshStandardMaterial({ color: 0x050505 }));
      eye.position.set(s * 0.33, 0.12, L * 0.5 - 0.45);
      seg1.add(eye);
      for (let k = 0; k < 4; k++) {
        const gill = new T.Mesh(new T.BoxGeometry(0.02, 0.22, 0.03), new T.MeshStandardMaterial({ color: 0x3f4a52 }));
        gill.position.set(s * 0.46, 0, L * 0.5 - 0.9 - k * 0.1);
        seg1.add(gill);
      }
    }
    seg1.position.z = 0; // the torso starts at the origin and goes forward

    // segment 2: mid body (u 0.25 to 0.5), hangs behind seg1
    const seg2 = new T.Group();
    seg1.add(seg2);
    const mid = new T.Mesh(bodyPiece(0.25, 0.5, L * 0.25), skin);
    mid.position.z = -L * 0.25;
    seg2.add(mid);
    // segment 3: tail (u 0 to 0.25) with the tail fin
    const seg3 = new T.Group();
    seg3.position.z = -L * 0.25;
    seg2.add(seg3);
    const tailBody = new T.Mesh(bodyPiece(0.0, 0.25, L * 0.25), skin);
    tailBody.position.z = -L * 0.25;
    seg3.add(tailBody);
    const caudal = new T.Mesh(fin([[0, 0], [-0.7, 1.1], [-0.35, 0], [-0.55, -0.6]]), skin);
    caudal.rotation.y = -Math.PI / 2;
    caudal.position.set(-0.03, 0, -L * 0.25 + 0.15);
    seg3.add(caudal);
    const secondDorsal = new T.Mesh(fin([[0, 0], [0.35, 0], [0.05, 0.3]]), skin);
    secondDorsal.rotation.y = Math.PI / 2;
    secondDorsal.position.set(0.03, 0.25, -0.5);
    seg2.add(secondDorsal);

    const seat = new T.Object3D();
    seat.position.set(0, 0.8, 1.2);
    seg1.add(seat);

    super("Shark Bruce", root);
    this.root = root;
    this.segs = [seg1, seg2, seg3];
    this.rideable = seat;
    this.route = new ClosedCardinalSpline(p.route);
    this.carrot = 0; // distance of the patrol target along the route
    const start = this.route.atDistance(0);
    this.pos = new T.Vector3(...start.pos);
    this.heading = new T.Vector3(...start.tan);
    this.speed = 3.5;
    /** @type {"patrol"|"hunt"|"return"} */
    this.state = "patrol";
    this.timer = 0;
    this.huntEvery = 22;
    this.time = 0;
    this._t = new T.Vector3();
  }

  /** the shark's head position (the fish use this to flee) */
  getPosition() {
    return this._t.copy(this.heading).multiplyScalar(1.5).add(this.pos);
  }

  /** go hunting now (also used by the Reef panel) */
  hunt() {
    this.state = "hunt";
    this.timer = 0;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    this.timer += dt;
    const school = reef.objects.school;

    /** @type {T.Vector3} */
    let target;
    let wantSpeed = 3.5;
    let maxTurn = 0.7; // radians per second
    if (this.state === "patrol") {
      // keep the carrot a few units ahead of us along the loop
      this.carrot += this.speed * dt;
      target = new T.Vector3(...this.route.atDistance(this.carrot + 7).pos);
      if (this.timer > this.huntEvery && school) this.hunt();
    } else if (this.state === "hunt") {
      const c = school ? school.lookFromLookAt() : [0, 10, 0, 0, 10, 0];
      target = new T.Vector3(c[3], c[4], c[5]);
      wantSpeed = 7.5;
      maxTurn = 1.3;
      if (this.timer > 7 || this.pos.distanceTo(target) < 2.5) {
        this.state = "return";
        this.timer = 0;
      }
    } else {
      // find the closest point on the patrol loop and head for it
      let best = 0, bestD = Infinity;
      for (let d = 0; d < this.route.length; d += 2) {
        const q = this.route.atDistance(d).pos;
        const dd = Math.hypot(q[0] - this.pos.x, q[1] - this.pos.y, q[2] - this.pos.z);
        if (dd < bestD) { bestD = dd; best = d; }
      }
      target = new T.Vector3(...this.route.atDistance(best + 8).pos);
      wantSpeed = 4.5;
      if (bestD < 3) {
        this.state = "patrol";
        this.carrot = best;
        this.timer = 0;
      }
    }
    this.speed += (wantSpeed - this.speed) * Math.min(1, dt * 1.5);

    // steer toward the target with a limited turn rate
    const want = target.clone().sub(this.pos).normalize();
    const angle = this.heading.angleTo(want);
    if (angle > 1e-4) {
      const step = Math.min(1, (maxTurn * dt) / angle);
      this.heading.lerp(want, step).normalize();
    }
    this.heading.y = Math.max(-0.4, Math.min(0.4, this.heading.y));
    this.heading.normalize();
    this.pos.addScaledVector(this.heading, this.speed * dt);
    const fh = floorHeight(this.pos.x, this.pos.z) + 2;
    if (this.pos.y < fh) this.pos.y = fh;

    this.root.position.copy(this.pos);
    this.root.lookAt(this.pos.clone().add(this.heading));

    // swimming wave down the body, faster when hunting
    const freq = 2.2 + this.speed * 0.5;
    const ph = this.time * freq;
    this.segs[1].rotation.y = 0.18 * Math.sin(ph);
    this.segs[2].rotation.y = 0.32 * Math.sin(ph - 1.0);
    this.segs[0].rotation.y = 0.05 * Math.sin(ph + 1.0);
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 8, p.y + 4, p.z + 8, p.x, p.y, p.z];
  }
}
