// @ts-check
/**
 * The submarine "Pearl".
 *
 * Model: a hierarchy (Workbook 2/5). The hull is a surface of revolution
 * (LatheGeometry, like the turned profile objects from the WB4 museum), with a
 * sail, a periscope that scans, portholes, a nose viewport, cross-shaped tail
 * fins with a moving rudder and dive planes, and a shrouded propeller.
 *
 * Motion: it follows a closed cardinal spline (Workbook 3) using an arc-length
 * table, so its speed is in real units per second no matter how the control
 * points are spaced. It faces along the curve tangent, banks into turns
 * (roll from the curvature), and the rudder/dive planes follow the turn/climb.
 *
 * Behavior: a state machine
 *     cruise -> approach (brake smoothly to the dock) -> docked (wait while the
 *     gangway connects) -> depart (accelerate) -> cruise ...
 *
 * Rideable: the camera sits in the nose viewport looking forward (+Z).
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { ClosedCardinalSpline } from "./util/curves.js";
import { reef } from "./reefState.js";

const R = 0.8; // hull radius
const LEN = 5.2; // hull length

/** hull radius as a function of u (0 = tail, 1 = nose) */
function hullRadius(u) {
  if (u < 0.3) return R * (0.28 + 0.72 * Math.sin((u / 0.3) * (Math.PI / 2)));
  if (u > 0.78) return R * Math.sqrt(Math.max(0, 1 - ((u - 0.78) / 0.22) ** 2));
  return R;
}

/**
 * @param {T.Material} m @param {T.BufferGeometry} g @param {T.Object3D} parent
 * @param {number} [x] @param {number} [y] @param {number} [z]
 */
