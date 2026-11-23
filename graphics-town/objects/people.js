// @ts-check
/**
 * Little people for the hubs (residents, diners, scientists, engineers...).
 * A person stands with their feet at the origin and faces +z.
 *
 * Every person can STAND or SIT (setSeated):
 *  - standing: just the upper body (torso capsule + head), feet at the origin
 *  - seated:   the upper body is raised to sit ON the seat, and legs appear:
 *              thighs forward along the seat, shins down to the floor
 * Place a seated person at the CENTER of the chair seat, facing away from the
 * backrest, so the torso rests against the back and the knees point forward.
 */

import * as T from "three";

const skinTones = [0xe0b48c, 0xc68c5a, 0x8d5a3b, 0xf1c9a5, 0x6b4430];
const pantsColors = [0x2b3a55, 0x3a3a3a, 0x5a4a3a, 0x24496b];
let count = 0;

/**
 * @param {number} shirt - shirt color
 * @param {{coat?: boolean, chefHat?: boolean, clipboard?: boolean, skin?: number}} [opts]
 */
export function makePerson(shirt, opts = {}) {
  const person = new T.Group();
  const skin = new T.MeshStandardMaterial({ color: opts.skin ?? skinTones[count % skinTones.length], roughness: 0.7 });
  const pants = new T.MeshStandardMaterial({ color: pantsColors[count % pantsColors.length], roughness: 0.8 });
  count++;

  // upper body: everything that moves up onto the seat when sitting
  const upper = new T.Group();
  upper.name = "upper";
  person.add(upper);
  const body = new T.Mesh(new T.CapsuleGeometry(0.12, 0.3, 4, 8), new T.MeshStandardMaterial({ color: opts.coat ? 0xf4f6f8 : shirt, roughness: 0.7 }));
  body.position.y = 0.27;
  body.name = "body";
  upper.add(body);
  const head = new T.Mesh(new T.SphereGeometry(0.1, 10, 8), skin);
  head.position.y = 0.6;
  head.name = "head";
  upper.add(head);
  if (opts.coat) {
    const shirtStripe = new T.Mesh(new T.BoxGeometry(0.07, 0.24, 0.02), new T.MeshStandardMaterial({ color: shirt }));
    shirtStripe.position.set(0, 0.34, 0.115);
    upper.add(shirtStripe);
  }
  if (opts.chefHat) {
    const hat = new T.Mesh(new T.CylinderGeometry(0.09, 0.07, 0.14, 12), new T.MeshStandardMaterial({ color: 0xffffff }));
    hat.position.y = 0.74;
    upper.add(hat);
    const puff = new T.Mesh(new T.SphereGeometry(0.1, 10, 6), hat.material);
    puff.position.y = 0.82;
    puff.scale.y = 0.6;
    upper.add(puff);
  }
  if (opts.clipboard) {
    const board = new T.Mesh(new T.BoxGeometry(0.12, 0.16, 0.015), new T.MeshStandardMaterial({ color: 0x8a6a44 }));
    board.position.set(0.1, 0.34, 0.12);
    board.rotation.x = -0.5;
    upper.add(board);
  }

  // legs, shown only when seated (filled in by setSeated)
  const legs = new T.Group();
  legs.name = "legs";
  legs.visible = false;
  person.add(legs);
  for (const sx of [-0.055, 0.055]) {
    const thigh = new T.Mesh(new T.CapsuleGeometry(0.045, 0.16, 3, 6), pants);
    thigh.rotation.x = Math.PI / 2;
    thigh.name = "thigh";
    thigh.position.x = sx;
    legs.add(thigh);
    const shin = new T.Mesh(new T.CapsuleGeometry(0.04, 0.2, 3, 6), pants);
    shin.name = "shin";
    shin.position.x = sx;
    legs.add(shin);
    const shoe = new T.Mesh(new T.BoxGeometry(0.07, 0.04, 0.12), new T.MeshStandardMaterial({ color: 0x1a1a1a }));
    shoe.name = "shoe";
    shoe.position.x = sx;
    legs.add(shoe);
  }
  return person;
}

/**
 * Sit on a seat whose top is `seatHeight` above the person's origin (or stand
 * up again with seatHeight = null).
 * @param {T.Object3D} person @param {number|null} seatHeight
 */
export function setSeated(person, seatHeight) {
  const upper = person.getObjectByName("upper");
  const legs = person.getObjectByName("legs");
  if (!upper || !legs) return;
  if (seatHeight === null) {
    upper.position.set(0, 0, 0);
    legs.visible = false;
    return;
  }
  // the torso's bottom (y = 0 in "upper") sits on the seat, a little back
  upper.position.set(0, seatHeight - 0.03, -0.04);
  legs.visible = true;
  legs.children.forEach(c => {
    if (c.name === "thigh") c.position.set(c.position.x, seatHeight + 0.03, 0.08);
    if (c.name === "shin") {
      const len = Math.max(0.05, seatHeight - 0.02);
      c.scale.y = len / 0.28;
      c.position.set(c.position.x, len / 2 + 0.02, 0.2);
    }
    if (c.name === "shoe") c.position.set(c.position.x, 0.02, 0.24);
  });
}
