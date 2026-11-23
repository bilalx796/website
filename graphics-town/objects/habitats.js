// @ts-check
/**
 * The four hubs (habitat domes) and the walkable glass corridors between them.
 *
 * Every hub has:
 *  - a textured concrete base (seams, bolts, algae) with a ring of CHASING
 *    LIGHTS (one instanced mesh; the colors run around the ring)
 *  - a geodesic glass dome: a canvas texture draws the triangular panel frames,
 *    plus metal ribs merged into one mesh
 *  - a themed tiled floor (checkerboard, lab tiles, raised data-center floor,
 *    stone pavers)
 *  - a spinning vent turbine and a blinking beacon on top
 *  - a slim metal doorway frame with SLIDING GLASS DOORS facing its tram
 *    station (residents use it; the first-person explorer can't go out there)
 *  - its interior (see interiors.js): cafeteria, botany lab, server room or
 *    computer lab
 * Openings in the glass (the doorway, and one per corridor) are recorded so the
 * first-person explorer knows where it can pass.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import {
  waterEnvMap, glowMaterial, glassPanelTexture, floorTexture, texturePack,
} from "./materials.js";
import { reef } from "./reefState.js";
import { makeRng } from "./util/noise.js";
import { buildCorridor } from "./corridor.js";
import { buildCafeteria, buildBotany, buildServerRoom, buildComputerLab } from "./interiors.js";
export { makePerson } from "./people.js";

const ribMat = () => new T.MeshStandardMaterial({ color: 0x6f7d88, metalness: 0.8, roughness: 0.3, envMap: waterEnvMap() });

const FLOOR_Y = 0.46; // dome floor height above the base

const FLOORS = { cafeteria: "checker", botany: "pavers", servers: "raised", computers: "lab" };
const BUILDERS = { cafeteria: buildCafeteria, botany: buildBotany, servers: buildServerRoom, computers: buildComputerLab };

let domeCount = 0;

export class HabitatDome extends GrObject {
  /**
   * @param {Object} p
   * @param {number} p.x @param {number} p.z @param {number} p.r
   * @param {"cafeteria"|"botany"|"servers"|"computers"} p.type
   * @param {string} p.name
   * @param {[number, number]} [p.doorToward] - the doorway faces this point
   */
  constructor(p) {
    const root = new T.Group();
    const y0 = floorHeight(p.x, p.z);
    root.position.set(p.x, y0, p.z);
    const r = p.r;
    const rng = makeRng(100 + domeCount++);
    const toward = p.doorToward ?? [0, 0];
    const doorAngle = Math.atan2(toward[0] - p.x, toward[1] - p.z);
    const rm = ribMat();

    // ---------- base: textured concrete, with a metal trim ring on top
    // CC0 concrete (ambientCG Concrete034)
    const conc = texturePack("Concrete034", Math.round(r * 2.5), 0.4);
    const base = new T.Mesh(
      new T.CylinderGeometry(r + 0.35, r + 0.6, 0.7, 64, 1, true),
      new T.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, color: 0xd8dcd6, roughness: 0.95 })
    );
    base.position.y = 0.1;
    root.add(base);
    const trim = new T.Mesh(new T.TorusGeometry(r + 0.36, 0.06, 6, 64), rm);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.45;
    root.add(trim);

    // ---------- floor
    const ft = floorTexture(FLOORS[p.type]).clone();
    ft.needsUpdate = true;
    ft.repeat.set(r * 0.8, r * 0.8);
    const floor = new T.Mesh(new T.CircleGeometry(r - 0.02, 64), new T.MeshStandardMaterial({ map: ft, roughness: 0.75 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    root.add(floor);

    // ---------- geodesic glass + ribs
    const gt = glassPanelTexture().clone();
    gt.needsUpdate = true;
    gt.repeat.set(Math.round(r * 1.3), Math.max(2, Math.round(r * 0.45)));
    const glass = new T.Mesh(
      new T.SphereGeometry(r, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2),
      new T.MeshStandardMaterial({
        map: gt, color: 0xffffff, metalness: 0.85, roughness: 0.05, transparent: true, opacity: 0.42,
        envMap: waterEnvMap(), depthWrite: false, side: T.DoubleSide,
      })
    );
    glass.position.y = 0.45;
    glass.renderOrder = 5;
    root.add(glass);
    const ribGeos = [];
    for (let k = 0; k < 8; k++) {
      const g = new T.TorusGeometry(r + 0.03, 0.08, 6, 48, Math.PI);
      g.rotateY((k * Math.PI) / 8);
      g.translate(0, 0.45, 0);
      ribGeos.push(g);
    }
    for (const hFrac of [0.3, 0.6, 0.85]) {
      const g = new T.TorusGeometry(r * Math.cos(Math.asin(hFrac)) + 0.03, 0.06, 6, 64);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.45 + r * hFrac, 0);
      ribGeos.push(g);
    }
    root.add(new T.Mesh(mergeGeometries(ribGeos), rm));

    // ---------- chasing lights around the base
    const NL = Math.round(r * 6);
    const bulbs = new T.InstancedMesh(new T.SphereGeometry(0.08, 8, 6), new T.MeshBasicMaterial({ color: 0xffffff }), NL);
    const mm = new T.Matrix4();
    for (let k = 0; k < NL; k++) {
      const a = (k / NL) * Math.PI * 2;
      mm.makeTranslation(Math.cos(a) * (r + 0.52), 0.3, Math.sin(a) * (r + 0.52));
      bulbs.setMatrixAt(k, mm);
      bulbs.setColorAt(k, new T.Color(0x333333));
    }
    root.add(bulbs);

    // ---------- doorway toward the tram station: a metal frame in the wall
    //            with two sliding glass doors (no more concrete box)
    const doorway = new T.Group();
    doorway.rotation.y = doorAngle;
    doorway.position.y = FLOOR_Y;
    root.add(doorway);
    const frameGeo = [];
    const fz = r - 0.12;
    for (const sx of [-0.62, 0.62]) {
      const post = new T.BoxGeometry(0.1, 1.25, 0.14);
      post.translate(sx, 0.62, fz);
      frameGeo.push(post);
    }
    const lintel = new T.BoxGeometry(1.34, 0.12, 0.16);
    lintel.translate(0, 1.27, fz);
    frameGeo.push(lintel);
    doorway.add(new T.Mesh(mergeGeometries(frameGeo), rm));
    const exitSign = new T.Mesh(new T.BoxGeometry(0.42, 0.1, 0.02), glowMaterial(0x60ff90, 0.8, 2.0));
    exitSign.position.set(0, 1.42, fz);
    doorway.add(exitSign);
    const doorGlass = new T.MeshStandardMaterial({
      color: 0xcff4ff, transparent: true, opacity: 0.45, metalness: 0.6, roughness: 0.05, depthWrite: false,
    });
    /** @type {T.Mesh[]} */
    const doorHalves = [];
    for (const s of [-1, 1]) {
      const half = new T.Mesh(new T.BoxGeometry(0.58, 1.18, 0.03), doorGlass);
      half.position.set(s * 0.29, 0.6, fz);
      doorway.add(half);
      const edge = new T.Mesh(new T.BoxGeometry(0.03, 1.18, 0.05), rm);
      edge.position.set(s * 0.29 - s * 0.29, 0, 0);
      half.add(edge);
      doorHalves.push(half);
    }

    // ---------- vent turbine + beacon on top
    const top = new T.Group();
    top.position.y = r + 0.4;
    root.add(top);
    const housing = new T.Mesh(new T.CylinderGeometry(0.35, 0.45, 0.4, 16, 1, true), rm);
    housing.position.y = 0.15;
    top.add(housing);
    const fan = new T.Group();
    fan.position.y = 0.2;
    top.add(fan);
    for (let k = 0; k < 5; k++) {
      const blade = new T.Mesh(new T.BoxGeometry(0.3, 0.02, 0.1), rm);
      blade.position.x = 0.15;
      blade.rotation.x = 0.4;
      const holder = new T.Group();
      holder.rotation.y = (k / 5) * Math.PI * 2;
      holder.add(blade);
      fan.add(holder);
    }
    const beaconMat = new T.MeshStandardMaterial({ color: 0xff4030, emissive: 0xff2010, emissiveIntensity: 1 });
    const beacon = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), beaconMat);
    beacon.position.y = 0.5;
    top.add(beacon);

    // ---------- the interior
    const inside = BUILDERS[p.type](root, { Y: FLOOR_Y, rng, r });

    super(p.name, root);
    this.root = root;
    this.r = r;
    this.type = p.type;
    this.anims = inside.anims;
    this.obstacles = inside.obstacles;
    this.spots = inside.spots;
    this.beaconMat = beaconMat;
    this.fan = fan;
    this.bulbs = bulbs;
    this.NL = NL;
    this.doorHalves = doorHalves;
    this.doorOpen = 0;
    /** set by residents when they walk through the doorway */
    this.doorRequest = 0;
    this.doorAngle = doorAngle;
    this.doorDir = new T.Vector3(Math.sin(doorAngle), 0, Math.cos(doorAngle));
    /** the machinery in the middle is handled by obstacles now */
    this.innerRadius = 0;
    /** gaps in the glass wall: the station doorway (residents only), plus one
     *  for each corridor to another hub (added by DomeTubes) */
    this.openings = [{ dir: this.doorDir, half: 0.6, residentsOnly: true }];
    this.rng = rng;
    this.time = rng() * 10;
    this._c = new T.Color();
  }

  /** world point just inside the doorway (on the floor) */
  doorInside() {
    return this.root.position.clone().addScaledVector(this.doorDir, this.r - 0.9).setY(this.root.position.y + FLOOR_Y);
  }
  /** world point in the doorway itself */
  doorOutside() {
    return this.root.position.clone().addScaledVector(this.doorDir, this.r - 0.1).setY(this.root.position.y + FLOOR_Y);
  }
  /** a free spot on the floor (aisles etc.), in world coordinates */
  randomInside() {
    const s = this.spots[Math.floor(this.rng() * this.spots.length)];
    return this.root.localToWorld(s.clone().add(new T.Vector3((this.rng() - 0.5) * 0.4, 0, (this.rng() - 0.5) * 0.4)));
  }
  /** is a world point (x, z) inside one of the furniture obstacles? */
  blocked(x, z) {
    const lx = x - this.root.position.x, lz = z - this.root.position.z;
    return this.obstacles.some(([ox, oz, rr]) => Math.hypot(lx - ox, lz - oz) < rr);
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    const t = this.time;
    for (const a of this.anims) a(t, dt);
    this.fan.rotation.y += dt * 6;
    this.beaconMat.emissiveIntensity = t % 2 < 0.25 ? 3 : 0.2;
    // chasing lights: a bright band runs around the ring; warmer at night
    for (let k = 0; k < this.NL; k++) {
      const ph = ((k - t * 9) % 6 + 6) % 6;
      const bright = ph < 1.6 ? 1 : 0.12;
      this._c.setRGB(0.5 + 0.5 * bright, 0.75 * bright + 0.1, 0.9 * bright + 0.1).multiplyScalar(0.6 + 0.6 * reef.night);
      this.bulbs.setColorAt(k, this._c);
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    // doors slide open while someone is passing
    const want = this.doorRequest > 0 ? 1 : 0;
    this.doorRequest = Math.max(0, this.doorRequest - dt);
    this.doorOpen += (want - this.doorOpen) * Math.min(1, dt * 6);
    this.doorHalves.forEach((h, i) => (h.position.x = (i === 0 ? -1 : 1) * (0.29 + 0.5 * this.doorOpen)));
  }

  lookFromLookAt() {
    const p = this.root.position;
    const d = this.r * 1.9;
    return [p.x + d * 0.75, p.y + d * 0.7, p.z + d * 0.75, p.x, p.y + this.r * 0.3, p.z];
  }
}

