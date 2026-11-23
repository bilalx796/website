// @ts-check
/**
 * Little people for the hubs (residents, diners, scientists, engineers...).
 * A person stands with their feet at the origin and faces +z.
 */

import * as T from "three";

const skinTones = [0xe0b48c, 0xc68c5a, 0x8d5a3b, 0xf1c9a5, 0x6b4430];
let count = 0;

/**
 * @param {number} shirt - shirt color
 * @param {{coat?: boolean, chefHat?: boolean, clipboard?: boolean, skin?: number}} [opts]
 */
export function makePerson(shirt, opts = {}) {
  const person = new T.Group();
  const skin = new T.MeshStandardMaterial({ color: opts.skin ?? skinTones[count++ % skinTones.length], roughness: 0.7 });
  const body = new T.Mesh(new T.CapsuleGeometry(0.12, 0.3, 4, 8), new T.MeshStandardMaterial({ color: opts.coat ? 0xf4f6f8 : shirt, roughness: 0.7 }));
  body.position.y = 0.27;
  body.name = "body";
  person.add(body);
  const head = new T.Mesh(new T.SphereGeometry(0.1, 10, 8), skin);
  head.position.y = 0.6;
  head.name = "head";
  person.add(head);
  if (opts.coat) {
    // lab coat over a colored shirt: show the shirt as a stripe down the front
    const shirtStripe = new T.Mesh(new T.BoxGeometry(0.07, 0.24, 0.02), new T.MeshStandardMaterial({ color: shirt }));
    shirtStripe.position.set(0, 0.34, 0.115);
    person.add(shirtStripe);
  }
  if (opts.chefHat) {
    const hat = new T.Mesh(new T.CylinderGeometry(0.09, 0.07, 0.14, 12), new T.MeshStandardMaterial({ color: 0xffffff }));
    hat.position.y = 0.74;
    person.add(hat);
    const puff = new T.Mesh(new T.SphereGeometry(0.1, 10, 6), hat.material);
    puff.position.y = 0.82;
    puff.scale.y = 0.6;
    person.add(puff);
  }
  if (opts.clipboard) {
    const board = new T.Mesh(new T.BoxGeometry(0.12, 0.16, 0.015), new T.MeshStandardMaterial({ color: 0x8a6a44 }));
    board.position.set(0.1, 0.34, 0.12);
    board.rotation.x = -0.5;
    person.add(board);
  }
  return person;
}
