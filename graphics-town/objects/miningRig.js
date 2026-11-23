// @ts-check
/**
 * Seafloor mining rig (an excavator) - an articulated machine with 4 degrees of
 * freedom beyond position: turret yaw, boom pitch, stick pitch, bucket pitch
 * (like the Workbook 5 excavator).
 *
 * Model details:
 *  - tracks: a loop of tread cleats laid around an oval path (merged), a toothed
 *    drive sprocket, an idler wheel and rollers, on a track frame
 *  - turret: plated deck (CC0 metal-plate normal map), a counterweight with
 *    hazard stripes and a painted logo (canvas textures), an engine hood with
 *    grilles, an exhaust stack that puffs bubbles, and handrails
 *  - cab: a frame with glass windows, a seated operator holding joysticks, a
 *    roof with work lights and a spinning warning beacon
 *  - boom and stick: curved plate profiles (Shapes, extruded), joint pins and
 *    hydraulic hoses
 *  - HYDRAULIC RAMS that really connect the parts: each frame the barrel and the
 *    rod are re-aimed between their two mounting points, so they extend and
 *    retract as the joints move
 *  - bucket: curved back plate, side plates, a cutting edge and teeth
 *
 * Behavior: a keyframed work cycle (each state has a target pose and duration;
 * joint angles are eased between them): swing to the dig spot -> lower -> scoop
 * (sand puffs up) -> raise -> swing to the spoil heap -> dump (sand falls, the
 * heap grows) -> back. The heap slowly settles between dumps.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { glowMaterial, texturePack } from "./materials.js";
import { makePerson, setSeated } from "./people.js";
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

/** clean a geometry for merging */
function clean(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(ng.attributes)) if (!["position", "normal", "uv"].includes(n)) ng.deleteAttribute(n);
  if (!ng.attributes.uv) ng.setAttribute("uv", new T.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
  return ng;
}
const merge = list => mergeGeometries(list.map(clean));

/** yellow/black hazard stripes */
function hazardTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  g.fillStyle = "#f2b630";
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = "#1a1a1a";
  for (let x = -32; x < 160; x += 24) {
    g.beginPath();
    g.moveTo(x, 32); g.lineTo(x + 12, 32); g.lineTo(x + 44, 0); g.lineTo(x + 32, 0);
    g.fill();
  }
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
/** painted company logo */
function logoTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  g.fillStyle = "#f2b630";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#1a1a1a";
  g.font = "bold 30px sans-serif";
  g.fillText("CORALHAVEN", 12, 34);
  g.font = "bold 16px sans-serif";
  g.fillText("DEEP MINING CO.  CH-07", 14, 56);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

/** an extruded side profile (outline in x = forward, y = up), `width` thick, lying along +Z */
function profile(points, width) {
  const s = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)));
  const g = new T.ExtrudeGeometry(s, { depth: width, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 12 });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2); // outline x -> +z, thickness -> x
  return g;
}

