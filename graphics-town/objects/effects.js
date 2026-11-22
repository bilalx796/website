// @ts-check
/**
 * Particle effects and small living things on the sea floor.
 *
 *  HydrothermalVents  - rocky chimneys with glowing hot mouths
 *  Bubbles            - a particle system: bubbles are emitted from the vents,
 *                       the wreck, the domes' air vents and the submarine's
 *                       propeller; they rise, wobble, grow and pop at the
 *                       surface (like the WB1 fireworks: spawn, move, age, die)
 *  MarineSnow         - drifting specks that always surround the camera (they
 *                       wrap around in a box centered on the camera), which
 *                       makes the water feel deep
 *  Anemones           - instanced anemones whose tentacles sway in a TSL vertex
 *                       shader (the sway grows with height along the tentacle)
 *                       and whose tips glow at night
 */

import * as T from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { vec3, sin, positionLocal, positionGeometry, float, smoothstep } from "three/tsl";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { isFree } from "./placement.js";
import { reef } from "./reefState.js";
import { waterEnvMap } from "./materials.js";
import { makeRng, noise3 } from "./util/noise.js";
import { uTime, uNight } from "./shaders.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export class HydrothermalVents extends GrObject {
  /** @param {Array<[number, number]>} spots */
  constructor(spots) {
    const root = new T.Group();
    const rock = new T.MeshStandardMaterial({ color: 0x3b3430, roughness: 1, flatShading: true });
    const hot = new T.MeshStandardMaterial({ color: 0xff7a2a, emissive: 0xff5a10, emissiveIntensity: 1.5 });
    /** @type {Array<T.Vector3>} */
    const mouths = [];
    const rng = makeRng(9);
    spots.forEach(([x, z]) => {
      const h = 2 + rng() * 2.5;
      const y = floorHeight(x, z);
      const chimney = new T.Mesh(new T.CylinderGeometry(0.35, 1.1, h, 9, 4), rock);
      // lumpy: push vertices around
      const p = chimney.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        p.setX(i, p.getX(i) * (1 + 0.2 * noise3(p.getX(i) * 2, p.getY(i) * 2, x)));
        p.setZ(i, p.getZ(i) * (1 + 0.2 * noise3(p.getZ(i) * 2, p.getY(i) * 2, z)));
      }
      chimney.geometry.computeVertexNormals();
      chimney.position.set(x, y + h / 2 - 0.2, z);
      root.add(chimney);
      const mouth = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 0.05, 10), hot);
      mouth.position.set(x, y + h - 0.18, z);
      root.add(mouth);
      mouths.push(new T.Vector3(x, y + h - 0.1, z));
    });
    // a warm light among the vents
    const glow = new T.PointLight(0xff7030, 8, 14, 1.5);
    glow.position.set(spots[0][0] + 1, floorHeight(spots[0][0], spots[0][1]) + 3, spots[0][1] + 2);
    root.add(glow);
    super("Hydrothermal Vents", root);
    this.mouths = mouths;
    this.hot = hot;
    this.time = 0;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    this.time += Math.min(delta, 100) / 1000;
    this.hot.emissiveIntensity = 1.2 + 0.5 * Math.sin(this.time * 3) + 0.3 * noise3(this.time, 0, 0);
  }

  lookFromLookAt() {
    const m = this.mouths[0];
    return [m.x - 8, m.y + 4, m.z + 8, m.x, m.y - 1, m.z];
  }
}

/**
 * The bubble particle system.
 */
