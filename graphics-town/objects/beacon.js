// @ts-check
/**
 * The beacon tower: a striped lighthouse standing on a rock outcrop.
 *
 * Its lamp head turns to follow the submarine using lookAt - the same idea as
 * the radar dish that tracked the airplane in Workbook 4. A SpotLight in the
 * head targets the submarine, and a transparent additive cone shows the beam.
 * When the sub is far away the head sweeps around instead.
 * The beam is strongest at night.
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { glowMaterial, waterEnvMap } from "./materials.js";
import { reef } from "./reefState.js";

export class BeaconTower extends GrObject {
  /**
   * @param {number} x @param {number} z
   * @param {import("./submarine.js").Submarine} sub
   */
  constructor(x, z, sub) {
    const root = new T.Group();
    root.position.set(x, floorHeight(x, z) - 0.3, z);
    const white = new T.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });
    const red = new T.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 });
    const metal = new T.MeshStandardMaterial({ color: 0x34495e, metalness: 0.7, roughness: 0.35, envMap: waterEnvMap() });

    // tapered tower made of alternating stripes
    const H = 10;
    const stripes = 6;
    for (let k = 0; k < stripes; k++) {
      const h = H / stripes;
      const r0 = 1.5 - (k / stripes) * 0.6;
      const r1 = 1.5 - ((k + 1) / stripes) * 0.6;
      const seg = new T.Mesh(new T.CylinderGeometry(r1, r0, h, 28), k % 2 ? red : white);
      seg.position.y = k * h + h / 2;
      root.add(seg);
    }
    // little windows up the tower
    const win = glowMaterial(0xffd590, 0.2, 1.8);
    for (let k = 0; k < 4; k++) {
      const w = new T.Mesh(new T.BoxGeometry(0.3, 0.45, 0.1), win);
      const r = 1.42 - (k * 2.2 + 1.5) / H * 0.6;
      const a = k * 1.7;
      w.position.set(Math.sin(a) * r, 1.5 + k * 2.2, Math.cos(a) * r);
      w.rotation.y = a;
      root.add(w);
    }
    // gallery deck + railing
    const gallery = new T.Mesh(new T.CylinderGeometry(1.4, 1.2, 0.25, 28), metal);
    gallery.position.y = H + 0.1;
    root.add(gallery);
    const rail = new T.Mesh(new T.TorusGeometry(1.35, 0.04, 6, 32), metal);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = H + 0.75;
    root.add(rail);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const post = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.65, 4), metal);
      post.position.set(Math.cos(a) * 1.35, H + 0.45, Math.sin(a) * 1.35);
      root.add(post);
    }
    // lamp room: glass cylinder and a roof
    const glass = new T.Mesh(
      new T.CylinderGeometry(0.8, 0.8, 1.3, 20, 1, true),
      new T.MeshStandardMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.3, metalness: 0.9, roughness: 0.05, envMap: waterEnvMap() })
    );
    glass.position.y = H + 0.9;
    root.add(glass);
    const roof = new T.Mesh(new T.ConeGeometry(1.0, 0.9, 20), red);
    roof.position.y = H + 2.0;
    root.add(roof);

    // the lamp head: turns with lookAt; +Z of the head is where it points
    const head = new T.Group();
    head.position.y = H + 0.9;
    root.add(head);
    const housing = new T.Mesh(new T.CylinderGeometry(0.3, 0.42, 0.7, 16), metal);
    housing.rotation.x = Math.PI / 2;
    head.add(housing);
    const lensMat = new T.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff2c0, emissiveIntensity: 2 });
    const lens = new T.Mesh(new T.CircleGeometry(0.4, 18), lensMat);
    lens.position.z = 0.36;
    head.add(lens);
    // visible beam: a cone with its tip at the lens, opening along +Z
    const beamLen = 26;
    const beamGeo = new T.ConeGeometry(3.4, beamLen, 24, 1, true);
    beamGeo.translate(0, -beamLen / 2, 0);
    beamGeo.rotateX(-Math.PI / 2);
    // fade the beam along its length: bright at the lamp, gone at the far end
    const gc = document.createElement("canvas");
    gc.width = 4;
    gc.height = 128;
    const gg = /** @type {CanvasRenderingContext2D} */ (gc.getContext("2d"));
    const grad = gg.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    gg.fillStyle = grad;
    gg.fillRect(0, 0, 4, 128);
    const beamTex = new T.CanvasTexture(gc);
    const beamMat = new T.MeshBasicMaterial({
      color: 0xfff3c4, map: beamTex, transparent: true, opacity: 0.1, blending: T.AdditiveBlending,
      depthWrite: false, side: T.DoubleSide, fog: false,
    });
    const beam = new T.Mesh(beamGeo, beamMat);
    beam.position.z = 0.36;
    beam.renderOrder = 11;
    head.add(beam);

    // the actual light, aimed at the submarine
    const spot = new T.SpotLight(0xfff0c8, 0, 60, 0.13, 0.4, 1.2);
    head.add(spot);
    const sweepTarget = new T.Object3D();
    root.add(sweepTarget);

    super("Beacon Tower", root);
    this.root = root;
    this.head = head;
    this.spot = spot;
    this.beamMat = beamMat;
    this.sub = sub;
    this.sweepTarget = sweepTarget;
    this.angle = 0;
    this.trackWeight = 0;
    this._aim = new T.Vector3();
    this._p = new T.Vector3();
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    const subPos = this.sub.root.getWorldPosition(this._p);
    const headPos = this.head.getWorldPosition(new T.Vector3());
    const near = subPos.distanceTo(headPos) < 48;
    this.trackWeight += ((near ? 1 : 0) - this.trackWeight) * Math.min(1, dt * 1.5);

    // sweep target goes around in a circle below the tower
    this.angle += dt * 0.6;
    const sweep = new T.Vector3(
      headPos.x + Math.cos(this.angle) * 20,
      headPos.y - 7,
      headPos.z + Math.sin(this.angle) * 20
    );
    // blend between sweeping and tracking the sub, then lookAt
    this._aim.copy(sweep).lerp(subPos, this.trackWeight);
    this.head.lookAt(this._aim);
    this.sweepTarget.position.copy(this._aim).sub(this.root.position);
    this.spot.target = this.sweepTarget;

    this.spot.intensity = 20 + 380 * reef.night;
    this.beamMat.opacity = 0.02 + 0.09 * reef.night;
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 14, p.y + 9, p.z + 14, p.x, p.y + 6, p.z];
  }
}
