// @ts-check
/**
 * Sea turtle - SKINNED flippers (linear blend skinning, Workbook 7 page 3).
 *
 * The skin (head, neck, four flippers, tail) is one SkinnedMesh with a small
 * skeleton:
 *     0 body (root)
 *     1 head
 *     2 front-left shoulder -> 3 front-left tip
 *     4 front-right shoulder -> 5 front-right tip
 *     6 rear-left, 7 rear-right
 * Front flipper vertices blend body -> shoulder -> tip by how far along the
 * flipper they are, so the flipper bends smoothly like a wing as it strokes
 * (instead of a stiff paddle hinged at one point).
 * The shell is a separate rigid mesh (with a procedurally painted hexagon
 * texture) attached to the body bone.
 *
 * Behavior: it swims a slow loop around the town on an arc-length spline,
 * gliding up a little with each stroke. Rideable - sit on the shell.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { ClosedCardinalSpline } from "./util/curves.js";
import { addSkinWeights, cleanGeo, paint, ramp } from "./util/skin.js";
import { shellTexture } from "./materials.js";

/** an elongated flipper: root at the origin, extending along +x, swept back */
function flipperGeo(length, width, sweep) {
  const g = new T.SphereGeometry(0.5, 16, 8);
  g.scale(length, 0.12, width);
  g.translate(length / 2, 0, 0);
  g.rotateY(sweep);
  return g;
}

