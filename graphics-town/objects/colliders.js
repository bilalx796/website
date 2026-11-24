// @ts-check
/**
 * Solid shapes for the facility's structures, so the animals you pilot (the
 * shark and the manta ray) can't swim through the domes, corridors, tram,
 * dock, beacon, wreck, mining rig or vents.
 *
 * Three kinds of simple shapes:
 *  - spheres                (the dome glass)
 *  - vertical cylinders     (beacon, vents, rig body, corridor / track samples)
 *  - oriented boxes         (a box around an object, in that object's own frame,
 *                            re-read every frame so MOVING things - the tram car,
 *                            the excavator's boom - stay solid where they are now)
 *
 * A swimmer is a few spheres along its body (see bodyPoints). pushOut() moves
 * the swimmer out of anything it overlaps and stops it heading further in, so it
 * slides along walls instead of passing through them.
 */

import * as T from "three";

/**
 * @typedef {{kind: "sphere", c: T.Vector3, r: number}} SphereC
 * @typedef {{kind: "cyl", x: number, z: number, r: number, y0: number, y1: number}} CylC
 * @typedef {{kind: "box", obj: T.Object3D, box: T.Box3}} BoxC
 * @typedef {SphereC | CylC | BoxC} Collider
 */

/** @type {Array<Collider>} */
export const colliders = [];

export function addSphere(c, r) {
  colliders.push({ kind: "sphere", c: c.clone(), r });
}

/** vertical cylinder from y0 up to y1 */
export function addCylinder(x, z, r, y0, y1) {
  colliders.push({ kind: "cyl", x, z, r, y0, y1 });
}

/**
 * a tube along a path of points: vertical cylinders every ~`step` units
 * @param {Array<T.Vector3>} points @param {number} r @param {number} below @param {number} above
 */
export function addPath(points, r, below, above, step = 0.6) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 0; k < n; k++) {
      const p = a.clone().lerp(b, k / n);
      addCylinder(p.x, p.z, r, p.y - below, p.y + above);
    }
  }
  const last = points[points.length - 1];
  addCylinder(last.x, last.z, r, last.y - below, last.y + above);
}

/**
 * the bounding box of an object's meshes, in the object's own frame
 * @param {T.Object3D} obj
 * @param {Array<T.Object3D>} [skip] - sub-trees to leave out
 */
function localBox(obj, skip = []) {
  obj.updateMatrixWorld(true);
  const inv = obj.matrixWorld.clone().invert();
  const box = new T.Box3();
  const m = new T.Matrix4();
  const visit = (/** @type {T.Object3D} */ o) => {
    if (skip.includes(o)) return;
    const mesh = /** @type {T.Mesh} */ (o);
    if (mesh.isMesh && !(/** @type {any} */ (o).isInstancedMesh) && mesh.geometry) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const gb = /** @type {T.Box3} */ (mesh.geometry.boundingBox).clone();
      box.union(gb.applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld)));
    }
    o.children.forEach(visit);
  };
  visit(obj);
  return box;
}

/**
 * a box around an object (in its own frame, following it as it moves)
 * @param {T.Object3D} obj @param {Array<T.Object3D>} [skip] @param {number} [pad]
 */
export function addBox(obj, skip = [], pad = 0) {
  const box = localBox(obj, skip);
  if (box.isEmpty()) return;
  box.expandByScalar(pad);
  colliders.push({ kind: "box", obj, box });
}

const _l = new T.Vector3();
const _q = new T.Vector3();
const _inv = new T.Matrix4();
const _push = new T.Vector3();

/**
 * how far (and which way) to move a sphere at p of radius r to get it out of c;
 * writes the push into `out` and returns true if they overlap
 * @param {Collider} c @param {T.Vector3} p @param {number} r @param {T.Vector3} out
 */
function penetration(c, p, r, out) {
  if (c.kind === "sphere") {
    out.subVectors(p, c.c);
    const d = out.length();
    if (d >= c.r + r) return false;
    if (d < 1e-6) out.set(0, 1, 0);
    else out.divideScalar(d);
    out.multiplyScalar(c.r + r - d);
    return true;
  }
  if (c.kind === "cyl") {
    if (p.y > c.y1 + r || p.y < c.y0 - r) return false;
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d >= c.r + r) return false;
    const side = c.r + r - d; // out through the wall
    const top = c.y1 + r - p.y; // out over the top
    if (top < side) out.set(0, top, 0);
    else if (d < 1e-6) out.set(side, 0, 0);
    else out.set((dx / d) * side, 0, (dz / d) * side);
    return true;
  }
  // oriented box: work in the object's frame (assumes no scaling on the object)
  _inv.copy(c.obj.matrixWorld).invert();
  _l.copy(p).applyMatrix4(_inv);
  const b = c.box;
  _q.copy(_l).clamp(b.min, b.max);
  const inside = _q.equals(_l);
  if (!inside) {
    out.subVectors(_l, _q);
    const d = out.length();
    if (d >= r) return false;
    out.multiplyScalar((r - d) / d);
  } else {
    // inside: leave through the nearest face
    const faces = [
      [_l.x - b.min.x, -1, 0, 0], [b.max.x - _l.x, 1, 0, 0],
      [_l.y - b.min.y, 0, -1, 0], [b.max.y - _l.y, 0, 1, 0],
      [_l.z - b.min.z, 0, 0, -1], [b.max.z - _l.z, 0, 0, 1],
    ];
    faces.sort((u, v) => u[0] - v[0]);
    const [d, fx, fy, fz] = faces[0];
    out.set(fx, fy, fz).multiplyScalar(d + r);
  }
  // back to world directions
  const len = out.length();
  out.transformDirection(c.obj.matrixWorld).multiplyScalar(len);
  return true;
}

/**
 * @typedef {{forward: number, side: number, r: number}} BodyPoint
 * points along a swimmer's body (forward along the heading, side across it)
 */

const UP = new T.Vector3(0, 1, 0);
const _side = new T.Vector3();
const _pt = new T.Vector3();
const _n = new T.Vector3();

/**
 * Move a swimmer out of the structures and stop it swimming further in.
 * @param {T.Vector3} pos - changed in place
 * @param {T.Vector3} heading - changed in place (stays a unit vector)
 * @param {Array<BodyPoint>} body
 */
export function pushOut(pos, heading, body) {
  _side.crossVectors(heading, UP);
  if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
  _side.normalize();
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const bp of body) {
      _pt.copy(pos).addScaledVector(heading, bp.forward).addScaledVector(_side, bp.side);
      for (const c of colliders) {
        if (!penetration(c, _pt, bp.r, _push)) continue;
        pos.add(_push);
        _pt.add(_push);
        moved = true;
        // don't keep heading into the wall
        _n.copy(_push).normalize();
        const into = heading.dot(_n);
        if (into < 0) {
          heading.addScaledVector(_n, -into);
          if (heading.lengthSq() < 1e-4) heading.copy(_n);
          heading.normalize();
        }
      }
    }
    if (!moved) break;
  }
}