function part(g, m, parent, x = 0, y = 0, z = 0) {
  const mesh = new T.Mesh(g, m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** signed angle between two horizontal directions */
function signedTurn(ax, az, bx, bz) {
  return Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
}

export class Submarine extends GrObject {
  /**
   * @param {Object} params
   * @param {Array<[number, number, number]>} params.route - control points
   * @param {number} params.dockIndex - control point where the dock is
   * @param {string} [params.name]
   * @param {number} [params.color]
   */
  constructor(params) {
    const root = new T.Group(); // placed on the path every frame
    const body = new T.Group(); // banking (roll) and bobbing happen here
    root.add(body);

    const paint = new T.MeshStandardMaterial({ color: params.color ?? 0xf2b630, metalness: 0.35, roughness: 0.42 });
    const trim = new T.MeshStandardMaterial({ color: 0x2b3440, metalness: 0.6, roughness: 0.35 });
    const stripeMat = new T.MeshStandardMaterial({ color: 0xc8402f, metalness: 0.3, roughness: 0.5 });
    const glass = new T.MeshStandardMaterial({
      color: 0x9fe8ff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.55,
      emissive: 0x2a9fc0, emissiveIntensity: 0.4,
    });
    const portLight = new T.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc860, emissiveIntensity: 1.2 });

    // --- hull: surface of revolution around Y, then turned to lie along Z
    const profile = [];
    const SEG = 28;
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      profile.push(new T.Vector2(Math.max(0.001, hullRadius(u)), -LEN / 2 + u * LEN));
    }
    const hullGeom = new T.LatheGeometry(profile, 36);
    hullGeom.rotateX(Math.PI / 2); // +Y (nose) -> +Z
    part(hullGeom, paint, body);

    // painted stripe band around the middle
    const stripe = part(new T.CylinderGeometry(R * 1.012, R * 1.012, 0.28, 36, 1, true), stripeMat, body, 0, 0, -0.9);
    stripe.rotation.x = Math.PI / 2;

    // nose viewport (glass bubble)
    part(new T.SphereGeometry(0.46, 24, 16), glass, body, 0, 0.08, LEN / 2 - 0.42);

    // portholes, 3 per side
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 3; k++) {
        const z = 0.9 - k * 0.75;
        const ring = part(new T.TorusGeometry(0.15, 0.04, 8, 18), trim, body, side * R * 0.98, 0.08, z);
        ring.rotation.y = Math.PI / 2;
        const pane = part(new T.CircleGeometry(0.13, 16), portLight, body, side * R * 0.985, 0.08, z);
        pane.rotation.y = (side * Math.PI) / 2;
      }
    }

    // sail (conning tower) - a flattened cylinder with a cap
    const sail = new T.Group();
    sail.position.set(0, R * 0.85, 0.45);
    body.add(sail);
    const sailBody = part(new T.CylinderGeometry(0.42, 0.5, 0.75, 24), paint, sail, 0, 0.3, 0);
    sailBody.scale.set(0.62, 1, 1.35);
    const sailCap = part(new T.SphereGeometry(0.42, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), paint, sail, 0, 0.67, 0);
    sailCap.scale.set(0.62, 0.35, 1.35);
    // sail fins
    for (let side = -1; side <= 1; side += 2) {
      part(new T.BoxGeometry(0.5, 0.04, 0.28), trim, sail, side * 0.4, 0.35, 0.1);
    }
    // periscope: a mast and a head that rotates (scans) around the mast
    const periscope = new T.Group();
    periscope.position.set(0, 0.75, 0.15);
    sail.add(periscope);
    part(new T.CylinderGeometry(0.04, 0.04, 0.55, 10), trim, periscope, 0, 0.27, 0);
    const head = part(new T.BoxGeometry(0.1, 0.1, 0.2), trim, periscope, 0, 0.56, 0.05);
    part(new T.CircleGeometry(0.035, 10), glass, head, 0, 0, 0.101);

    // tail: cross fins. The rudder (vertical) and dive planes (horizontal) can turn.
    const tail = new T.Group();
    tail.position.set(0, 0, -LEN / 2 + 0.55);
    body.add(tail);
    const rudder = new T.Group();
    tail.add(rudder);
    part(new T.BoxGeometry(0.05, 0.7, 0.5), paint, rudder, 0, 0.55, -0.1);
    part(new T.BoxGeometry(0.05, 0.6, 0.45), paint, rudder, 0, -0.5, -0.1);
    const planes = new T.Group();
    tail.add(planes);
    part(new T.BoxGeometry(1.6, 0.05, 0.42), paint, planes, 0, 0, -0.1);

    // propeller in a shroud ring
    const propGroup = new T.Group();
    propGroup.position.set(0, 0, -LEN / 2 - 0.12);
    body.add(propGroup);
    part(new T.TorusGeometry(0.5, 0.05, 8, 32), trim, propGroup);
    const prop = new T.Group();
    propGroup.add(prop);
    const hub = part(new T.ConeGeometry(0.12, 0.3, 14), trim, prop, 0, 0, -0.1);
    hub.rotation.x = -Math.PI / 2;
    for (let b = 0; b < 4; b++) {
      const blade = part(new T.BoxGeometry(0.1, 0.42, 0.03), stripeMat, prop);
      blade.rotation.z = (b * Math.PI) / 2;
      blade.translateY(0.24);
      blade.rotateY(0.5); // blade pitch
    }

    // headlight: a spotlight in the nose aimed at a target ahead of the sub
    const headlight = new T.SpotLight(0xfff0d0, 60, 40, 0.42, 0.5, 1.4);
    headlight.position.set(0, -0.15, LEN / 2 - 0.1);
    const lightTarget = new T.Object3D();
    lightTarget.position.set(0, -2.5, LEN / 2 + 10);
    body.add(headlight, lightTarget);
    headlight.target = lightTarget;
    part(new T.CircleGeometry(0.12, 16), portLight, body, 0, -0.15, LEN / 2 - 0.02);

    // where the rider sits: in the viewport, looking forward along +Z
    const seat = new T.Object3D();
    seat.position.set(0, 0.15, LEN / 2 - 0.2);
    body.add(seat);

    super(params.name ?? "Submarine Pearl", root);

    this.root = root;
    this.body = body;
    this.prop = prop;
    this.rudder = rudder;
    this.planes = planes;
    this.periscope = periscope;
    this.headlight = headlight;
    this.rideable = seat;

    // --- route and state machine
    this.route = new ClosedCardinalSpline(params.route);
    this.dockDist = this.route.distanceAtParam(params.dockIndex);
    this.cruiseSpeed = 3.2; // units per second
    this.brakeDistance = 14;
    this.dockWait = 7; // seconds at the dock
    this.accel = 0.9;
    /** @type {"cruise"|"approach"|"docked"|"depart"} */
    this.state = "cruise";
    this.dist = this.dockDist + 40; // start part way around the loop
    this.speed = this.cruiseSpeed;
    this.timer = 0;
    this.roll = 0;
    this.time = 0;
    this.placeOnRoute(0);
  }

  /** distance left until the dock, going forward around the loop */
  remainingToDock() {
    const L = this.route.length;
    return (((this.dockDist - this.dist) % L) + L) % L;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;

    switch (this.state) {
      case "cruise":
        this.speed += (this.cruiseSpeed - this.speed) * Math.min(1, dt);
        if (this.remainingToDock() < this.brakeDistance) this.state = "approach";
        break;
      case "approach": {
        // brake so that speed goes to zero exactly at the dock: v ~ sqrt(remaining)
        const rem = this.remainingToDock();
        const target = this.cruiseSpeed * Math.sqrt(rem / this.brakeDistance);
        this.speed = Math.min(this.speed, Math.max(0.12, target));
        if (rem <= this.speed * dt + 0.005 || rem > this.brakeDistance * 1.5) {
          this.dist = this.dockDist;
          this.speed = 0;
          this.state = "docked";
          this.timer = 0;
        }
        break;
      }
      case "docked":
        this.timer += dt;
        if (this.timer > this.dockWait) this.state = "depart";
        break;
      case "depart":
        // wait a moment for the gangway to retract, then accelerate
        this.timer += dt;
        if (this.timer > this.dockWait + 1.2) {
          this.speed = Math.min(this.cruiseSpeed, this.speed + this.accel * dt);
          if (this.speed >= this.cruiseSpeed) this.state = "cruise";
        }
        break;
    }
    if (this.state !== "docked") this.dist += this.speed * dt;
    this.dist %= this.route.length;

    this.placeOnRoute(dt);

    // propeller speed follows the sub's speed; periscope scans back and forth
    this.prop.rotation.z += dt * (2 + this.speed * 6);
    this.periscope.rotation.y = 1.2 * Math.sin(this.time * 0.4);
    // headlight is brighter at night
    this.headlight.intensity = 25 + 70 * reef.night;
  }

  /** put the sub on the route at this.dist, facing the tangent, banked into turns */
  placeOnRoute(dt) {
    const { pos, tan } = this.route.atDistance(this.dist);
    this.root.position.set(pos[0], pos[1], pos[2]);
    // Object3D.lookAt points the local +Z axis at the target
    this.root.lookAt(pos[0] + tan[0], pos[1] + tan[1], pos[2] + tan[2]);

    // curvature: how much the heading turns over the next 2 units of path
    const ahead = this.route.atDistance(this.dist + 2).tan;
    const turn = signedTurn(tan[0], tan[2], ahead[0], ahead[2]) / 2; // radians per unit
    const targetRoll = Math.max(-0.45, Math.min(0.45, -turn * this.speed * 2.2));
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 2);
    this.body.rotation.z = this.roll;
    this.rudder.rotation.y = Math.max(-0.5, Math.min(0.5, -turn * 12));
    this.planes.rotation.x = Math.max(-0.4, Math.min(0.4, -(ahead[1] - tan[1]) * 8 - tan[1] * 2));

    // gentle bob while sitting at the dock
    this.body.position.y = this.state === "docked" ? 0.06 * Math.sin(this.time * 1.6) : 0;
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 7, p.y + 3, p.z + 7, p.x, p.y, p.z];
  }
}