export class SeaTurtle extends GrObject {
  /**
   * @param {Object} p
   * @param {Array<[number, number, number]>} p.route
   * @param {string} [p.name]
   * @param {number} [p.speed]
   * @param {number} [p.start]
   */
  constructor(p) {
    const SKIN = 0x7d8f5a;
    const parts = [];
    /** @type {number[]} which body part each vertex belongs to */
    const tags = [];
    const add = (g, tag, color = SKIN) => {
      const c = paint(cleanGeo(g), color);
      parts.push(c);
      for (let i = 0; i < c.attributes.position.count; i++) tags.push(tag);
    };
    // head + neck
    const head = new T.SphereGeometry(0.32, 14, 10);
    head.scale(0.85, 0.75, 1.15);
    head.translate(0, 0.08, 1.75);
    add(head, 1);
    const neck = new T.CylinderGeometry(0.22, 0.28, 0.6, 10);
    neck.rotateX(Math.PI / 2);
    neck.translate(0, 0.04, 1.35);
    add(neck, 0);
    // flippers: tags 2 = front left, 3 = front right, 4 = rear left, 5 = rear right
    const FL = flipperGeo(1.7, 0.55, 0.45);
    FL.translate(0.7, 0, 0.7);
    add(FL, 2);
    const FR = flipperGeo(1.7, 0.55, 0.45);
    FR.scale(-1, 1, 1);
    FR.translate(-0.7, 0, 0.7);
    add(FR, 3);
    const RL = flipperGeo(0.75, 0.45, -0.6);
    RL.translate(0.55, -0.05, -0.9);
    add(RL, 4);
    const RR = flipperGeo(0.75, 0.45, -0.6);
    RR.scale(-1, 1, 1);
    RR.translate(-0.55, -0.05, -0.9);
    add(RR, 5);
    const tail = new T.ConeGeometry(0.12, 0.45, 8);
    tail.rotateX(-Math.PI / 2);
    tail.translate(0, -0.05, -1.45);
    add(tail, 0);
    const geo = mergeGeometries(parts);
    geo.computeVertexNormals();

    // skin weights
    addSkinWeights(geo, (v, i) => {
      const tag = tags[i];
      if (tag === 1) return [[1, ramp(1.35, 1.6, v.z)], [0, 1 - ramp(1.35, 1.6, v.z)]];
      if (tag === 2 || tag === 3) {
        // distance along the flipper from the shoulder
        const sx = tag === 2 ? 0.7 : -0.7;
        const along = Math.hypot(v.x - sx, v.z - 0.7) / 1.7;
        const body = 1 - ramp(0.0, 0.18, along);
        const tip = ramp(0.35, 0.85, along);
        const shoulder = Math.max(0, 1 - body - tip);
        const sb = tag === 2 ? 2 : 4;
        return [[0, body], [sb, shoulder], [sb + 1, tip]];
      }
      if (tag === 4 || tag === 5) {
        const sx = tag === 4 ? 0.55 : -0.55;
        const along = Math.hypot(v.x - sx, v.z + 0.9) / 0.75;
        const w = ramp(0.0, 0.3, along);
        return [[0, 1 - w], [tag === 4 ? 6 : 7, w]];
      }
      return [[0, 1]];
    });

    // skeleton (bind pose matches the mesh)
    const bones = [];
    const bone = (parent, x, y, z) => {
      const b = new T.Bone();
      b.position.set(x, y, z);
      if (parent) parent.add(b);
      bones.push(b);
      return b;
    };
    const body = bone(null, 0, 0, 0);
    const headB = bone(body, 0, 0.05, 1.45);
    const shL = bone(body, 0.7, 0, 0.7);
    const tipL = bone(shL, 0.75, 0, -0.32);
    const shR = bone(body, -0.7, 0, 0.7);
    const tipR = bone(shR, -0.75, 0, -0.32);
    const rL = bone(body, 0.55, -0.05, -0.9);
    const rR = bone(body, -0.55, -0.05, -0.9);
    const skeleton = new T.Skeleton(bones);
    // double sided: the right-side flippers are mirrored copies (scale -1), which flips their winding
    const skin = new T.SkinnedMesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: T.DoubleSide }));
    skin.add(body);
    skin.bind(skeleton);
    skin.frustumCulled = false;

    // shell: rigid, on the body bone
    const shellGeo = new T.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    shellGeo.scale(1.05, 0.55, 1.35);
    const shell = new T.Mesh(shellGeo, new T.MeshStandardMaterial({ map: shellTexture(), roughness: 0.55 }));
    shell.position.y = -0.05;
    body.add(shell);
    const plastron = new T.Mesh(new T.CircleGeometry(1, 28), new T.MeshStandardMaterial({ color: 0xd8c690, side: T.DoubleSide }));
    plastron.rotation.x = Math.PI / 2;
    plastron.scale.set(1.0, 1.3, 1);
    plastron.position.y = -0.05;
    body.add(plastron);
    // eyes
    for (const s of [-1, 1]) {
      const eye = new T.Mesh(new T.SphereGeometry(0.05, 8, 6), new T.MeshStandardMaterial({ color: 0x111111 }));
      eye.position.set(s * 0.2, 0.15, 0.4);
      headB.add(eye);
    }

    const root = new T.Group();
    const swimmer = new T.Group(); // bobbing/pitch
    root.add(swimmer);
    swimmer.add(skin);
    const seat = new T.Object3D();
    seat.position.set(0, 0.85, 0.5);
    swimmer.add(seat);

    super(p.name ?? "Sea Turtle", root);
    this.root = root;
    this.swimmer = swimmer;
    this.bonesMap = { headB, shL, tipL, shR, tipR, rL, rR };
    this.rideable = seat;
    this.route = new ClosedCardinalSpline(p.route);
    this.dist = p.start ?? 0;
    this.speed = p.speed ?? 1.7;
    this.time = 0;
    this.place();
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    const w = this.time * 2.0; // stroke frequency
    const stroke = Math.sin(w);
    // speed surges a little during the down-stroke
    this.dist += this.speed * (0.8 + 0.35 * Math.max(0, -Math.cos(w))) * dt;
    const b = this.bonesMap;
    b.shL.rotation.z = 0.55 * stroke;
    b.shR.rotation.z = -0.55 * stroke;
    b.shL.rotation.y = 0.3 * Math.cos(w);
    b.shR.rotation.y = -0.3 * Math.cos(w);
    b.tipL.rotation.z = 0.45 * Math.sin(w - 0.9);
    b.tipR.rotation.z = -0.45 * Math.sin(w - 0.9);
    b.rL.rotation.y = 0.35 * Math.sin(w * 0.5);
    b.rR.rotation.y = -0.35 * Math.sin(w * 0.5);
    b.headB.rotation.y = 0.25 * Math.sin(this.time * 0.4);
    b.headB.rotation.x = 0.1 * Math.sin(this.time * 0.7);
    this.swimmer.position.y = -0.12 * stroke;
    this.place();
  }

  place() {
    const { pos, tan } = this.route.atDistance(this.dist);
    this.root.position.set(pos[0], pos[1], pos[2]);
    this.root.lookAt(pos[0] + tan[0], pos[1] + tan[1], pos[2] + tan[2]);
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 5, p.y + 3, p.z + 5, p.x, p.y, p.z];
  }
}