export class MiningRig extends GrObject {
  /**
   * @param {number} x @param {number} z
   * @param {[number, number]} heap - where the spoil heap is
   */
  constructor(x, z, heap) {
    const root = new T.Group();
    root.position.set(x, floorHeight(x, z), z);
    root.rotation.y = Math.atan2(heap[0] - x, heap[1] - z) - 0.9; // so yaw 0.9 faces the heap
    const plates = texturePack("MetalPlates004", 2, 2);
    const yellow = new T.MeshStandardMaterial({ color: 0xf2b630, metalness: 0.35, roughness: 0.45, normalMap: plates.normalMap });
    const dark = new T.MeshStandardMaterial({ color: 0x24282c, metalness: 0.55, roughness: 0.55 });
    const steel = new T.MeshStandardMaterial({ color: 0x8a949c, metalness: 0.85, roughness: 0.3 });
    const chrome = new T.MeshStandardMaterial({ color: 0xe6ecf0, metalness: 1, roughness: 0.12 });
    const rubber = new T.MeshStandardMaterial({ color: 0x111316, roughness: 0.9 });
    const glass = new T.MeshStandardMaterial({ color: 0x9fd6ee, transparent: true, opacity: 0.35, metalness: 0.6, roughness: 0.05, depthWrite: false });
    const hazard = new T.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6 });

    // ---------------- undercarriage: two tracks
    const treadGeos = [], frameGeos = [], wheelGeos = [];
    const HALF = 1.35, RR = 0.42, CY = 0.45; // straight half-length, end radius, center height
    const perim = 4 * HALF + 2 * Math.PI * RR;
    for (const sx of [-1.25, 1.25]) {
      // cleats spaced evenly around the oval loop
      const nC = 40;
      for (let k = 0; k < nC; k++) {
        let d = (k / nC) * perim;
        let pz, py, ang;
        if (d < 2 * HALF) { pz = -HALF + d; py = CY - RR; ang = 0; }
        else if ((d -= 2 * HALF) < Math.PI * RR) { const a = d / RR; pz = HALF + Math.sin(a) * RR; py = CY - Math.cos(a) * RR; ang = a; }
        else if ((d -= Math.PI * RR) < 2 * HALF) { pz = HALF - d; py = CY + RR; ang = Math.PI; }
        else { d -= 2 * HALF; const a = d / RR; pz = -HALF - Math.sin(a) * RR; py = CY + Math.cos(a) * RR; ang = Math.PI + a; }
        const cleat = new T.BoxGeometry(0.56, 0.07, 0.15);
        cleat.translate(0, -0.03, 0);
        cleat.rotateX(-ang);
        cleat.translate(sx, py, pz);
        treadGeos.push(cleat);
      }
      // track frame and its side plate
      frameGeos.push(new T.BoxGeometry(0.4, 0.4, 2.7).translate(sx, CY, 0));
      // drive sprocket (rear, toothed), idler (front) and bottom rollers
      const sprocket = new T.CylinderGeometry(0.34, 0.34, 0.2, 18).rotateZ(Math.PI / 2).translate(sx, CY, -HALF);
      wheelGeos.push(sprocket);
      for (let k = 0; k < 10; k++) {
        const tooth = new T.BoxGeometry(0.16, 0.1, 0.08);
        tooth.translate(0, 0.38, 0);
        tooth.rotateX((k / 10) * Math.PI * 2);
        tooth.translate(sx, CY, -HALF);
        wheelGeos.push(tooth);
      }
      wheelGeos.push(new T.CylinderGeometry(0.33, 0.33, 0.22, 18).rotateZ(Math.PI / 2).translate(sx, CY, HALF));
      for (let k = 0; k < 4; k++) wheelGeos.push(new T.CylinderGeometry(0.11, 0.11, 0.3, 10).rotateZ(Math.PI / 2).translate(sx, CY - 0.26, -0.9 + k * 0.6));
    }
    root.add(new T.Mesh(merge(treadGeos), rubber));
    root.add(new T.Mesh(merge(frameGeos), yellow));
    root.add(new T.Mesh(merge(wheelGeos), steel));
    // car body between the tracks + slew ring
    const chassis = new T.Mesh(new T.BoxGeometry(2.1, 0.45, 2.0), dark);
    chassis.position.y = 0.72;
    root.add(chassis);
    const slew = new T.Mesh(new T.TorusGeometry(0.85, 0.08, 8, 32), steel);
    slew.rotation.x = Math.PI / 2;
    slew.position.y = 0.97;
    root.add(slew);

    // ---------------- DOF 1: turret (yaw)
    const turret = new T.Group();
    turret.position.y = 1.0;
    root.add(turret);
    const deck = new T.Mesh(new T.BoxGeometry(2.1, 0.4, 2.7), yellow);
    deck.position.set(0, 0.22, -0.15);
    turret.add(deck);
    // counterweight at the back with hazard stripes
    const cw = new T.Mesh(new T.BoxGeometry(2.1, 0.75, 0.6), yellow);
    cw.position.set(0, 0.75, -1.25);
    turret.add(cw);
    const stripe = new T.Mesh(new T.PlaneGeometry(2.0, 0.28), hazard);
    stripe.position.set(0, 0.6, -1.56);
    stripe.rotation.y = Math.PI;
    turret.add(stripe);
    // engine hood with grilles and the logo on its side
    const hood = new T.Mesh(new T.BoxGeometry(1.0, 0.6, 1.2), yellow);
    hood.position.set(0.5, 0.7, -0.45);
    turret.add(hood);
    const grille = [];
    for (let k = 0; k < 7; k++) grille.push(new T.BoxGeometry(0.02, 0.05, 0.9).translate(0.18 + k * 0.1, 1.01, -0.45));
    turret.add(new T.Mesh(merge(grille), dark));
    const logo = new T.Mesh(new T.PlaneGeometry(1.1, 0.28), new T.MeshStandardMaterial({ map: logoTexture(), roughness: 0.5 }));
    logo.position.set(1.06, 0.62, -0.5);
    logo.rotation.y = Math.PI / 2;
    turret.add(logo);
    // exhaust stack
    const stack = new T.Mesh(new T.CylinderGeometry(0.07, 0.08, 0.7, 10), dark);
    stack.position.set(0.75, 1.3, -0.7);
    turret.add(stack);
    const stackCap = new T.Mesh(new T.CylinderGeometry(0.1, 0.08, 0.08, 10), chrome);
    stackCap.position.set(0.75, 1.68, -0.7);
    turret.add(stackCap);
    // handrails along the right side of the deck
    const rails = [];
    for (let k = 0; k < 4; k++) rails.push(new T.CylinderGeometry(0.02, 0.02, 0.5, 6).translate(1.02, 0.67, -1.0 + k * 0.6));
    rails.push(new T.CylinderGeometry(0.02, 0.02, 1.9, 6).rotateX(Math.PI / 2).translate(1.02, 0.92, -0.1));
    turret.add(new T.Mesh(merge(rails), chrome));

    // ---------------- cab with glass, operator and lights
    const cab = new T.Group();
    cab.position.set(-0.5, 0.42, 0.45);
    turret.add(cab);
    const posts = [];
    for (const [px, pz] of [[-0.5, -0.55], [0.5, -0.55], [-0.5, 0.55], [0.5, 0.55]]) posts.push(new T.BoxGeometry(0.06, 1.2, 0.06).translate(px, 0.6, pz));
    posts.push(new T.BoxGeometry(1.1, 0.3, 1.2).translate(0, 0.15, 0)); // lower body
    cab.add(new T.Mesh(merge(posts), dark));
    const roof = new T.Mesh(new T.BoxGeometry(1.16, 0.08, 1.26), yellow);
    roof.position.y = 1.22;
    cab.add(roof);
    for (const [w, h, px, py, pz, ry] of [[0.96, 0.85, 0, 0.75, 0.55, 0], [1.06, 0.85, 0.5, 0.75, 0, Math.PI / 2], [1.06, 0.85, -0.5, 0.75, 0, Math.PI / 2], [0.96, 0.85, 0, 0.75, -0.55, 0]]) {
      const pane = new T.Mesh(new T.PlaneGeometry(w, h), glass);
      pane.position.set(px, py, pz);
      pane.rotation.y = ry;
      cab.add(pane);
    }
    const seat = new T.Mesh(new T.BoxGeometry(0.36, 0.08, 0.34), new T.MeshStandardMaterial({ color: 0x333a40 }));
    seat.position.set(0, 0.38, -0.1);
    cab.add(seat);
    const seatBack = new T.Mesh(new T.BoxGeometry(0.36, 0.42, 0.06), seat.material);
    seatBack.position.set(0, 0.62, -0.28);
    cab.add(seatBack);
    const operator = makePerson(0xf28c4e);
    operator.position.set(0, 0, -0.1);
    setSeated(operator, 0.42);
    cab.add(operator);
    for (const sx of [-0.2, 0.2]) {
      const stick = new T.Mesh(new T.CylinderGeometry(0.015, 0.015, 0.2, 6), dark);
      stick.position.set(sx, 0.52, 0.12);
      stick.rotation.x = 0.3;
      cab.add(stick);
    }
    const workLight = glowMaterial(0xfff2c8, 0.8, 2.6);
    for (const sx of [-0.35, 0.35]) {
      const wl = new T.Mesh(new T.BoxGeometry(0.16, 0.1, 0.06), workLight);
      wl.position.set(sx, 1.3, 0.6);
      cab.add(wl);
    }
    // spinning warning beacon on the cab roof
    const warnMat = new T.MeshStandardMaterial({ color: 0xff8800, emissive: 0xff7700, emissiveIntensity: 1.5 });
    const warn = new T.Group();
    warn.position.set(0, 1.36, -0.2);
    cab.add(warn);
    warn.add(new T.Mesh(new T.SphereGeometry(0.1, 10, 8), warnMat));
    const flag = new T.Mesh(new T.BoxGeometry(0.03, 0.08, 0.22), warnMat);
    flag.position.z = 0.09;
    warn.add(flag);

    // ---------------- DOF 2: boom (curved, extruded plate profile)
    const boom = new T.Group();
    boom.position.set(0.45, 0.8, 0.7);
    turret.add(boom);
    const boomGeo = profile([[0, -0.22], [1.0, -0.05], [1.9, 0.25], [3.2, -0.12], [3.2, 0.14], [1.9, 0.6], [1.0, 0.32], [0, 0.22]], 0.34);
    boom.add(new T.Mesh(boomGeo, yellow));
    const pins = [];
    pins.push(new T.CylinderGeometry(0.1, 0.1, 0.46, 12).rotateZ(Math.PI / 2));
    pins.push(new T.CylinderGeometry(0.09, 0.09, 0.44, 12).rotateZ(Math.PI / 2).translate(0, 0, 3.2));
    boom.add(new T.Mesh(merge(pins), chrome));
    // hydraulic hoses along the top of the boom
    for (const sx of [-0.08, 0.08]) {
      const hose = new T.CatmullRomCurve3([new T.Vector3(sx, 0.25, 0.2), new T.Vector3(sx, 0.5, 1.2), new T.Vector3(sx, 0.66, 1.9), new T.Vector3(sx, 0.3, 3.0)]);
      boom.add(new T.Mesh(new T.TubeGeometry(hose, 20, 0.025, 6), rubber));
    }

    // ---------------- DOF 3: stick (arm)
    const stick = new T.Group();
    stick.position.z = 3.2;
    boom.add(stick);
    const stickGeo = profile([[-0.3, 0.0], [0, -0.16], [2.2, -0.09], [2.2, 0.09], [0, 0.2], [-0.3, 0.3]], 0.26);
    stick.add(new T.Mesh(stickGeo, yellow));

    // ---------------- DOF 4: bucket
    const bucket = new T.Group();
    bucket.position.z = 2.2;
    stick.add(bucket);
    const back = new T.CylinderGeometry(0.5, 0.5, 0.86, 18, 1, true, 0, Math.PI * 1.05);
    back.rotateZ(Math.PI / 2);
    const backMesh = new T.Mesh(back, new T.MeshStandardMaterial({ color: 0x6a6f73, metalness: 0.6, roughness: 0.5, side: T.DoubleSide }));
    backMesh.position.set(0, -0.2, 0.35);
    bucket.add(backMesh);
    const sideShape = new T.Shape();
    sideShape.absarc(0, 0, 0.5, -0.05, Math.PI * 1.05, false);
    sideShape.lineTo(-0.5, 0);
    const sides = [];
    for (const sx of [-0.43, 0.43]) {
      const sp = new T.ExtrudeGeometry(sideShape, { depth: 0.03, bevelEnabled: false, curveSegments: 12 });
      sp.rotateY(Math.PI / 2);
      sp.rotateX(Math.PI);
      sp.translate(sx, -0.2, 0.35);
      sides.push(sp);
    }
    bucket.add(new T.Mesh(merge(sides), yellow));
    const edge = new T.Mesh(new T.BoxGeometry(0.9, 0.06, 0.12), steel);
    edge.position.set(0, -0.68, 0.45);
    bucket.add(edge);
    const teeth = [];
    for (let k = -2; k <= 2; k++) teeth.push(new T.ConeGeometry(0.05, 0.22, 6).rotateX(Math.PI / 2 + 0.4).translate(k * 0.19, -0.72, 0.58));
    bucket.add(new T.Mesh(merge(teeth), chrome));
    const sandMat = new T.MeshStandardMaterial({ color: 0xd8c08f, roughness: 1 });
    const load = new T.Mesh(new T.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), sandMat);
    load.scale.set(0.95, 0.6, 1);
    load.position.set(0, -0.2, 0.35);
    load.visible = false;
    bucket.add(load);

    // ---------------- hydraulic rams: barrel on one part, rod on the next
    /** @type {Array<{a: T.Object3D, aLocal: T.Vector3, b: T.Object3D, bLocal: T.Vector3, barrel: T.Mesh, rod: T.Mesh}>} */
    const rams = [];
    const ram = (a, aLocal, b, bLocal, r) => {
      const barrel = new T.Mesh(new T.CylinderGeometry(r, r, 1, 12).translate(0, 0.5, 0).rotateX(Math.PI / 2), steel);
      const rod = new T.Mesh(new T.CylinderGeometry(r * 0.55, r * 0.55, 1, 10).translate(0, 0.5, 0).rotateX(Math.PI / 2), chrome);
      a.add(barrel, rod);
      rams.push({ a, aLocal, b, bLocal, barrel, rod });
    };
    ram(turret, new T.Vector3(0.45, 0.45, 0.1), boom, new T.Vector3(0, -0.12, 1.4), 0.09); // lifts the boom
    ram(boom, new T.Vector3(0, 0.55, 1.6), stick, new T.Vector3(0, 0.3, -0.28), 0.08); // swings the stick
    ram(stick, new T.Vector3(0, 0.18, 0.5), bucket, new T.Vector3(0, 0.25, -0.05), 0.065); // curls the bucket

    // ---------------- spoil heap and particles
    const heapMesh = new T.Mesh(new T.ConeGeometry(2.2, 1.6, 20), sandMat);
    const hy = floorHeight(heap[0], heap[1]);
    heapMesh.position.set(heap[0] - x, hy - root.position.y + 0.3, heap[1] - z);
    heapMesh.position.applyAxisAngle(new T.Vector3(0, 1, 0), -root.rotation.y);
    root.add(heapMesh);
    const MAXP = 90;
    const puffs = new T.InstancedMesh(new T.IcosahedronGeometry(0.18, 0), new T.MeshStandardMaterial({ color: 0xcdb88a, transparent: true, opacity: 0.6, roughness: 1 }), MAXP);
    puffs.count = 0;
    puffs.frustumCulled = false;
    root.add(puffs);
    const bubbles = new T.InstancedMesh(new T.SphereGeometry(0.06, 8, 6), new T.MeshStandardMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.5 }), 40);
    bubbles.count = 0;
    bubbles.frustumCulled = false;
    root.add(bubbles);

    super("Mining Rig", root);
    this.root = root;
    this.joints = { turret, boom, stick, bucket };
    this.rams = rams;
    this.warn = warn;
    this.load = load;
    this.stackTop = stackCap;
    this.heapMesh = heapMesh;
    this.heapSize = 0.6;
    this.puffs = puffs;
    this.bubbleMesh = bubbles;
    this.MAXP = MAXP;
    /** @type {Array<{p: T.Vector3, v: T.Vector3, age: number, life: number}>} */
    this.particles = [];
    /** @type {Array<{p: T.Vector3, age: number}>} */
    this.exhaust = [];
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
    this.root.updateMatrixWorld(true);
    // re-aim every hydraulic ram between its two mounting points
    const z = new T.Vector3(0, 0, 1);
    for (const r of this.rams) {
      const A = r.aLocal;
      const B = r.a.worldToLocal(r.b.localToWorld(r.bLocal.clone()));
      const dir = B.clone().sub(A);
      const len = dir.length();
      dir.normalize();
      const q = new T.Quaternion().setFromUnitVectors(z, dir);
      // barrel: from A, 60% of the way; rod: from B back toward A, 60% of the way (they overlap)
      r.barrel.position.copy(A);
      r.barrel.quaternion.copy(q);
      r.barrel.scale.set(1, 1, len * 0.6);
      r.rod.position.copy(B);
      r.rod.quaternion.setFromUnitVectors(z, dir.clone().negate());
      r.rod.scale.set(1, 1, len * 0.6);
    }
  }

  /** puff of sand at the bucket's teeth (in rig coordinates) */
  puff(count, down = false) {
    const tip = new T.Vector3(0, -0.7, 0.5);
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

    this.heapSize = Math.max(0.6, this.heapSize - dt * 0.004);
    this.heapMesh.scale.set(this.heapSize, this.heapSize, this.heapSize);
    this.warn.rotation.y += dt * 6;

    // sand particles
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

    // exhaust bubbles from the stack (harder working = more bubbles)
    if (this.rng() < dt * (name === "scoop" || name === "raised" ? 14 : 5) && this.exhaust.length < 40) {
      const top = this.stackTop.getWorldPosition(new T.Vector3());
      this.root.worldToLocal(top);
      this.exhaust.push({ p: top, age: 0 });
    }
    for (const b of this.exhaust) {
      b.age += dt;
      b.p.y += dt * 1.6;
      b.p.x += Math.sin(this.time * 5 + b.age * 7) * dt * 0.2;
    }
    this.exhaust = this.exhaust.filter(b => b.age < 4);
    this.exhaust.forEach((b, i) => {
      const sc = 1 + b.age * 0.3;
      this._m.makeScale(sc, sc, sc).setPosition(b.p);
      this.bubbleMesh.setMatrixAt(i, this._m);
    });
    this.bubbleMesh.count = this.exhaust.length;
    this.bubbleMesh.instanceMatrix.needsUpdate = true;
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x - 8, p.y + 6, p.z - 6, p.x, p.y + 1.5, p.z];
  }
}
