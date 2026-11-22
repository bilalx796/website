// @ts-check
/**
 * The shark "Bruce" - a SKINNED body that patrols, and sometimes hunts the school.
 *
 * Model:
 *  - the body is ONE surface of revolution (LatheGeometry) with a real shark
 *    profile: a rounded pointed snout, the thickest part about a third of the way
 *    back, tapering to a thin "caudal peduncle" where the tail attaches. It is
 *    slightly flattened side-to-side and underneath.
 *  - countershading with vertex colors: blue-grey on top, a white belly, blended
 *    along the sides (like real sharks)
 *  - fins are Shapes with curved edges, extruded with a small bevel so the edges
 *    are rounded: a swept-back first dorsal fin, wing-like pectoral fins, small
 *    pelvic / second dorsal / anal fins, and a heterocercal tail (the upper lobe
 *    is bigger than the lower one)
 *  - eyes, five gill slits and the underslung mouth
 *
 * Animation: linear blend SKINNING with a chain of 6 bones from head to tail.
 * Each body vertex blends between the two nearest bones by its position along
 * the body, so the body bends smoothly (no gaps between segments). Swimming is a
 * traveling wave whose amplitude grows toward the tail; the fins ride on the
 * bones they are attached to.
 *
 * Steering: the shark always steers toward a target with a LIMITED TURN RATE
 * (like turnToward in the Workbook 2 boids), so it swims in smooth arcs.
 * State machine:
 *    patrol - the target is a "carrot" that moves along a big loop spline
 *    hunt   - every so often (or when you press the button) it charges the
 *             center of the fish school; the fish scatter (see fishSchool.js)
 *    return - swims back to the patrol loop, then patrols again
 * Rideable: ride along on the hunt!
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { ClosedCardinalSpline } from "./util/curves.js";
import { floorHeight } from "./terrain.js";
import { reef } from "./reefState.js";
import { addSkinWeights } from "./util/skin.js";

const Z_TAIL = -3.3; // where the body ends (the tail fin attaches here)
const Z_NOSE = 2.7;
const R = 0.62; // maximum body radius

/** body radius at position z along the body */
function radiusAt(z) {
  const u = (z - Z_TAIL) / (Z_NOSE - Z_TAIL); // 0 = tail, 1 = nose
  const peak = 0.62;
  if (u >= peak) {
    const t = (u - peak) / (1 - peak);
    return R * Math.pow(Math.max(0, 1 - Math.pow(t, 2.4)), 0.55);
  }
  const t = u / peak;
  return R * (0.11 + 0.89 * Math.pow(Math.sin((t * Math.PI) / 2), 1.5));
}

/** the body: lathe along z, flattened a little, countershaded with vertex colors */
function bodyGeometry() {
  const pts = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const z = Z_TAIL + ((Z_NOSE - Z_TAIL) * i) / n;
    pts.push(new T.Vector2(Math.max(0.002, radiusAt(z)), z));
  }
  const g = new T.LatheGeometry(pts, 28);
  g.rotateX(Math.PI / 2); // the lathe's axis (y) becomes z: nose at +z
  const p = g.attributes.position;
  const colors = [];
  const back = new T.Color(0x56697a);
  const belly = new T.Color(0xeef1f0);
  const c = new T.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.max(0.002, radiusAt(z));
    // slightly narrower side-to-side, flatter underneath
    p.setX(i, x * 0.84);
    p.setY(i, y < 0 ? y * 0.82 : y);
    // countershading: blend from the back color to the belly color along the sides
    const ny = y / r;
    const t = Math.min(1, Math.max(0, (ny + 0.05) / 0.4)); // 0 below the side line, 1 above
    const s = t * t * (3 - 2 * t);
    c.copy(belly).lerp(back, s);
    if (ny > 0.75) c.multiplyScalar(0.88); // a darker ridge along the back
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * a fin: a closed outline (curves) extruded thinly with a small rounded bevel.
 * Outline coordinates: a = along the body (+ forward), b = up (or out).
 * @param {(s: T.Shape) => void} outline
 */
function finGeometry(outline, thickness = 0.04) {
  const s = new T.Shape();
  outline(s);
  const g = new T.ExtrudeGeometry(s, {
    depth: thickness, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 10,
  });
  g.translate(0, 0, -thickness / 2);
  return g;
}

