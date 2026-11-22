// @ts-check
/**
 * Seafloor mining rig - an articulated machine with 4 degrees of freedom
 * (beyond position): turret yaw, boom pitch, stick pitch, bucket pitch.
 * (Like the Workbook 5 excavator.)
 *
 * Behavior: a keyframed work cycle (a state machine where each state has a
 * target pose and a duration; joint angles are smoothly interpolated):
 *    swing to the dig spot -> lower -> scoop (curl the bucket, sand puffs up)
 *    -> raise -> swing to the spoil heap -> dump (sand falls, the heap grows)
 *    -> back ...
 * The spoil heap grows with every dump and slowly settles back down.
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { glowMaterial } from "./materials.js";
import { reef } from "./reefState.js";
import { makeRng } from "./util/noise.js";

/** [yaw, boom, stick, bucket] poses */
const POSES = {
  rest: [0, -0.3, 1.2, 0.6],
  overDig: [-1.1, -0.2, 1.0, -0.2],
  dig: [-1.1, 0.35, 1.7, -0.6],
  scoop: [-1.1, 0.25, 1.1, 1.3],
  raised: [-1.1, -0.45, 1.0, 1.4],
  overHeap: [0.9, -0.5, 1.1, 1.4],
  dump: [0.9, -0.35, 1.3, -0.9],
};
/** the work cycle: [pose, seconds to get there] */
const CYCLE = [
  ["overDig", 2.2], ["dig", 1.6], ["scoop", 1.4], ["raised", 1.4],
  ["overHeap", 2.6], ["dump", 1.2], ["overHeap", 1.0], ["rest", 1.6],
];

