// @ts-check
/**
 * The old shipwreck, half sunk into a sand mound and tilted over.
 *
 * The hull is built by hand as a BufferGeometry (Workbook 5): a series of
 * U-shaped cross sections ("stations") along the length, narrowing at the bow
 * and stern, stitched together with triangles, with UVs so the procedurally
 * painted plank texture wraps along it.
 *
 * Other parts: a deck with a broken hole, a snapped mast leaning over, a fallen
 * yard arm, a cabin at the stern, cannons poking out of gun ports, barrels and
 * an anchor with a chain of torus links lying in the sand.
 *
 * Behavior: the treasure chest on the sand creaks open and shut, and the
 * lantern on the stern flickers (more visible at night).
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { texturePack, glowMaterial } from "./materials.js";
import { reef } from "./reefState.js";
import { makeRng, noise3 } from "./util/noise.js";

/** build the hull: stations along z, each a U-curve in x/y */
function hullGeometry(length = 16, beam = 4.2, depth = 3.2) {
  const S = 28; // stations along the length
  const A = 16; // points around each U
  const pos = [];
  const uv = [];
  for (let i = 0; i <= S; i++) {
    const u = i / S; // 0 = stern, 1 = bow
    const z = -length / 2 + u * length;
    // width profile: blunt stern, pointed bow
    const w = beam / 2 * (u < 0.15 ? 0.7 + 2 * u : Math.pow(Math.sin(Math.min(1, (1 - u) / 0.85) * Math.PI / 2), 0.7));
    const keel = depth * (0.8 + 0.2 * Math.sin(u * Math.PI));
    const sheer = 0.6 * Math.pow(Math.abs(u - 0.45) * 2, 2); // deck line curves up at the ends
    for (let j = 0; j <= A; j++) {
      const a = Math.PI * (j / A); // 0..pi around the bottom
      const x = -Math.cos(a) * Math.max(0.05, w);
      const y = -Math.sin(a) * keel + sheer;
      pos.push(x, y, z);
      uv.push(u * 6, j / A * 2);
    }
  }
  const idx = [];
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < A; j++) {
      const a = i * (A + 1) + j;
      const b = a + 1;
      const c = a + (A + 1);
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Shipwreck extends GrObject {
  /** @param {number} x @param {number} z @param {number} heading */
  constructor(x, z, heading) {
    const root = new T.Group();
    root.position.set(x, floorHeight(x, z) + 1.3, z);
    root.rotation.y = heading;
    const ship = new T.Group();
    ship.rotation.z = 0.32; // listing to one side
    ship.rotation.x = 0.08; // bow slightly down
    root.add(ship);
    const rng = makeRng(1717);

    // CC0 wood planks (ambientCG Planks037A)
    const { map: wood, normalMap: woodNormal } = texturePack("Planks037A", 2, 1);
    const hullMat = new T.MeshStandardMaterial({ map: wood, normalMap: woodNormal, roughness: 0.9, side: T.DoubleSide, color: 0xf0e4cc });
    const darkWood = new T.MeshStandardMaterial({ map: wood, normalMap: woodNormal, roughness: 0.95, color: 0xcdbb9e });
    const iron = new T.MeshStandardMaterial({ color: 0x3a3f3c, metalness: 0.7, roughness: 0.6 });
    const rust = new T.MeshStandardMaterial({ color: 0x7a4a2a, metalness: 0.4, roughness: 0.8 });

    ship.add(new T.Mesh(hullGeometry(), hullMat));

    // deck, with a hole broken through it
    const deckShape = new T.Shape();
    deckShape.moveTo(-1.7, -6.5);
    deckShape.lineTo(1.7, -6.5);
    deckShape.lineTo(1.6, 4);
    deckShape.lineTo(0, 7.4);
    deckShape.lineTo(-1.6, 4);
    deckShape.closePath();
    const hole = new T.Path();
    hole.moveTo(-0.6, 0);
    hole.lineTo(0.9, -0.4);
    hole.lineTo(0.5, 1.6);
    hole.lineTo(-0.3, 1.9);
    hole.lineTo(-0.9, 0.9);
    hole.closePath();
    deckShape.holes.push(hole);
    const deckMat = darkWood.clone();
    deckMat.side = T.DoubleSide;
    const deck = new T.Mesh(new T.ShapeGeometry(deckShape), deckMat);
    deck.rotation.x = Math.PI / 2;
    deck.position.y = 0.05;
    ship.add(deck);

    // stern cabin
    const cabin = new T.Mesh(new T.BoxGeometry(3.0, 1.6, 2.6), darkWood);
    cabin.position.set(0, 0.85, -5.3);
    ship.add(cabin);
    const cabinRoof = new T.Mesh(new T.BoxGeometry(3.3, 0.15, 2.9), hullMat);
    cabinRoof.position.set(0, 1.7, -5.3);
    ship.add(cabinRoof);

    // snapped main mast, leaning over, and a fallen yard arm
    const mast = new T.Mesh(new T.CylinderGeometry(0.22, 0.28, 6.5, 10), darkWood);
    mast.geometry.translate(0, 3.25, 0);
    mast.position.set(0, 0, 1.2);
    mast.rotation.set(0.35, 0, -0.55);
    ship.add(mast);
    const stump = new T.Mesh(new T.CylinderGeometry(0.24, 0.3, 2.2, 10), darkWood);
    stump.position.set(0, 1.1, -2.5);
    ship.add(stump);
    const yard = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 5, 8), darkWood);
    yard.rotation.z = Math.PI / 2 - 0.3;
    yard.position.set(1.8, 0.6, 2.8);
    ship.add(yard);
    // a ragged scrap of sail
    const sail = new T.Mesh(
      new T.PlaneGeometry(2.2, 1.6, 6, 4),
      new T.MeshStandardMaterial({ color: 0xd8ceb0, roughness: 1, side: T.DoubleSide, transparent: true, opacity: 0.85 })
    );
    sail.position.set(0.6, 3.6, 2.4);
    sail.rotation.set(0.35, 0.4, -0.55);
    ship.add(sail);

    // cannons poking out of the side
    const cannonGeos = [];
    for (let k = 0; k < 4; k++) {
      for (const s of [-1, 1]) {
        const g = new T.CylinderGeometry(0.13, 0.18, 1.3, 10);
        g.rotateZ(Math.PI / 2);
        g.translate(s * 2.0, -0.45, -3 + k * 1.9);
        cannonGeos.push(g);
      }
    }
    ship.add(new T.Mesh(mergeGeometries(cannonGeos), iron));

    // barrels scattered on the sand around the wreck (in root, not tilted)
    for (let k = 0; k < 6; k++) {
      const barrel = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 0.9, 12), darkWood);
      const a = rng() * Math.PI * 2;
      const d = 4 + rng() * 4;
      const bx = Math.cos(a) * d, bz = Math.sin(a) * d;
      const world = new T.Vector3(bx, 0, bz).applyAxisAngle(new T.Vector3(0, 1, 0), heading).add(new T.Vector3(x, 0, z));
      barrel.position.set(bx, floorHeight(world.x, world.z) - root.position.y + 0.35, bz);
      barrel.rotation.set(rng() < 0.6 ? Math.PI / 2 : 0, rng() * 3, 0);
      root.add(barrel);
      const hoop = new T.Mesh(new T.TorusGeometry(0.41, 0.03, 6, 16), rust);
      hoop.rotation.x = Math.PI / 2;
      barrel.add(hoop);
    }

    // anchor + chain of torus links lying on the sand
    const anchor = new T.Group();
    const shank = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 2.2, 8), rust);
    anchor.add(shank);
    const arms = new T.Mesh(new T.TorusGeometry(0.75, 0.09, 6, 16, Math.PI), rust);
    arms.rotation.z = Math.PI;
    arms.position.y = -0.6;
    anchor.add(arms);
    const stock = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 1.4, 6), rust);
    stock.rotation.z = Math.PI / 2;
    stock.position.y = 1.0;
    anchor.add(stock);
    anchor.rotation.set(Math.PI / 2, 0, 0.4);
    anchor.position.set(-3.5, -0.9, 8.5);
    root.add(anchor);
    const linkGeos = [];
    for (let k = 0; k < 14; k++) {
      const g = new T.TorusGeometry(0.16, 0.045, 6, 12);
      g.rotateX(Math.PI / 2);
      if (k % 2) g.rotateZ(Math.PI / 2);
      g.translate(-3.4 + Math.sin(k * 0.5) * 0.4, -1.0, 7.4 - k * 0.32);
      linkGeos.push(g);
    }
    root.add(new T.Mesh(mergeGeometries(linkGeos), iron));

    // treasure chest next to the hull, with a lid that opens
    const chest = new T.Group();
    chest.position.set(4.2, -0.85, -2.5);
    chest.rotation.y = -0.5;
    root.add(chest);
    const box = new T.Mesh(new T.BoxGeometry(1.0, 0.55, 0.65), darkWood);
    box.position.y = 0.27;
    chest.add(box);
    const gold = new T.MeshStandardMaterial({ color: 0xffcc33, metalness: 1, roughness: 0.25, emissive: 0x664400, emissiveIntensity: 0.4 });
    const coins = new T.Mesh(new T.BoxGeometry(0.9, 0.08, 0.55), gold);
    coins.position.y = 0.52;
    chest.add(coins);
    const lidPivot = new T.Group();
    lidPivot.position.set(0, 0.55, -0.32);
    chest.add(lidPivot);
    const lid = new T.Mesh(new T.CylinderGeometry(0.32, 0.32, 1.0, 12, 1, false, 0, Math.PI), darkWood);
    lid.rotation.z = Math.PI / 2;
    lid.position.z = 0.32;
    lidPivot.add(lid);

    // stern lantern
    const lanternMat = glowMaterial(0xffb040, 0.3, 2.5);
    const lantern = new T.Mesh(new T.SphereGeometry(0.2, 10, 8), lanternMat);
    lantern.position.set(0, 2.1, -6.7);
    ship.add(lantern);

    super("Shipwreck", root);
    this.root = root;
    this.lidPivot = lidPivot;
    this.lanternMat = lanternMat;
    this.time = 0;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    this.time += Math.min(delta, 100) / 1000;
    // the chest lid creaks open and closed (a slow open, a hold, a snap shut)
    const cycle = this.time % 9;
    const open = cycle < 3 ? cycle / 3 : cycle < 6 ? 1 : Math.max(0, 1 - (cycle - 6) * 2);
    this.lidPivot.rotation.x = -open * 1.1;
    // flickering lantern
    const flick = 0.75 + 0.25 * noise3(this.time * 4, 0, 0);
    this.lanternMat.emissiveIntensity = (0.3 + 2.4 * reef.night) * flick;
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 14, p.y + 7, p.z + 12, p.x, p.y, p.z];
  }
}
