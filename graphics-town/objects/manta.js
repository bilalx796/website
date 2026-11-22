// @ts-check
/**
 * Manta ray - SKINNED wings.
 *
 * The body is a hand-built BufferGeometry: a diamond-shaped planform sampled on
 * a grid (top and bottom surfaces, thicker in the middle), dark on top and pale
 * underneath (vertex colors), plus the two "horns" (cephalic fins) and a thin
 * tail.
 *
 * Skeleton: center body bone; each wing has an inner and an outer bone (the
 * outer one a child of the inner one), plus a tail bone. A vertex's weights
 * depend on its distance |x| from the center line, ramping smoothly from body
 * to inner to outer bone - so the wing bends gradually.
 *
 * Animation: a traveling wave - the outer bone lags the inner bone - which is
 * how real mantas "fly". The body rises a little on each down-stroke.
 * Follows a big, high loop around the town. Rideable.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { ClosedCardinalSpline } from "./util/curves.js";
import { addSkinWeights, cleanGeo, paint, ramp } from "./util/skin.js";

const W = 3.2; // half wingspan

/** planform: front and back edge (z) at a given x */
function edges(x) {
  const a = Math.abs(x) / W;
  const front = 1.5 - 1.6 * Math.pow(a, 1.3);
  const back = -1.3 + 1.2 * Math.pow(a, 0.8) - 0.25 * Math.sin(a * Math.PI);
  return [back, Math.max(back + 0.05, front)];
}

function bodyGeometry() {
  const NX = 44, NZ = 12;
  const pos = [];
  const col = [];
  const idx = [];
  const top = new T.Color(0x23303f);
  const bottom = new T.Color(0xe8eef0);
  // two sheets: s = +1 top, -1 bottom
  for (const s of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NX; i++) {
      const x = -W + (2 * W * i) / NX;
      const [zb, zf] = edges(x);
      for (let j = 0; j <= NZ; j++) {
        const u = j / NZ;
        const z = zb + (zf - zb) * u;
        // thickness: fat in the middle of the body, thin at the wing tips and edges
        const thick = 0.32 * Math.pow(1 - Math.abs(x) / W, 1.5) * Math.sin(u * Math.PI);
        pos.push(x, s * thick, z);
        const c = s > 0 ? top : bottom;
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NZ; j++) {
        const a = base + i * (NZ + 1) + j;
        const b = a + 1;
        const c = a + (NZ + 1);
        const d = c + 1;
        if (s > 0) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

export class MantaRay extends GrObject {
  /**
   * @param {Object} p
   * @param {Array<[number, number, number]>} p.route
   * @param {string} [p.name]
   */
  constructor(p) {
    const parts = [bodyGeometry()];
    for (const s of [-1, 1]) {
      const horn = new T.CylinderGeometry(0.12, 0.05, 0.6, 6);
      horn.rotateX(Math.PI / 2 - 0.3);
      horn.translate(s * 0.45, 0, 1.55);
      parts.push(paint(cleanGeo(horn), 0x23303f));
    }
    const tail = new T.CylinderGeometry(0.05, 0.01, 2.6, 5);
    tail.rotateX(Math.PI / 2);
    tail.translate(0, 0, -2.4);
    parts.push(paint(cleanGeo(tail), 0x23303f));
    for (const pp of parts) for (const n of Object.keys(pp.attributes)) if (!["position", "normal", "uv", "color"].includes(n)) pp.deleteAttribute(n);
    const geo = mergeGeometries(parts);

    // bones: 0 body, 1 left inner, 2 left outer, 3 right inner, 4 right outer, 5 tail
    addSkinWeights(geo, v => {
      if (v.z < -1.1 && Math.abs(v.x) < 0.2) return [[5, ramp(-1.1, -1.6, v.z)], [0, 1 - ramp(-1.1, -1.6, v.z)]];
      const ax = Math.abs(v.x);
      const inner = v.x > 0 ? 1 : 3;
      const outer = inner + 1;
      const wOuter = ramp(1.6, 2.6, ax);
      const wInner = ramp(0.5, 1.4, ax) * (1 - wOuter);
      return [[0, 1 - wInner - wOuter], [inner, wInner], [outer, wOuter]];
    });
    const bones = [];
    const bone = (parent, x, y, z) => {
      const b = new T.Bone();
      b.position.set(x, y, z);
      if (parent) parent.add(b);
      bones.push(b);
      return b;
    };
    const body = bone(null, 0, 0, 0);
    const li = bone(body, 0.6, 0, 0);
    const lo = bone(li, 1.2, 0, 0);
    const ri = bone(body, -0.6, 0, 0);
    const ro = bone(ri, -1.2, 0, 0);
    const tb = bone(body, 0, 0, -1.2);
    const mesh = new T.SkinnedMesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: T.DoubleSide }));
    mesh.add(body);
    mesh.bind(new T.Skeleton(bones));
    mesh.frustumCulled = false;
    mesh.scale.setScalar(1.4);

    const root = new T.Group();
    const glider = new T.Group();
    root.add(glider);
    glider.add(mesh);
    const seat = new T.Object3D();
    seat.position.set(0, 0.7, 0.9);
    glider.add(seat);

    super(p.name ?? "Manta Ray", root);
    this.root = root;
    this.glider = glider;
    this.wing = { li, lo, ri, ro, tb };
    this.rideable = seat;
    this.route = new ClosedCardinalSpline(p.route);
    this.dist = 0;
    this.speed = 3.2;
    this.time = 0;
    this.bank = 0;
    this.place(0);
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    const w = this.time * 1.6;
    const A = 0.42;
    this.wing.li.rotation.z = A * Math.sin(w);
    this.wing.lo.rotation.z = A * 1.25 * Math.sin(w - 0.9);
    this.wing.ri.rotation.z = -A * Math.sin(w);
    this.wing.ro.rotation.z = -A * 1.25 * Math.sin(w - 0.9);
    this.wing.tb.rotation.y = 0.2 * Math.sin(this.time * 0.8);
    this.glider.position.y = -0.25 * Math.sin(w);
    this.dist += this.speed * dt;
    this.place(dt);
  }

  /** @param {number} dt */
  place(dt) {
    const { pos, tan } = this.route.atDistance(this.dist);
    this.root.position.set(pos[0], pos[1], pos[2]);
    this.root.lookAt(pos[0] + tan[0], pos[1] + tan[1], pos[2] + tan[2]);
    // bank into turns
    const ahead = this.route.atDistance(this.dist + 3).tan;
    const turn = Math.atan2(tan[0] * ahead[2] - tan[2] * ahead[0], tan[0] * ahead[0] + tan[2] * ahead[2]);
    this.bank += (Math.max(-0.5, Math.min(0.5, -turn * 2.5)) - this.bank) * Math.min(1, dt * 2);
    this.glider.rotation.z = this.bank;
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 8, p.y + 4, p.z + 8, p.x, p.y, p.z];
  }
}
