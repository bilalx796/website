// @ts-check
/**
 * Jellyfish - animated with MORPHING / BLEND SHAPES (Workbook 7, page 4).
 *
 * Why morphing? A jellyfish swims by squeezing its bell: the whole shape
 * changes (bell gets narrower and taller, tentacles pull in), which is not a
 * rotation of rigid parts - so skinning doesn't fit well. With morph targets we
 * model the "relaxed" and "contracted" shapes and blend between them.
 *
 * The geometry: a bell (surface of revolution, LatheGeometry), a frilly rim,
 * 4 oral arms and 10 long tentacles, all merged into one geometry.
 * Morph targets (same vertices, different positions - computed in code):
 *    0. "pulse"  - bell squeezed in and lengthened, tentacles pulled in and up
 *    1. "drift"  - tentacles trailing off to one side (used when moving sideways)
 * Using the offset (additive) form, influences don't have to add up to 1.
 *
 * Behavior: each pulse (fast squeeze, slow relax) pushes the jellyfish up, and
 * it sinks slowly in between, drifting with the current. Its glow color throbs
 * through three colors (like the Workbook 1 color throb) and is brighter at
 * night. Geometry is shared by all the jellyfish; each has its own influences.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { reef } from "./reefState.js";
import { makeRng, noise3 } from "./util/noise.js";
import { cleanGeo, ramp } from "./util/skin.js";

/** build the jellyfish geometry and its morph targets */
function jellyGeometry() {
  const parts = [];
  /** @type {number[]} for each part: 0 = bell, 1 = tentacle/arm */
  const kinds = [];
  const add = (g, kind) => {
    const c = cleanGeo(g);
    parts.push(c);
    for (let i = 0; i < c.attributes.position.count; i++) kinds.push(kind);
  };

  // bell: profile from the rim (r=1, y=0) up over the top
  const prof = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    prof.push(new T.Vector2(Math.max(0.001, Math.cos(a) * 1.0), Math.sin(a) * 0.85 - 0.05 * Math.cos(a * 4)));
  }
  prof.reverse(); // lathe wants bottom-to-top for outward normals when open
  add(new T.LatheGeometry(prof, 32), 0);
  // frilly rim
  const rim = new T.TorusGeometry(1.0, 0.06, 6, 48);
  rim.rotateX(Math.PI / 2);
  add(rim, 0);

  // oral arms (thicker, wavy) and tentacles (thin, long)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const arm = new T.CylinderGeometry(0.09, 0.03, 1.4, 6, 10);
    arm.translate(Math.cos(a) * 0.22, -0.7, Math.sin(a) * 0.22);
    add(arm, 1);
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const len = 2.4 + (k % 3) * 0.5;
    const t = new T.CylinderGeometry(0.025, 0.012, len, 4, 16);
    t.translate(Math.cos(a) * 0.9, -len / 2, Math.sin(a) * 0.9);
    add(t, 1);
  }
  const geo = mergeGeometries(parts);
  const pos = geo.attributes.position;

  // morph target 0: pulse
  const pulse = new Float32Array(pos.count * 3);
  // morph target 1: drift (tentacles trail toward -x, more at the tips)
  const drift = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let px = x, py = y, pz = z;
    if (kinds[i] === 0) {
      // bell: squeeze in (more near the rim) and stretch up
      const rimness = 1 - ramp(0, 0.85, y);
      const s = 1 - 0.32 * (0.4 + 0.6 * rimness);
      px = x * s;
      pz = z * s;
      py = y * 1.2 + 0.08 * rimness;
    } else {
      // tentacles: pulled in toward the middle, and up a bit
      const down = Math.max(0, -y);
      px = x * 0.65;
      pz = z * 0.65;
      py = y * 0.85 + 0.15;
      px -= 0.0 * down;
    }
    pulse.set([px, py, pz], i * 3);
    const down = kinds[i] === 1 ? Math.max(0, -y) : 0;
    drift.set([x - 0.12 * down * down, y + 0.03 * down * down, z], i * 3);
  }
  geo.morphAttributes.position = [new T.BufferAttribute(pulse, 3), new T.BufferAttribute(drift, 3)];
  geo.computeVertexNormals();
  return geo;
}

const THROB = [new T.Color(0xff6fd8), new T.Color(0x9b7bff), new T.Color(0x5ee6ff)];