export class MiningRig extends GrObject {
  /**
   * @param {number} x @param {number} z
   * @param {[number, number]} heap - where the spoil heap is
   */
  constructor(x, z, heap) {
    const root = new T.Group();
    root.position.set(x, floorHeight(x, z), z);
    root.rotation.y = Math.atan2(heap[0] - x, heap[1] - z) - 0.9; // so yaw 0.9 faces the heap
    const yellow = new T.MeshStandardMaterial({ color: 0xf2b630, metalness: 0.3, roughness: 0.45 });
    const dark = new T.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.5, roughness: 0.6 });
    const steel = new T.MeshStandardMaterial({ color: 0x8a949c, metalness: 0.8, roughness: 0.3 });

    // tracked base
    for (const s of [-1, 1]) {
      const track = new T.Mesh(new T.CapsuleGeometry(0.45, 2.6, 4, 12), dark);
      track.rotation.x = Math.PI / 2;
      track.position.set(s * 1.25, 0.45, 0);
      root.add(track);
      for (let k = 0; k < 4; k++) {
        const wheel = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.5, 12), steel);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(s * 1.25, 0.45, -1.1 + k * 0.73);
        root.add(wheel);
      }
    }
    const chassis = new T.Mesh(new T.BoxGeometry(2.0, 0.5, 2.8), dark);
    chassis.position.y = 0.75;
    root.add(chassis);

    // DOF 1: turret (yaw)
    const turret = new T.Group();
    turret.position.y = 1.0;
    root.add(turret);
    const deck = new T.Mesh(new T.CylinderGeometry(1.3, 1.4, 0.5, 24), yellow);
    deck.position.y = 0.25;
    turret.add(deck);
    const cab = new T.Mesh(new T.BoxGeometry(1.1, 1.2, 1.2), yellow);
    cab.position.set(-0.55, 1.1, 0.35);
    turret.add(cab);
    const cabWindow = new T.Mesh(new T.BoxGeometry(1.0, 0.6, 1.22), glowMaterial(0x9fe8ff, 0.3, 1.6));
    cabWindow.position.set(-0.55, 1.3, 0.35);
    turret.add(cabWindow);
    const engine = new T.Mesh(new T.BoxGeometry(2.0, 0.9, 1.0), yellow);
    engine.position.set(0, 0.95, -0.9);
    turret.add(engine);
    // rotating warning light
    const warnMat = new T.MeshStandardMaterial({ color: 0xff8800, emissive: 0xff7700, emissiveIntensity: 1.5 });
    const warn = new T.Group();
    warn.position.set(-0.55, 1.8, 0.35);
    turret.add(warn);
    const warnDome = new T.Mesh(new T.SphereGeometry(0.14, 10, 8), warnMat);
    warn.add(warnDome);
    const warnFlag = new T.Mesh(new T.BoxGeometry(0.03, 0.12, 0.3), warnMat);
    warnFlag.position.z = 0.12;
    warn.add(warnFlag);

    // DOF 2: boom (pitch), DOF 3: stick (pitch), DOF 4: bucket (pitch)
    const boom = new T.Group();
    boom.position.set(0.45, 0.8, 0.7);
    turret.add(boom);
    const boomBeam = new T.Mesh(new T.BoxGeometry(0.35, 0.45, 3.2), yellow);
    boomBeam.position.z = 1.6;
    boom.add(boomBeam);
    const ram1 = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 1.8, 8), steel);
    ram1.rotation.x = Math.PI / 2 - 0.3;
    ram1.position.set(0, -0.35, 0.9);
    boom.add(ram1);
    const stick = new T.Group();
    stick.position.z = 3.2;
    boom.add(stick);
    const stickBeam = new T.Mesh(new T.BoxGeometry(0.28, 0.32, 2.2), yellow);
    stickBeam.position.z = 1.1;
    stick.add(stickBeam);
    const bucket = new T.Group();
    bucket.position.z = 2.2;
    stick.add(bucket);
    const scoopGeo = new T.CylinderGeometry(0.55, 0.55, 0.9, 16, 1, true, 0, Math.PI);
    scoopGeo.rotateZ(Math.PI / 2);
    const scoop = new T.Mesh(scoopGeo, new T.MeshStandardMaterial({ color: 0x5a5f63, metalness: 0.6, roughness: 0.5, side: T.DoubleSide }));
    scoop.position.set(0, -0.2, 0.35);
    bucket.add(scoop);
    for (let k = -1; k <= 1; k++) {
      const tooth = new T.Mesh(new T.ConeGeometry(0.07, 0.25, 6), steel);
      tooth.rotation.x = Math.PI / 2;
      tooth.position.set(k * 0.3, -0.75, 0.4);
      bucket.add(tooth);
    }
    // a load of sand that shows in the bucket while carrying
    const sandMat = new T.MeshStandardMaterial({ color: 0xd8c08f, roughness: 1 });
    const load = new T.Mesh(new T.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), sandMat);
    load.scale.set(0.95, 0.6, 1);
    load.position.set(0, -0.15, 0.35);
    load.visible = false;
    bucket.add(load);

    // spoil heap (in world coordinates, separate from the rig)
    const heapMesh = new T.Mesh(new T.ConeGeometry(2.2, 1.6, 20), sandMat);
    const hy = floorHeight(heap[0], heap[1]);
    heapMesh.position.set(heap[0] - x, hy - root.position.y + 0.3, heap[1] - z);
    heapMesh.position.applyAxisAngle(new T.Vector3(0, 1, 0), -root.rotation.y);
    root.add(heapMesh);

    // sand puff particles (small instanced blobs)
    const MAXP = 80;
    const puffs = new T.InstancedMesh(new T.IcosahedronGeometry(0.18, 0), new T.MeshStandardMaterial({ color: 0xcdb88a, transparent: true, opacity: 0.6, roughness: 1 }), MAXP);
    puffs.count = 0;
    puffs.frustumCulled = false;
    root.add(puffs);

    super("Mining Rig", root);
    this.root = root;
    this.joints = { turret, boom, stick, bucket };
    this.warn = warn;
    this.load = load;
    this.heapMesh = heapMesh;
    this.heapSize = 0.6;
    this.puffs = puffs;
    this.MAXP = MAXP;
    /** @type {Array<{p: T.Vector3, v: T.Vector3, age: number, life: number}>} */
    this.particles = [];
    this.rng = makeRng(42);
    this.step = 0;
    this.stepTime = 0;
    this.from = POSES.rest.slice();
    this.pose = POSES.rest.slice();
    this.time = 0;
    this._m = new T.Matrix4();
    this.applyPose();
  }

  applyPose() {
    const [yaw, boom, stick, bucket] = this.pose;
    this.joints.turret.rotation.y = yaw;
    this.joints.boom.rotation.x = boom;
    this.joints.stick.rotation.x = stick;
    this.joints.bucket.rotation.x = bucket;
  }

  /** puff of sand at the bucket's teeth (in rig coordinates) */
  puff(count, down = false) {
    const tip = new T.Vector3(0, -0.6, 0.4);
    this.joints.bucket.localToWorld(tip);
    this.root.worldToLocal(tip);
    for (let k = 0; k < count && this.particles.length < this.MAXP; k++) {
      this.particles.push({
        p: tip.clone().add(new T.Vector3((this.rng() - 0.5) * 0.8, 0, (this.rng() - 0.5) * 0.8)),
        v: new T.Vector3((this.rng() - 0.5) * 1.2, down ? -1.5 - this.rng() : 0.4 + this.rng() * 0.8, (this.rng() - 0.5) * 1.2),
        age: 0,
        life: 1.2 + this.rng(),
      });
    }
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    this.stepTime += dt;
    const [name, dur] = CYCLE[this.step];
    const target = POSES[name];
    const u = Math.min(1, this.stepTime / dur);
    const s = u * u * (3 - 2 * u); // smoothstep easing
    for (let k = 0; k < 4; k++) this.pose[k] = this.from[k] + (target[k] - this.from[k]) * s;
    this.applyPose();

    // things that happen during particular steps
    if (name === "scoop" && this.rng() < dt * 25) this.puff(2);
    if (name === "dump" && u > 0.3 && this.load.visible) {
      this.puff(14, true);
      this.load.visible = false;
      this.heapSize = Math.min(1.6, this.heapSize + 0.12);
    }
    if (u >= 1) {
      if (name === "scoop") this.load.visible = true;
      this.from = target.slice();
      this.step = (this.step + 1) % CYCLE.length;
      this.stepTime = 0;
    }

    // heap slowly settles, warning light spins
    this.heapSize = Math.max(0.6, this.heapSize - dt * 0.004);
    this.heapMesh.scale.set(this.heapSize, this.heapSize, this.heapSize);
    this.warn.rotation.y += dt * 6;

    // particles: drift, slow down, fade out by shrinking
    for (const p of this.particles) {
      p.age += dt;
      p.v.multiplyScalar(1 - Math.min(1, dt * 1.5));
      p.v.y -= dt * 0.3;
      p.p.addScaledVector(p.v, dt);
    }
    this.particles = this.particles.filter(p => p.age < p.life);
    this.particles.forEach((p, i) => {
      const sc = 1 + p.age * 1.5;
      this._m.makeScale(sc, sc, sc).setPosition(p.p);
      this.puffs.setMatrixAt(i, this._m);
    });
    this.puffs.count = this.particles.length;
    this.puffs.instanceMatrix.needsUpdate = true;
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x - 9, p.y + 7, p.z - 6, p.x, p.y + 1.5, p.z];
  }
}
