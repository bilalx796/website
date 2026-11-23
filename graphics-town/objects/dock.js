// @ts-check
/**
 * Docking station for the submarine.
 *
 * Placed beside the sub's route at the dock control point, aligned with the
 * route's tangent there (local +Z along the route, local -X toward the sub).
 *
 * Details: a diamond-plate deck (CC0 texture) with a hazard-striped edge,
 * safety railings, mooring bollards and rubber fenders; cross-braced pylons
 * down to the sea floor (floorHeight); a two-level control tower (concrete
 * base, glass control room with a controller inside, a spinning radar on the
 * roof); a floodlight mast with the signal light; stacked cargo crates; a
 * small crane; a docking cradle; and a ribbed glass boarding tube.
 *
 * It reads the submarine's state machine:
 *  - approach:  the signal blinks amber, the cradle arms open
 *  - docked:    the cradle arms CLOSE around the sub, the boarding tube extends,
 *               the crane swings over the sub
 *  - depart:    everything retracts, the signal goes back to green
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { reef } from "./reefState.js";
import { texturePack, glowMaterial, waterEnvMap } from "./materials.js";
import { makePerson, setSeated } from "./people.js";

function clean(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(ng.attributes)) if (!["position", "normal", "uv"].includes(n)) ng.deleteAttribute(n);
  if (!ng.attributes.uv) ng.setAttribute("uv", new T.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
  return ng;
}
const merge = list => mergeGeometries(list.map(clean));

/** @param {string} text @param {string} sub */
function makeSignTexture(text, sub) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  g.fillStyle = "#12324a";
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = "#f2b630";
  g.lineWidth = 8;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = "#f6f1e0";
  g.font = "bold 52px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 52);
  g.font = "24px sans-serif";
  g.fillStyle = "#8fd8ee";
  g.fillText(sub, 256, 100);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}
function hazardTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 16;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  g.fillStyle = "#f2b630";
  g.fillRect(0, 0, 128, 16);
  g.fillStyle = "#1a1a1a";
  for (let x = -16; x < 144; x += 16) {
    g.beginPath(); g.moveTo(x, 16); g.lineTo(x + 8, 16); g.lineTo(x + 24, 0); g.lineTo(x + 16, 0); g.fill();
  }
  const t = new T.CanvasTexture(c);
  t.wrapS = T.RepeatWrapping;
  t.colorSpace = T.SRGBColorSpace;
  return t;
}