export class Jellyfish extends GrObject {
  /**
   * @param {Object} p
   * @param {T.BufferGeometry} p.geometry - shared
   * @param {number} p.x @param {number} p.y @param {number} p.z
   * @param {number} p.seed
   * @param {string} p.name
   */
  constructor(p) {
    const rng = makeRng(p.seed);
    const mat = new T.MeshStandardMaterial({
      color: 0xffd8f4, emissive: 0xff6fd8, emissiveIntensity: 0.5,
      transparent: true, opacity: 0.55, roughness: 0.2, metalness: 0.1,
      side: T.DoubleSide, depthWrite: false,
    });
    const mesh = new T.Mesh(p.geometry, mat);
    mesh.morphTargetInfluences = [0, 0];
    const s = 0.55 + rng() * 0.5;
    mesh.scale.setScalar(s);
    mesh.renderOrder = 8;
    const root = new T.Group();
    root.add(mesh);
    root.position.set(p.x, p.y, p.z);
    super(p.name, root);
    this.root = root;
    this.mesh = mesh;
    this.mat = mat;
    this.size = s;
    this.period = 2.2 + rng() * 1.2;
    this.phase = rng() * 10;
    this.vy = 0;
    this.time = rng() * 10;
    this.home = new T.Vector3(p.x, p.y, p.z);
    this._c = new T.Color();
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    // pulse cycle: quick squeeze (first 30%), slow relax
    const c = ((this.time + this.phase) % this.period) / this.period;
    const squeeze = c < 0.3 ? Math.sin((c / 0.3) * Math.PI / 2) : 1 - (c - 0.3) / 0.7;
    const eased = squeeze * squeeze * (3 - 2 * squeeze);
    this.mesh.morphTargetInfluences[0] = eased;
    // thrust while squeezing, sink slowly otherwise, with drag
    if (c < 0.3) this.vy += 2.4 * dt;
    this.vy -= 0.35 * dt;
    this.vy *= 1 - Math.min(1, dt * 1.2);

    // drift with the current and a little noise, pulled gently toward home
    const p = this.root.position;
    const nx = noise3(this.home.x * 0.1, this.time * 0.08, 1) * 0.4 + reef.current[0] * 0.35 + (this.home.x - p.x) * 0.02;
    const nz = noise3(this.home.z * 0.1, this.time * 0.08, 7) * 0.4 + reef.current[1] * 0.35 + (this.home.z - p.z) * 0.02;
    p.x += nx * dt;
    p.z += nz * dt;
    p.y += this.vy * dt;
    const floorY = floorHeight(p.x, p.z) + 4;
    if (p.y < floorY) this.vy += (floorY - p.y) * dt * 2;
    if (p.y > 27) this.vy -= (p.y - 27) * dt * 2;
    // tentacles trail opposite the sideways motion
    this.mesh.morphTargetInfluences[1] = Math.min(1, Math.hypot(nx, nz) * 1.6);
    this.root.rotation.y = Math.atan2(-nz, nx);
    this.root.rotation.z = 0.15 * Math.sin(this.time * 0.7 + this.phase);

    // three-color throb, brighter at night
    const t = (this.time * 0.25 + this.phase) % 3;
    const i = Math.floor(t);
    this._c.copy(THROB[i]).lerp(THROB[(i + 1) % 3], t - i);
    this.mat.emissive.copy(this._c);
    this.mat.emissiveIntensity = (0.35 + 1.6 * reef.night) * (0.75 + 0.25 * eased);
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 4, p.y + 1, p.z + 4, p.x, p.y - 0.5, p.z];
  }
}

let jellyCount = 0;
/** make a group of jellyfish around a point */
export function makeJellies(count, cx, cy, cz, spread, seed = 1) {
  const geometry = jellyGeometry();
  const rng = makeRng(seed);
  const list = [];
  for (let k = 0; k < count; k++) {
    const x = cx + (rng() - 0.5) * spread;
    const z = cz + (rng() - 0.5) * spread;
    const y = Math.max(cy + (rng() - 0.5) * 6, floorHeight(x, z) + 5);
    list.push(new Jellyfish({ geometry, x, y, z, seed: seed * 100 + k, name: `Jellyfish ${++jellyCount}` }));
  }
  return list;
}
