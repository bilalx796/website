// @ts-check
/**
 * Habitat domes and the glass tubes that connect them.
 *
 * Each dome: a concrete base ring, a glass hemisphere (reflects a cube env map),
 * metal ribs (half-tori around the meridians plus a latitude ring), an airlock
 * facing the town square, a blinking beacon on top, and an interior that depends
 * on the dome type:
 *    hall   - town hall tower, shops, residents walking around the plaza
 *    homes  - little houses with lit windows
 *    garden - trees, a pond and grass
 *    lab    - glowing specimen tanks and a rotating antenna dish on the roof
 * Windows glow at night (glowMaterial, like the Workbook 5 buildings).
 *
 * Tubes: generalized cylinders (TubeGeometry along a Catmull-Rom curve, WB7
 * "other geometric primitives") arching between domes, with ribs placed along
 * the curve and aligned with its tangent.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { waterEnvMap, glowMaterial } from "./materials.js";
import { reef } from "./reefState.js";
import { makeRng } from "./util/noise.js";

const concrete = () => new T.MeshStandardMaterial({ color: 0xb8bdb5, roughness: 0.9 });
const ribMat = () => new T.MeshStandardMaterial({ color: 0x7d8a94, metalness: 0.8, roughness: 0.3, envMap: waterEnvMap() });
const glassMat = () =>
  new T.MeshStandardMaterial({
    color: 0xcff4ff, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.26,
    envMap: waterEnvMap(), depthWrite: false,
  });

let domeCount = 0;

export class HabitatDome extends GrObject {
  /**
   * @param {Object} p
   * @param {number} p.x @param {number} p.z @param {number} p.r
   * @param {"hall"|"homes"|"garden"|"lab"} p.type
   * @param {string} p.name
   */
  constructor(p) {
    const root = new T.Group();
    const y0 = floorHeight(p.x, p.z);
    root.position.set(p.x, y0, p.z);
    const r = p.r;
    const rng = makeRng(100 + domeCount++);

    // base ring and floor
    const base = new T.Mesh(new T.CylinderGeometry(r + 0.35, r + 0.6, 0.7, 48), concrete());
    base.position.y = 0.1;
    root.add(base);
    const floorMat = new T.MeshStandardMaterial({ color: p.type === "garden" ? 0x5f9a48 : 0xd8d2c4, roughness: 0.8 });
    const floor = new T.Mesh(new T.CircleGeometry(r - 0.05, 48), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.46;
    root.add(floor);

    // glass dome
    const glass = new T.Mesh(new T.SphereGeometry(r, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), glassMat());
    glass.position.y = 0.45;
    glass.renderOrder = 5;
    root.add(glass);

    // ribs: half-tori standing up, rotated around the vertical axis, plus two
    // latitude rings - all merged into ONE geometry (one draw call)
    const rm = ribMat();
    const ribGeos = [];
    for (let k = 0; k < 8; k++) {
      const g = new T.TorusGeometry(r + 0.03, 0.08, 6, 40, Math.PI);
      g.rotateY((k * Math.PI) / 8);
      g.translate(0, 0.45, 0);
      ribGeos.push(g);
    }
    for (const hFrac of [0.45, 0.8]) {
      const ringR = r * Math.cos(Math.asin(hFrac));
      const g = new T.TorusGeometry(ringR + 0.03, 0.07, 6, 48);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.45 + r * hFrac, 0);
      ribGeos.push(g);
    }
    root.add(new T.Mesh(mergeGeometries(ribGeos), rm));

    // airlock facing the town square
    const toCenter = Math.atan2(-p.x, -p.z);
    const airlock = new T.Group();
    airlock.rotation.y = toCenter;
    root.add(airlock);
    const lock = new T.Mesh(new T.BoxGeometry(1.5, 1.4, 1.8), concrete());
    lock.position.set(0, 1.0, r + 0.25);
    airlock.add(lock);
    const lockRoof = new T.Mesh(new T.CylinderGeometry(0.75, 0.75, 1.8, 16, 1, false, 0, Math.PI), concrete());
    lockRoof.rotation.x = Math.PI / 2;
    lockRoof.rotation.z = Math.PI / 2;
    lockRoof.position.set(0, 1.7, r + 0.25);
    airlock.add(lockRoof);
    const doorGlow = glowMaterial(0x7fe8ff, 0.4, 2.2);
    const door = new T.Mesh(new T.PlaneGeometry(0.9, 1.0), doorGlow);
    door.position.set(0, 0.95, r + 1.16);
    airlock.add(door);

    // blinking beacon on top
    const beaconMat = new T.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff2010, emissiveIntensity: 1 });
    const beacon = new T.Mesh(new T.SphereGeometry(0.18, 12, 8), beaconMat);
    beacon.position.y = r + 0.6;
    root.add(beacon);
    const mast = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.4, 6), rm);
    mast.position.y = r + 0.35;
    root.add(mast);

    // --- interior
    const windowGlow = glowMaterial(0xffd590, 0.2, 2.0);
    const wallMats = [0xf0e6d2, 0xe8b4a0, 0xa8d0e0, 0xf2d98c].map(c => new T.MeshStandardMaterial({ color: c, roughness: 0.7 }));
    /** @type {Array<{mesh: T.Object3D, angle: number, radius: number, speed: number}>} */
    const walkers = [];
    /** @type {T.Object3D|null} */
    let dish = null;
    /** @type {Array<T.MeshStandardMaterial>} */
    const tankMats = [];

    /** a small building with a band of windows */
    const building = (bx, bz, w, h, d, mat, roof = true) => {
      const g = new T.Group();
      g.position.set(bx, 0.46, bz);
      const box = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      box.position.y = h / 2;
      g.add(box);
      const band = new T.Mesh(new T.BoxGeometry(w * 1.01, h * 0.22, d * 1.01), windowGlow);
      band.position.y = h * 0.62;
      g.add(band);
      if (roof) {
        const rf = new T.Mesh(new T.ConeGeometry(Math.max(w, d) * 0.75, h * 0.5, 4), new T.MeshStandardMaterial({ color: 0x8c4b3a }));
        rf.position.y = h + h * 0.25;
        rf.rotation.y = Math.PI / 4;
        g.add(rf);
      }
      g.rotation.y = Math.atan2(bx, bz);
      root.add(g);
      return g;
    };

    if (p.type === "hall") {
      // town hall tower in the middle
      const tower = new T.Mesh(new T.CylinderGeometry(r * 0.2, r * 0.26, r * 0.72, 24), wallMats[0]);
      tower.position.y = 0.46 + r * 0.36;
      root.add(tower);
      for (let k = 0; k < 3; k++) {
        const band = new T.Mesh(new T.CylinderGeometry(r * 0.215, r * 0.215, 0.18, 24), windowGlow);
        band.position.y = 0.46 + r * (0.18 + k * 0.18);
        root.add(band);
      }
      const top = new T.Mesh(new T.SphereGeometry(r * 0.24, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), rm);
      top.position.y = 0.46 + r * 0.72;
      root.add(top);
      // ring of shops
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        building(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, 1.1, 1.0 + rng() * 0.7, 0.9, wallMats[k % 4], k % 2 === 0);
      }
    } else if (p.type === "homes") {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + 0.3;
        building(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, 1.0, 0.9 + rng() * 0.5, 1.1, wallMats[k % 4]);
      }
    } else if (p.type === "garden") {
      const trunkMat = new T.MeshStandardMaterial({ color: 0x6b4a2b });
      const leafMats = [0x3f8f3a, 0x58a84a, 0x2f7a3c].map(c => new T.MeshStandardMaterial({ color: c, roughness: 0.8 }));
      for (let k = 0; k < 9; k++) {
        const a = rng() * Math.PI * 2;
        const rr = r * (0.25 + rng() * 0.5);
        const h = 0.9 + rng() * 1.1;
        const tree = new T.Group();
        tree.position.set(Math.cos(a) * rr, 0.46, Math.sin(a) * rr);
        const trunk = new T.Mesh(new T.CylinderGeometry(0.07, 0.1, h, 6), trunkMat);
        trunk.position.y = h / 2;
        tree.add(trunk);
        const crown = new T.Mesh(new T.IcosahedronGeometry(0.45 + rng() * 0.3, 1), leafMats[k % 3]);
        crown.position.y = h + 0.2;
        tree.add(crown);
        root.add(tree);
      }
      const pond = new T.Mesh(
        new T.CircleGeometry(r * 0.22, 24),
        new T.MeshStandardMaterial({ color: 0x3a9fc8, metalness: 0.6, roughness: 0.1, envMap: waterEnvMap() })
      );
      pond.rotation.x = -Math.PI / 2;
      pond.position.y = 0.48;
      root.add(pond);
    } else if (p.type === "lab") {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        const tm = new T.MeshStandardMaterial({ color: 0x40ffd0, emissive: 0x20e0b0, emissiveIntensity: 0.8, transparent: true, opacity: 0.7 });
        tankMats.push(tm);
        const tank = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 1.5, 16), tm);
        tank.position.set(Math.cos(a) * r * 0.5, 0.46 + 0.75, Math.sin(a) * r * 0.5);
        root.add(tank);
        const cap = new T.Mesh(new T.CylinderGeometry(0.36, 0.36, 0.15, 16), rm);
        cap.position.set(tank.position.x, 0.46 + 1.55, tank.position.z);
        root.add(cap);
      }
      building(0, 0, 1.4, 1.2, 1.4, wallMats[2], false);
      // antenna dish outside on top: rotates
      dish = new T.Group();
      dish.position.y = r + 0.45;
      const dishBowl = new T.Mesh(new T.SphereGeometry(0.8, 20, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), rm);
      dishBowl.rotation.x = -Math.PI / 2 - 0.6;
      dishBowl.position.y = 0.6;
      dish.add(dishBowl);
      const post = new T.Mesh(new T.CylinderGeometry(0.06, 0.08, 0.6, 8), rm);
      post.position.y = 0.3;
      dish.add(post);
      root.add(dish);
    }

    // residents (in the hall and homes domes) walking around in circles
    if (p.type === "hall" || p.type === "homes" || p.type === "garden") {
      const people = 6;
      const shirt = [0xe85d4a, 0x4a8be8, 0xf2c14e, 0x6bc46b, 0xb06ad8, 0xf28c4e];
      for (let k = 0; k < people; k++) {
        const person = new T.Group();
        const body = new T.Mesh(new T.CapsuleGeometry(0.12, 0.3, 4, 8), new T.MeshStandardMaterial({ color: shirt[k % 6] }));
        body.position.y = 0.27;
        person.add(body);
        const head = new T.Mesh(new T.SphereGeometry(0.1, 10, 8), new T.MeshStandardMaterial({ color: 0xe0b48c }));
        head.position.y = 0.6;
        person.add(head);
        root.add(person);
        walkers.push({
          mesh: person,
          angle: rng() * Math.PI * 2,
          radius: r * (p.type === "hall" ? 0.42 : 0.3 + rng() * 0.3),
          speed: (0.3 + rng() * 0.3) * (rng() < 0.5 ? -1 : 1),
        });
      }
    }

    super(p.name, root);
    this.root = root;
    this.r = r;
    this.walkers = walkers;
    this.dish = dish;
    this.tankMats = tankMats;
    this.beaconMat = beaconMat;
    this.time = rng() * 10;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    // walkers circle the dome, bobbing as they step
    for (const w of this.walkers) {
      w.angle += (w.speed / w.radius) * dt;
      w.mesh.position.set(Math.cos(w.angle) * w.radius, 0.46 + Math.abs(Math.sin(this.time * 7 + w.radius)) * 0.04, Math.sin(w.angle) * w.radius);
      w.mesh.rotation.y = -w.angle + (w.speed > 0 ? Math.PI : 0);
    }
    if (this.dish) this.dish.rotation.y += dt * 0.5;
    // specimen tanks pulse
    this.tankMats.forEach((m, k) => (m.emissiveIntensity = 0.6 + 0.5 * Math.sin(this.time * 2 + k)));
    // beacon blinks once every 2 seconds
    this.beaconMat.emissiveIntensity = this.time % 2 < 0.25 ? 3 : 0.2;
  }

  lookFromLookAt() {
    const p = this.root.position;
    const d = this.r * 2.6;
    return [p.x + d * 0.7, p.y + d * 0.75, p.z + d, p.x, p.y + this.r * 0.3, p.z];
  }
}

