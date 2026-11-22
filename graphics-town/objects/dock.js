// @ts-check
/**
 * Docking station for the submarine.
 *
 * It is placed beside the sub's route at the dock control point, aligned with
 * the route's tangent there. It reads the submarine's state:
 *  - while the sub approaches, the signal light blinks amber
 *  - once it has docked, the boarding tube (gangway) extends to the sub's hatch
 *  - when it departs, the tube retracts and the light goes back to green
 *
 * The pylons reach down to the sea floor using the shared floorHeight function.
 * The sign is a CanvasTexture (Workbook 4).
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { reef } from "./reefState.js";

/** @param {string} text */
function makeSignTexture(text, sub) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
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
    // local frame: +Z along the route, +X away from the sub
    root.rotation.y = heading + (side < 0 ? Math.PI : 0);
    const localX = new T.Vector3(1, 0, 0).applyAxisAngle(new T.Vector3(0, 1, 0), root.rotation.y);
    const OFFSET = 3.4; // dock center distance from the sub's center line
    root.position.set(pos[0] + localX.x * OFFSET, pos[1], pos[2] + localX.z * OFFSET);

    const steel = new T.MeshStandardMaterial({ color: 0x8a96a0, metalness: 0.6, roughness: 0.4 });
    const deckMat = new T.MeshStandardMaterial({ color: 0x5a6670, metalness: 0.4, roughness: 0.7 });
    const hazard = new T.MeshStandardMaterial({ color: 0xf2b630, metalness: 0.2, roughness: 0.6 });
    const hubMat = new T.MeshStandardMaterial({ color: 0xdfe6ea, metalness: 0.3, roughness: 0.35 });
    const windowMat = new T.MeshStandardMaterial({ color: 0x3a6070, emissive: 0xffd590, emissiveIntensity: 0.2 });
    const tubeMat = new T.MeshStandardMaterial({
      color: 0xbfe8f5, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.6,
    });
    const signalMat = new T.MeshStandardMaterial({ color: 0x40ff80, emissive: 0x40ff80, emissiveIntensity: 1.5 });

    // deck platform
    const deckY = -1.25;
    const deck = new T.Mesh(new T.BoxGeometry(4.2, 0.35, 9), deckMat);
    deck.position.set(0.6, deckY, 0);
    root.add(deck);
    // yellow edge on the sub side
    const edge = new T.Mesh(new T.BoxGeometry(0.2, 0.38, 9.02), hazard);
    edge.position.set(-1.45, deckY, 0);
    root.add(edge);

    // pylons down to the sea floor
    for (const [px, pz] of [[-1.2, -4], [-1.2, 4], [2.4, -4], [2.4, 4], [0.6, 0]]) {
      const world = new T.Vector3(px, 0, pz).applyAxisAngle(new T.Vector3(0, 1, 0), root.rotation.y).add(root.position);
      const ground = floorHeight(world.x, world.z) - root.position.y;
      const h = deckY - ground + 0.3;
      const pylon = new T.Mesh(new T.CylinderGeometry(0.22, 0.32, h, 12), steel);
      pylon.position.set(px, ground + h / 2 - 0.3, pz);
      root.add(pylon);
      const foot = new T.Mesh(new T.CylinderGeometry(0.6, 0.7, 0.25, 12), steel);
      foot.position.set(px, ground, pz);
      root.add(foot);
    }

    // control hub: a cylinder with a glowing window band and a dome roof
    const hub = new T.Group();
    hub.position.set(1.4, deckY + 0.17, 0);
    root.add(hub);
    const hubBody = new T.Mesh(new T.CylinderGeometry(1.3, 1.3, 2.2, 28), hubMat);
    hubBody.position.y = 1.1;
    hub.add(hubBody);
    const band = new T.Mesh(new T.CylinderGeometry(1.32, 1.32, 0.5, 28, 1, true), windowMat);
    band.position.y = 1.4;
    hub.add(band);
    const roof = new T.Mesh(new T.SphereGeometry(1.3, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), hubMat);
    roof.position.y = 2.2;
    hub.add(roof);

    // signal mast with a light on top
    const mast = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 2.2, 8), steel);
    mast.position.set(1.4, deckY + 4.3, 0);
    root.add(mast);
    const signal = new T.Mesh(new T.SphereGeometry(0.22, 14, 10), signalMat);
    signal.position.set(1.4, deckY + 5.5, 0);
    root.add(signal);

    // berth guide arms in front of and behind the sub
    for (const gz of [-3.4, 3.4]) {
      const arm = new T.Mesh(new T.BoxGeometry(2.4, 0.2, 0.25), hazard);
      arm.position.set(-2.1, deckY + 0.25, gz);
      root.add(arm);
      const bumper = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.9, 12), steel);
      bumper.position.set(-3.2, deckY + 0.6, gz);
      root.add(bumper);
    }

    // boarding tube: pivots at the hub wall, extends toward the sub (-X)
    const gangway = new T.Group();
    gangway.position.set(0.1, 0.1, 0);
    root.add(gangway);
    const tubeLen = 2.7;
    const tube = new T.Mesh(new T.CylinderGeometry(0.36, 0.36, tubeLen, 18, 1, true), tubeMat);
    tube.rotation.z = Math.PI / 2;
    tube.position.x = -tubeLen / 2;
    gangway.add(tube);
    const collar = new T.Mesh(new T.TorusGeometry(0.4, 0.07, 8, 20), hazard);
    collar.rotation.y = Math.PI / 2;
    collar.position.x = -tubeLen;
    gangway.add(collar);
    gangway.scale.x = 0.05;

    // sign (canvas texture) on the hub side facing the sub
    const sign = new T.Mesh(
      new T.PlaneGeometry(2.6, 0.65),
      new T.MeshStandardMaterial({ map: makeSignTexture("DOCK 1", "CORALHAVEN"), emissive: 0xffffff, emissiveIntensity: 0.15 })
    );
    sign.position.set(-1.2, deckY + 3.6, -2.2);
    sign.rotation.y = -Math.PI / 2;
    root.add(sign);

    super(params.name ?? "Docking Station", root);
    this.sub = sub;
    this.root = root;
    this.gangway = gangway;
    this.signalMat = signalMat;
    this.windowMat = windowMat;
    this.time = 0;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    const state = this.sub.state;

    // extend the tube while docked; retract otherwise
    const want = state === "docked" ? 1 : 0.05;
    this.gangway.scale.x += (want - this.gangway.scale.x) * Math.min(1, dt * 1.8);

    // signal: blinking amber while the sub is near / docked, steady green when clear
    const busy = state === "approach" || state === "docked" || (state === "depart" && this.sub.speed < 1);
    if (busy) {
      const on = Math.sin(this.time * 6) > 0;
      this.signalMat.color.set(0xffa020);
      this.signalMat.emissive.set(0xffa020);
      this.signalMat.emissiveIntensity = on ? 2.2 : 0.2;
    } else {
      this.signalMat.color.set(0x40ff80);
      this.signalMat.emissive.set(0x40ff80);
      this.signalMat.emissiveIntensity = 1.2;
    }
    // windows glow at night
    this.windowMat.emissiveIntensity = 0.2 + 1.6 * reef.night;
  }

  lookFromLookAt() {
    const p = this.root.position;
    const back = new T.Vector3(-10, 4, -8).applyAxisAngle(new T.Vector3(0, 1, 0), this.root.rotation.y);
    return [p.x + back.x, p.y + back.y, p.z + back.z, p.x - 1, p.y - 0.5, p.z];
  }
}