/**
 * Walkable glass corridors connecting pairs of hubs (see corridor.js), at
 * floor level, so you can walk from hub to hub in first person.
 */
export class DomeTubes extends GrObject {
  /**
   * @param {Array<HabitatDome>} domes
   * @param {Array<[number, number]>} pairs - which domes to connect
   */
  constructor(domes, pairs) {
    const root = new T.Group();
    const mats = corridorMaterials();
    /** @type {Array<{walk: T.Vector3[], half: number}>} */
    const corridors = [];
    for (const [a, b] of pairs) {
      const A = domes[a], B = domes[b];
      const pa = A.root.position, pb = B.root.position;
      const u = new T.Vector3(pb.x - pa.x, 0, pb.z - pa.z).normalize();
      // from just inside one dome's glass to just inside the other's
      const start = pa.clone().addScaledVector(u, A.r - 0.45).setY(pa.y + FLOOR_Y);
      const end = pb.clone().addScaledVector(u, -(B.r - 0.45)).setY(pb.y + FLOOR_Y);
      const mid = start.clone().lerp(end, 0.5);
      const c = buildCorridor([start, mid, end], mats, { width: 1.5, height: 1.3 });
      c.meshes.forEach(m => root.add(m));
      corridors.push({ walk: c.walk, half: c.half });
      A.openings.push({ dir: u.clone(), half: 0.65 });
      B.openings.push({ dir: u.clone().negate(), half: 0.65 });
    }
    super("Glass Corridors", root);
    this.corridors = corridors;
  }

  lookFromLookAt() {
    return [10, 12, 20, 0, 1, 2];
  }
}

/** materials shared by every corridor */
let corridorMats = null;
export function corridorMaterials() {
  if (corridorMats) return corridorMats;
  const gt = glassPanelTexture().clone();
  gt.needsUpdate = true;
  corridorMats = {
    glass: new T.MeshStandardMaterial({
      map: gt, color: 0xffffff, metalness: 0.85, roughness: 0.04, transparent: true, opacity: 0.5,
      envMap: waterEnvMap(), depthWrite: false, side: T.DoubleSide,
    }),
    // CC0 diamond plate (ambientCG DiamondPlate008A)
    deck: (() => {
      const dp = texturePack("DiamondPlate008A");
      return new T.MeshStandardMaterial({ map: dp.map, normalMap: dp.normalMap, roughness: 0.45, metalness: 0.6, side: T.DoubleSide });
    })(),
    metal: ribMat(),
    light: glowMaterial(0xbff6ff, 0.6, 2.2),
  };
  return corridorMats;
}