/**
 * Glass tubes connecting pairs of domes.
 */
export class DomeTubes extends GrObject {
  /**
   * @param {Array<[number, number, number]>} domes - [x, z, r]
   * @param {Array<[number, number]>} pairs - which domes to connect
   */
  constructor(domes, pairs) {
    const root = new T.Group();
    const gm = glassMat();
    gm.opacity = 0.35;
    const rm = ribMat();
    const walkway = new T.MeshStandardMaterial({ color: 0x9aa4a8, roughness: 0.8 });
    const lampMat = glowMaterial(0xbff6ff, 0.3, 2.0);
    const zAxis = new T.Vector3(0, 0, 1);
    /** @type {T.BufferGeometry[]} */
    const ribGeos = [];
    /** @type {T.BufferGeometry[]} */
    const lampGeos = [];

    for (const [a, b] of pairs) {
      const [ax, az, ar] = domes[a];
      const [bx, bz, br] = domes[b];
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      // start and end just inside each dome's glass, 1.1 above the floor
      const p0 = new T.Vector3(ax + ux * (ar - 0.6), 0, az + uz * (ar - 0.6));
      const p3 = new T.Vector3(bx - ux * (br - 0.6), 0, bz - uz * (br - 0.6));
      p0.y = floorHeight(p0.x, p0.z) + 1.1;
      p3.y = floorHeight(p3.x, p3.z) + 1.1;
      const p1 = p0.clone().lerp(p3, 0.33);
      const p2 = p0.clone().lerp(p3, 0.66);
      p1.y += 0.9;
      p2.y += 0.9;
      const curve = new T.CatmullRomCurve3([p0, p1, p2, p3]);
      const tube = new T.Mesh(new T.TubeGeometry(curve, 48, 0.75, 18, false), gm);
      tube.renderOrder = 6;
      root.add(tube);
      // a walkway inside the tube (a flat sweep: a thin tube squashed is enough here)
      const path = new T.Mesh(new T.TubeGeometry(curve, 48, 0.5, 4, false), walkway);
      path.scale.set(1, 1, 1);
      path.position.y = -0.55;
      root.add(path);

      // ribs and lamps along the curve, aligned with the tangent (merged below)
      const curveLen = curve.getLength();
      const count = Math.floor(curveLen / 1.3);
      for (let k = 1; k < count; k++) {
        const u = k / count;
        const pos = curve.getPointAt(u);
        const tan = curve.getTangentAt(u);
        const rib = new T.TorusGeometry(0.78, 0.06, 6, 24);
        rib.applyQuaternion(new T.Quaternion().setFromUnitVectors(zAxis, tan));
        rib.translate(pos.x, pos.y, pos.z);
        ribGeos.push(rib);
        if (k % 2 === 0) {
          const lamp = new T.SphereGeometry(0.07, 8, 6);
          lamp.translate(pos.x, pos.y + 0.68, pos.z);
          lampGeos.push(lamp);
        }
      }
    }
    root.add(new T.Mesh(mergeGeometries(ribGeos), rm));
    root.add(new T.Mesh(mergeGeometries(lampGeos), lampMat));
    super("Glass Walkway Tubes", root);
  }

  lookFromLookAt() {
    return [10, 14, 22, 0, 1, 2];
  }
}