export class Shark extends GrObject {
  /**
   * @param {Object} p
   * @param {Array<[number, number, number]>} p.route
   */
  constructor(p) {
    const skinMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.1 });
    const finMat = new T.MeshStandardMaterial({ color: 0x51647a, roughness: 0.45, metalness: 0.1, side: T.DoubleSide });
    const darkMat = new T.MeshStandardMaterial({ color: 0x2a3640, roughness: 0.6 });
    const eyeMat = new T.MeshStandardMaterial({ color: 0x050607, roughness: 0.1, metalness: 0.5 });

    // --- skeleton: bone 0 is the head (root), each next bone further back
    const BONE_Z = [1.2, 0.3, -0.6, -1.5, -2.4, -3.2];
    const bones = BONE_Z.map(() => new T.Bone());
    bones.forEach((b, k) => {
      b.position.z = k === 0 ? BONE_Z[0] : BONE_Z[k] - BONE_Z[k - 1];
      if (k > 0) bones[k - 1].add(b);
    });

    // --- body: skin weights blend the two nearest bones along z
    const geo = bodyGeometry();
    addSkinWeights(geo, v => {
      if (v.z >= BONE_Z[0]) return [[0, 1]];
      for (let k = 0; k < BONE_Z.length - 1; k++) {
        const z0 = BONE_Z[k], z1 = BONE_Z[k + 1];
        if (v.z <= z0 && v.z >= z1) {
          const f = (z0 - v.z) / (z0 - z1);
          return [[k, 1 - f], [k + 1, f]];
        }
      }
      return [[BONE_Z.length - 1, 1]];
    });
    const body = new T.SkinnedMesh(geo, skinMat);
    body.add(bones[0]);
    body.bind(new T.Skeleton(bones));
    body.frustumCulled = false;

    /**
     * attach a part to the bone nearest its z, giving its position in WORLD-of-shark coordinates
     * @param {T.Object3D} part @param {number} x @param {number} y @param {number} z
     */
    const attach = (part, x, y, z) => {
      let k = 0;
      for (let i = 0; i < BONE_Z.length; i++) if (Math.abs(BONE_Z[i] - z) < Math.abs(BONE_Z[k] - z)) k = i;
      part.position.set(x, y, z - BONE_Z[k]);
      bones[k].add(part);
    };
    // fins whose outline is in the a(forward)/b(up) plane stand vertically along the body
    const vertical = geom => {
      const m = new T.Mesh(geom, finMat);
      m.rotation.y = -Math.PI / 2; // outline a -> +z, b -> +y, thickness -> x
      return m;
    };

    // first dorsal fin: swept back, curved trailing edge
    const dorsal = vertical(finGeometry(s => {
      s.moveTo(0.45, 0);
      s.quadraticCurveTo(0.2, 0.6, -0.45, 1.05); // leading edge up to the swept-back tip
      s.quadraticCurveTo(-0.3, 0.45, -0.55, 0.02); // concave trailing edge
      s.lineTo(0.45, 0);
    }, 0.05));
    attach(dorsal, 0, radiusAt(0.2) * 0.92, 0.2);
    // second dorsal and anal fins (small)
    const small = (h, len) => vertical(finGeometry(s => {
      s.moveTo(len * 0.5, 0);
      s.quadraticCurveTo(len * 0.2, h * 0.6, -len * 0.4, h);
      s.quadraticCurveTo(-len * 0.3, h * 0.4, -len * 0.5, 0);
      s.lineTo(len * 0.5, 0);
    }, 0.03));
    attach(small(0.28, 0.32), 0, radiusAt(-2.0) * 0.95, -2.0);
    const anal = small(0.24, 0.3);
    anal.scale.y = -1; // hangs down (fins are double sided, so mirroring is fine)
    attach(anal, 0, -radiusAt(-2.15) * 0.8, -2.15);

    // tail fin: heterocercal - the upper lobe is longer than the lower one
    const caudal = vertical(finGeometry(s => {
      s.moveTo(0.15, 0.12);
      s.quadraticCurveTo(-0.45, 0.6, -1.05, 1.3); // upper lobe leading edge
      s.quadraticCurveTo(-0.75, 0.55, -0.42, 0.02); // back to the fork
      s.quadraticCurveTo(-0.55, -0.35, -0.68, -0.72); // lower lobe trailing edge
      s.quadraticCurveTo(-0.2, -0.45, 0.15, -0.1); // lower lobe leading edge
      s.lineTo(0.15, 0.12);
    }, 0.04));
    attach(caudal, 0, 0, Z_TAIL + 0.1);

    // pectoral fins: large, wing-like, angled down and back
    for (const side of [-1, 1]) {
      const pec = new T.Mesh(finGeometry(s => {
        s.moveTo(0, 0.36);
        s.quadraticCurveTo(0.7, 0.08, 1.25, -0.62); // leading edge out to the tip
        s.quadraticCurveTo(0.7, -0.5, 0.05, -0.2); // curved trailing edge
        s.lineTo(0, 0.36);
      }, 0.04), finMat);
      // outline: x = span (outward), y = chord (+ forward). Lay it flat: y -> +z
      pec.rotation.x = Math.PI / 2;
      const holder = new T.Group();
      holder.scale.x = side;
      holder.rotation.z = side * -0.22; // slight droop
      holder.add(pec);
      attach(holder, side * radiusAt(1.0) * 0.72, -radiusAt(1.0) * 0.45, 1.0);
      // pelvic fins (small, further back)
      const pel = new T.Mesh(finGeometry(s => {
        s.moveTo(0, 0.12);
        s.quadraticCurveTo(0.25, 0, 0.38, -0.22);
        s.quadraticCurveTo(0.2, -0.2, 0, -0.08);
        s.lineTo(0, 0.12);
      }, 0.03), finMat);
      pel.rotation.x = Math.PI / 2;
      const pelHolder = new T.Group();
      pelHolder.scale.x = side;
      pelHolder.rotation.z = side * -0.6;
      pelHolder.add(pel);
      attach(pelHolder, side * radiusAt(-1.3) * 0.5, -radiusAt(-1.3) * 0.7, -1.3);
    }

    // eyes, gill slits and mouth (on the head bone)
    for (const side of [-1, 1]) {
      const eye = new T.Mesh(new T.SphereGeometry(0.055, 10, 8), eyeMat);
      attach(eye, side * radiusAt(2.15) * 0.8, radiusAt(2.15) * 0.25, 2.15);
      for (let k = 0; k < 5; k++) {
        const z = 1.62 - k * 0.12;
        const slit = new T.Mesh(new T.BoxGeometry(0.015, radiusAt(z) * 0.62 - k * 0.02, 0.025), darkMat);
        slit.rotation.x = -0.12;
        attach(slit, side * radiusAt(z) * 0.83, -0.02, z);
      }
    }
    // mouth: a narrow crescent underneath the snout (curving back at the corners)
    const mouth = new T.Mesh(new T.TorusGeometry(0.15, 0.014, 6, 20, Math.PI), darkMat);
    mouth.rotation.x = -Math.PI / 2;
    mouth.scale.set(1, 0.9, 1);
    attach(mouth, 0, -radiusAt(2.05) * 0.8, 1.98);

    const root = new T.Group();
    root.add(body);
    const seat = new T.Object3D();
    seat.position.set(0, 0.75, 0.3);
    bones[0].add(seat);

    super("Shark Bruce", root);
    this.root = root;
    this.bones = bones;
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
    this.huntEvery = 25;
    this.huntLimit = 9;
    this.time = 0;
    this._t = new T.Vector3();
  }

  /** the shark's head position (the fish use this to flee) */
  getPosition() {
    return this._t.copy(this.heading).multiplyScalar(2).add(this.pos);
  }

  /**
   * go hunting now
   * @param {boolean} [determined=false] - true when sent by the button: keep going until it gets there
   */
  hunt(determined = false) {
    this.state = "hunt";
    this.timer = 0;
    this.huntLimit = determined ? 25 : 9;
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
      const c = school ? school.centerOfSchool() : new T.Vector3(0, 10, 0);
      target = c;
      const d = this.pos.distanceTo(target);
      wantSpeed = d > 15 ? 10 : 7.5;
      maxTurn = 1.6;
      if (this.timer > this.huntLimit || d < 2.5) {
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

    // swimming: a wave travels from head to tail, growing toward the tail,
    // faster (and bigger) when it is swimming fast
    const freq = 2.0 + this.speed * 0.45;
    const big = 0.8 + this.speed * 0.05;
    const amp = [0.025, 0.05, 0.08, 0.12, 0.16, 0.24];
    this.bones.forEach((b, k) => {
      b.rotation.y = big * amp[k] * Math.sin(this.time * freq - k * 0.85);
    });
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 8, p.y + 3, p.z + 8, p.x, p.y, p.z];
  }
}