export class DockingStation extends GrObject {
  /**
   * @param {Object} params
   * @param {import("./submarine.js").Submarine} params.sub
   * @param {number} [params.side=-1] which side of the route (+1 / -1)
   * @param {string} [params.name]
   */
  constructor(params) {
    const sub = params.sub;
    const side = params.side ?? -1;
    const { pos, tan } = sub.route.atDistance(sub.dockDist);
    const heading = Math.atan2(tan[0], tan[2]);

    const root = new T.Group();
    root.rotation.y = heading + (side < 0 ? Math.PI : 0);
    const localX = new T.Vector3(1, 0, 0).applyAxisAngle(new T.Vector3(0, 1, 0), root.rotation.y);
    const OFFSET = 3.4; // dock center distance from the sub's center line
    root.position.set(pos[0] + localX.x * OFFSET, pos[1], pos[2] + localX.z * OFFSET);
    const toWorld = (lx, lz) => new T.Vector3(lx, 0, lz).applyAxisAngle(new T.Vector3(0, 1, 0), root.rotation.y).add(root.position);

    const dp = texturePack("DiamondPlate008A", 2, 4);
    const conc = texturePack("Concrete034", 2, 1);
    const deckMat = new T.MeshStandardMaterial({ map: dp.map, normalMap: dp.normalMap, color: 0x9aa6b0, metalness: 0.5, roughness: 0.5 });
    const steel = new T.MeshStandardMaterial({ color: 0x8a96a0, metalness: 0.7, roughness: 0.35 });
    const darkSteel = new T.MeshStandardMaterial({ color: 0x3a434b, metalness: 0.6, roughness: 0.45 });
    const yellow = new T.MeshStandardMaterial({ color: 0xf2b630, metalness: 0.2, roughness: 0.55 });
    const rubber = new T.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
    const concrete = new T.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, color: 0xdfe3df, roughness: 0.9 });
    const glass = new T.MeshStandardMaterial({ color: 0xbfe8f5, metalness: 0.7, roughness: 0.05, transparent: true, opacity: 0.4, envMap: waterEnvMap(), depthWrite: false });
    const windowMat = glowMaterial(0xffd590, 0.25, 1.9);
    const signalMat = new T.MeshStandardMaterial({ color: 0x40ff80, emissive: 0x40ff80, emissiveIntensity: 1.5 });

    // ---------------- deck with a hazard-striped edge on the berth side
    const deckY = -1.25;
    const deck = new T.Mesh(new T.BoxGeometry(4.4, 0.35, 9.4), deckMat);
    deck.position.set(0.6, deckY, 0);
    root.add(deck);
    const hz = hazardTexture();
    hz.repeat.set(10, 1);
    const edge = new T.Mesh(new T.BoxGeometry(0.22, 0.36, 9.42), new T.MeshStandardMaterial({ map: hz, roughness: 0.6 }));
    edge.position.set(-1.53, deckY, 0);
    root.add(edge);

    // ---------------- pylons with cross bracing down to the floor
    const pylonGeos = [], braceGeos = [];
    const legs = [[-1.3, -4.2], [-1.3, 4.2], [2.6, -4.2], [2.6, 4.2], [-1.3, 0], [2.6, 0]];
    const legTop = deckY - 0.17;
    /** @type {Record<string, number>} */
    const groundAt = {};
    for (const [px, pz] of legs) {
      const w = toWorld(px, pz);
      const ground = floorHeight(w.x, w.z) - root.position.y;
      groundAt[`${px},${pz}`] = ground;
      const h = legTop - ground;
      pylonGeos.push(new T.CylinderGeometry(0.2, 0.3, h, 12).translate(px, ground + h / 2, pz));
      pylonGeos.push(new T.CylinderGeometry(0.55, 0.65, 0.25, 12).translate(px, ground + 0.1, pz)); // foot
    }
    // diagonal braces between neighboring legs (an X in each bay)
    const brace = (ax, az, bx, bz) => {
      const ga = groundAt[`${ax},${az}`], gb = groundAt[`${bx},${bz}`];
      for (const [y0, y1] of [[ga + 0.4, legTop - 0.2], [legTop - 0.2, gb + 0.4]]) {
        const a = new T.Vector3(ax, y0, az), b = new T.Vector3(bx, y1, bz);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const len = a.distanceTo(b);
        const g = new T.CylinderGeometry(0.05, 0.05, len, 6);
        g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
        g.translate(mid.x, mid.y, mid.z);
        braceGeos.push(g);
      }
    };
    brace(-1.3, -4.2, -1.3, 0); brace(-1.3, 0, -1.3, 4.2); brace(2.6, -4.2, 2.6, 0); brace(2.6, 0, 2.6, 4.2);
    root.add(new T.Mesh(merge(pylonGeos), steel));
    root.add(new T.Mesh(merge(braceGeos), darkSteel));

    // ---------------- railings (not on the berth side), bollards, fenders
    const railGeos = [];
    const top = deckY + 0.18;
    for (let z = -4.6; z <= 4.61; z += 1.15) railGeos.push(new T.CylinderGeometry(0.03, 0.03, 0.7, 6).translate(2.75, top + 0.35, z));
    for (const h of [0.35, 0.68]) railGeos.push(new T.CylinderGeometry(0.025, 0.025, 9.2, 6).rotateX(Math.PI / 2).translate(2.75, top + h, 0));
    for (const zz of [-4.65, 4.65]) {
      for (let x = -1.0; x <= 2.7; x += 0.9) railGeos.push(new T.CylinderGeometry(0.03, 0.03, 0.7, 6).translate(x, top + 0.35, zz));
      for (const h of [0.35, 0.68]) railGeos.push(new T.CylinderGeometry(0.025, 0.025, 3.8, 6).rotateZ(Math.PI / 2).translate(0.85, top + h, zz));
    }
    root.add(new T.Mesh(merge(railGeos), yellow));
    const bollards = [];
    for (const z of [-3.6, -1.2, 1.2, 3.6]) {
      bollards.push(new T.CylinderGeometry(0.12, 0.15, 0.32, 12).translate(-1.15, top + 0.16, z));
      bollards.push(new T.CylinderGeometry(0.17, 0.17, 0.06, 12).translate(-1.15, top + 0.34, z));
    }
    root.add(new T.Mesh(merge(bollards), darkSteel));
    const fenders = [];
    for (const z of [-3.0, -1.0, 1.0, 3.0]) fenders.push(new T.CylinderGeometry(0.2, 0.2, 0.8, 14).translate(-1.75, deckY - 0.05, z));
    root.add(new T.Mesh(merge(fenders), rubber));

    // ---------------- control tower: concrete base + glass control room + radar
    const tower = new T.Group();
    tower.position.set(1.5, top, 1.6);
    root.add(tower);
    const base = new T.Mesh(new T.CylinderGeometry(1.0, 1.1, 1.6, 24), concrete);
    base.position.y = 0.8;
    tower.add(base);
    const doorM = new T.Mesh(new T.BoxGeometry(0.5, 0.9, 0.06), darkSteel);
    doorM.position.set(-0.98, 0.45, 0);
    doorM.rotation.y = Math.PI / 2;
    tower.add(doorM);
    const floorPlate = new T.Mesh(new T.CylinderGeometry(1.35, 1.35, 0.12, 24), steel);
    floorPlate.position.y = 1.66;
    tower.add(floorPlate);
    const room = new T.Mesh(new T.CylinderGeometry(1.25, 1.25, 1.0, 24, 1, true), glass);
    room.position.y = 2.22;
    tower.add(room);
    const mullions = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      mullions.push(new T.BoxGeometry(0.05, 1.0, 0.05).translate(Math.cos(a) * 1.25, 2.22, Math.sin(a) * 1.25));
    }
    tower.add(new T.Mesh(merge(mullions), darkSteel));
    const roomGlow = new T.Mesh(new T.CylinderGeometry(1.15, 1.15, 0.06, 24), windowMat);
    roomGlow.position.y = 2.7;
    tower.add(roomGlow);
    const roof = new T.Mesh(new T.ConeGeometry(1.45, 0.4, 24), yellow);
    roof.position.y = 2.93;
    tower.add(roof);
    // the controller, seated at a console
    const console_ = new T.Mesh(new T.BoxGeometry(0.8, 0.35, 0.3), darkSteel);
    console_.position.set(-0.55, 1.9, 0);
    console_.rotation.y = Math.PI / 2;
    tower.add(console_);
    const screens = new T.Mesh(new T.BoxGeometry(0.7, 0.18, 0.02), glowMaterial(0x7fe8ff, 0.9, 1.8));
    screens.position.set(-0.7, 2.15, 0);
    screens.rotation.y = Math.PI / 2;
    tower.add(screens);
    const controller = makePerson(0x4a8be8);
    controller.position.set(-0.1, 1.72, 0);
    controller.rotation.y = -Math.PI / 2;
    setSeated(controller, 0.36);
    tower.add(controller);
    // radar on the roof
    const radar = new T.Group();
    radar.position.y = 3.15;
    tower.add(radar);
    const radarArm = new T.Mesh(new T.BoxGeometry(1.1, 0.08, 0.12), steel);
    radarArm.position.y = 0.18;
    radar.add(radarArm);
    const radarPost = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.2, 8), steel);
    radarPost.position.y = 0.08;
    radar.add(radarPost);

    // ---------------- floodlight mast with the signal light
    const mast = new T.Mesh(new T.CylinderGeometry(0.07, 0.09, 4.2, 10), steel);
    mast.position.set(2.3, top + 2.1, -3.4);
    root.add(mast);
    const floodMat = glowMaterial(0xfff2c8, 0.6, 2.8);
    for (const dz of [-0.25, 0.25]) {
      const fl = new T.Mesh(new T.BoxGeometry(0.22, 0.16, 0.12), floodMat);
      fl.position.set(2.15, top + 3.9, -3.4 + dz);
      fl.rotation.z = -0.5;
      root.add(fl);
    }
    const signal = new T.Mesh(new T.SphereGeometry(0.2, 14, 10), signalMat);
    signal.position.set(2.3, top + 4.35, -3.4);
    root.add(signal);

    // ---------------- cargo crates
    const crateMats = [0x9c6a3a, 0x3a6f9c, 0xc04a3a].map(c => new T.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    [[1.8, -1.4, 0], [2.3, -1.4, 0], [2.05, -1.4, 1], [1.8, -2.2, 0], [0.9, -3.8, 0]].forEach(([cx, cz, lvl], i) => {
      const crate = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 0.5), crateMats[i % 3]);
      crate.position.set(cx, top + 0.25 + lvl * 0.5, cz);
      crate.rotation.y = i * 0.3;
      root.add(crate);
      const bands = new T.Mesh(new T.BoxGeometry(0.52, 0.06, 0.52), darkSteel);
      bands.position.copy(crate.position);
      bands.rotation.y = crate.rotation.y;
      root.add(bands);
    });

    // ---------------- small crane that swings over the sub while it is docked
    const crane = new T.Group();
    crane.position.set(0.2, top, -2.6);
    root.add(crane);
    const cMast = new T.Mesh(new T.CylinderGeometry(0.1, 0.13, 1.6, 10), yellow);
    cMast.position.y = 0.8;
    crane.add(cMast);
    const jib = new T.Group();
    jib.position.y = 1.6;
    crane.add(jib);
    const jibBeam = new T.Mesh(new T.BoxGeometry(0.14, 0.14, 2.4), yellow);
    jibBeam.position.z = 0.9;
    jibBeam.rotation.x = -0.12;
    jib.add(jibBeam);
    const cable = new T.Mesh(new T.CylinderGeometry(0.01, 0.01, 1.0, 4), darkSteel);
    cable.position.set(0, -0.3, 2.0);
    jib.add(cable);
    const hook = new T.Mesh(new T.TorusGeometry(0.06, 0.015, 6, 12, Math.PI * 1.5), darkSteel);
    hook.position.set(0, -0.82, 2.0);
    jib.add(hook);

    // ---------------- docking cradle: two arms that close around the sub
    /** @type {T.Group[]} */
    const cradle = [];
    for (const gz of [-2.4, 2.4]) {
      // a post up from the deck edge, and an arm that swings in to touch the hull
      const post = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 0.95, 10), yellow);
      post.position.set(-1.55, deckY + 0.55, gz);
      root.add(post);
      const arm = new T.Group();
      arm.position.set(-1.55, -0.3, gz);
      root.add(arm);
      const beam = new T.Mesh(new T.BoxGeometry(1.2, 0.16, 0.2), yellow);
      beam.position.x = -0.6;
      arm.add(beam);
      const pad = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.25, 14), rubber);
      pad.rotation.z = Math.PI / 2;
      pad.position.x = -1.25;
      arm.add(pad);
      cradle.push(arm);
    }

    // ---------------- boarding tube: ribbed glass, extends toward the sub (-X)
    const gangway = new T.Group();
    gangway.position.set(0.3, 0.05, 1.6);
    root.add(gangway);
    const tubeLen = 2.9;
    const tube = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, tubeLen, 20, 1, true), glass);
    tube.rotation.z = Math.PI / 2;
    tube.position.x = -tubeLen / 2;
    gangway.add(tube);
    const ribGeos = [];
    for (let k = 0; k <= 6; k++) ribGeos.push(new T.TorusGeometry(0.44, 0.035, 6, 20).rotateY(Math.PI / 2).translate(-(k / 6) * tubeLen, 0, 0));
    gangway.add(new T.Mesh(merge(ribGeos), darkSteel));
    const collar = new T.Mesh(new T.TorusGeometry(0.47, 0.08, 8, 24), yellow);
    collar.rotation.y = Math.PI / 2;
    collar.position.x = -tubeLen;
    gangway.add(collar);
    gangway.scale.x = 0.05;

    // ---------------- sign
    const sign = new T.Mesh(
      new T.PlaneGeometry(2.6, 0.65),
      new T.MeshStandardMaterial({ map: makeSignTexture("DOCK 1", "CORALHAVEN"), emissive: 0xffffff, emissiveIntensity: 0.15 })
    );
    sign.position.set(0.48, top + 1.25, 1.6);
    sign.rotation.y = -Math.PI / 2;
    root.add(sign);

    super(params.name ?? "Docking Station", root);
    this.sub = sub;
    this.root = root;
    this.gangway = gangway;
    this.cradle = cradle;
    this.jib = jib;
    this.radar = radar;
    this.signalMat = signalMat;
    this.time = 0;
    this.clamp = 0;
    this.swing = 0;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    const state = this.sub.state;
    const docked = state === "docked";

    // boarding tube extends while docked
    const want = docked ? 1 : 0.05;
    this.gangway.scale.x += (want - this.gangway.scale.x) * Math.min(1, dt * 1.8);
    // cradle arms: swung out of the way normally, closed around the sub when docked
    this.clamp += ((docked ? 1 : 0) - this.clamp) * Math.min(1, dt * 1.5);
    this.cradle.forEach((arm, i) => (arm.rotation.y = (i === 0 ? 1 : -1) * (1.2 - 1.2 * this.clamp)));
    // crane swings out over the sub while it's docked
    this.swing += ((docked ? 1 : 0) - this.swing) * Math.min(1, dt * 0.8);
    this.jib.rotation.y = -Math.PI / 2 * this.swing + 0.3 * (1 - this.swing) * Math.sin(this.time * 0.3);
    this.radar.rotation.y += dt * 1.5;

    // signal: blinking amber while the sub is near / docked, steady green when clear
    const busy = state === "approach" || docked || (state === "depart" && this.sub.speed < 1);
    if (busy) {
      const on = Math.sin(this.time * 6) > 0;
      this.signalMat.color.set(0xffa020);
      this.signalMat.emissive.set(0xffa020);
      this.signalMat.emissiveIntensity = on ? 2.2 : 0.2;
    } else {
      this.signalMat.color.set(0x40ff80);
      this.signalMat.emissive.set(0x40ff80);
      this.signalMat.emissiveIntensity = 1.2 + 0.6 * reef.night;
    }
  }

  lookFromLookAt() {
    const p = this.root.position;
    const back = new T.Vector3(-11, 5, -9).applyAxisAngle(new T.Vector3(0, 1, 0), this.root.rotation.y);
    return [p.x + back.x, p.y + back.y, p.z + back.z, p.x - 1, p.y - 0.5, p.z];
  }
}