export class Bubbles extends GrObject {
  /**
   * @param {Object} p
   * @param {Array<{pos: () => T.Vector3, rate: number, spread: number}>} p.emitters
   * @param {number} [p.max=700]
   */
  constructor(p) {
    const max = p.max ?? 700;
    const mat = new T.MeshStandardMaterial({
      color: 0xe8fbff, metalness: 0.6, roughness: 0.05, transparent: true, opacity: 0.5,
      envMap: waterEnvMap(), emissive: 0x8fe8ff, emissiveIntensity: 0.15, depthWrite: false,
    });
    const mesh = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8), mat, max);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 9;
    super("Bubbles", mesh);
    this.mesh = mesh;
    this.max = max;
    this.emitters = p.emitters.map(e => ({ ...e, acc: 0 }));
    /** @type {Array<{x:number,y:number,z:number,r:number,vy:number,ph:number,age:number}>} */
    this.list = [];
    this.rng = makeRng(123);
    this.time = 0;
    this._m = new T.Matrix4();
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    // emit
    for (const e of this.emitters) {
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        if (this.list.length >= this.max) break;
        const o = e.pos();
        if (!o) continue;
        this.list.push({
          x: o.x + (this.rng() - 0.5) * e.spread,
          y: o.y,
          z: o.z + (this.rng() - 0.5) * e.spread,
          r: 0.04 + this.rng() * 0.1,
          vy: 1.2 + this.rng() * 1.4,
          ph: this.rng() * 6,
          age: 0,
        });
      }
    }
    // move: rise, wobble, drift with the current, grow (less pressure higher up)
    for (const b of this.list) {
      b.age += dt;
      b.y += b.vy * dt;
      b.x += (Math.sin(this.time * 4 + b.ph) * 0.3 + reef.current[0] * 0.4) * dt;
      b.z += (Math.cos(this.time * 3.3 + b.ph) * 0.3 + reef.current[1] * 0.4) * dt;
      b.r *= 1 + dt * 0.03;
    }
    // pop at the surface
    this.list = this.list.filter(b => b.y < 33.5 && b.age < 30);
    this.list.forEach((b, i) => {
      const squash = 1 + 0.15 * Math.sin(this.time * 9 + b.ph);
      this._m.makeScale(b.r * squash, b.r / squash, b.r * squash).setPosition(b.x, b.y, b.z);
      this.mesh.setMatrixAt(i, this._m);
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  lookFromLookAt() {
    return [44, 12, 36, 33, 8, 22];
  }
}

/**
 * Marine snow: specks drifting down, wrapped in a box around the camera.
 */
export class MarineSnow extends GrObject {
  /** @param {import("CS559-Framework/GrWorld.js").GrWorld} world @param {number} [count=1400] */
  constructor(world, count = 1400) {
    const mesh = new T.InstancedMesh(
      new T.TetrahedronGeometry(0.05, 0),
      new T.MeshBasicMaterial({ color: 0xe9f7f2, transparent: true, opacity: 0.55 }),
      count
    );
    mesh.frustumCulled = false;
    super("Marine Snow", mesh);
    this.world = world;
    this.mesh = mesh;
    this.count = count;
    this.box = 44;
    const rng = makeRng(17);
    this.p = new Float32Array(count * 3);
    this.ph = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.p[i * 3] = (rng() - 0.5) * this.box;
      this.p[i * 3 + 1] = (rng() - 0.5) * this.box;
      this.p[i * 3 + 2] = (rng() - 0.5) * this.box;
      this.ph[i] = rng() * 6;
    }
    this.time = 0;
    this._m = new T.Matrix4();
    this._q = new T.Quaternion();
    this._cam = new T.Vector3();
    this._s = new T.Vector3();
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;
    const cam = this.world.active_camera.getWorldPosition(this._cam);
    const B = this.box;
    const wrap = (v, c) => c + ((((v - c + B / 2) % B) + B) % B) - B / 2;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.p[k] += (reef.current[0] * 0.3 + 0.08 * Math.sin(this.time * 0.5 + this.ph[i])) * dt;
      this.p[k + 1] -= 0.12 * dt;
      this.p[k + 2] += reef.current[1] * 0.3 * dt;
      const x = wrap(this.p[k], cam.x);
      const y = wrap(this.p[k + 1], cam.y);
      const z = wrap(this.p[k + 2], cam.z);
      this._q.setFromAxisAngle(T.Object3D.DEFAULT_UP, this.time + this.ph[i]);
      // specks right in front of the lens would look huge - shrink them away
      const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      const s = Math.min(1, Math.max(0, (d - 2) / 4));
      this._m.makeRotationFromQuaternion(this._q).scale(this._s.set(s, s, s)).setPosition(x, Math.min(y, 33), z);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  lookFromLookAt() {
    const c = this.world.camera.position;
    return [c.x, c.y, c.z, 0, 4, 0];
  }
}

/** one anemone: a short column with a crown of tentacles; y up, base at 0 */
function anemoneGeometry() {
  const parts = [];
  const column = new T.CylinderGeometry(0.32, 0.4, 0.4, 14, 1);
  column.translate(0, 0.2, 0);
  parts.push(column.toNonIndexed());
  const rng = makeRng(4);
  for (let k = 0; k < 34; k++) {
    const ring = k < 14 ? 0.28 : k < 26 ? 0.18 : 0.08;
    const a = rng() * Math.PI * 2;
    const len = 0.5 + rng() * 0.35;
    const t = new T.CylinderGeometry(0.018, 0.035, len, 5, 5);
    t.translate(0, len / 2, 0);
    t.rotateZ(0.25 + (ring / 0.28) * 0.5);
    t.rotateY(a);
    t.translate(Math.cos(a) * ring, 0.38, -Math.sin(a) * ring);
    parts.push(t.toNonIndexed());
  }
  for (const pp of parts) for (const n of Object.keys(pp.attributes)) if (!["position", "normal", "uv"].includes(n)) pp.deleteAttribute(n);
  return mergeGeometries(parts);
}

export class Anemones extends GrObject {
  /** @param {number} [count=40] */
  constructor(count = 40) {
    const geo = anemoneGeometry();
    const mat = new MeshStandardNodeMaterial({ roughness: 0.5 });
    // sway: positionLocal is already placed by the instance matrix (three r180);
    // positionGeometry.y is the height within one anemone, so sway grows toward the tips.
    const h = smoothstep(float(0.38), float(1.2), positionGeometry.y);
    const phase = positionLocal.x.mul(0.7).add(positionLocal.z.mul(0.5));
    const sway = vec3(
      sin(uTime.mul(1.6).add(phase).add(positionGeometry.y.mul(4))).mul(h).mul(0.18),
      float(0),
      sin(uTime.mul(1.3).add(phase.mul(1.3)).add(positionGeometry.y.mul(3))).mul(h).mul(0.18)
    );
    mat.positionNode = positionLocal.add(sway);
    // tips glow softly at night
    mat.emissiveNode = vec3(0.9, 0.5, 1.0).mul(h).mul(uNight.mul(0.9).add(0.05));
    const mesh = new T.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    const rng = makeRng(2468);
    const colors = [0xff7aa8, 0xb18cff, 0x6fe3c8, 0xffb36b, 0xf2f27a];
    const m = new T.Matrix4();
    const c = new T.Color();
    let placed = 0;
    const centers = [[18, 14], [-19, -12], [9, -22], [-27, 6], [4, 27], [23, -3]];
    for (let tries = 0; placed < count && tries < 3000; tries++) {
      const cc = centers[Math.floor(rng() * centers.length)];
      const a = rng() * Math.PI * 2;
      const d = 2 + rng() * 8;
      const x = cc[0] + Math.cos(a) * d;
      const z = cc[1] + Math.sin(a) * d;
      if (!isFree(x, z, 0.3)) continue;
      const s = 0.8 + rng() * 0.9;
      m.compose(new T.Vector3(x, floorHeight(x, z) - 0.05, z), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), rng() * 6), new T.Vector3(s, s, s));
      mesh.setMatrixAt(placed, m);
      c.set(colors[Math.floor(rng() * colors.length)]);
      mesh.setColorAt(placed, c);
      placed++;
    }
    mesh.count = placed;
    super("Sea Anemones", mesh);
  }

  lookFromLookAt() {
    return [24, 5, 20, 18, 0, 14];
  }
}
