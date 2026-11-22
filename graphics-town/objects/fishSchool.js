// @ts-check
/**
 * The fish school - boids that can swim into a shape the user draws.
 *
 * This grows out of the Workbook 2 boids (ants with cheese and poop):
 *   - the classic three rules: separation, alignment, cohesion
 *   - food pellets attract the fish (like the cheese)
 *   - the shark scares them away (like the poop)
 *   - plus: stay in the school's region, stay off the sea floor, steer around
 *     buildings, a little noise "wander", and the water current.
 *
 * Shape mode: every fish is given its own target point on the shape. The
 * flocking forces are turned down, a "seek" force pulls each fish to its target,
 * and when it gets there it circles the target slowly so the shape shimmers.
 * A scared fish (shark nearby) ignores its target for a moment, then returns.
 *
 * Performance (Workbook 6 ideas):
 *   - neighbors are found with a uniform spatial grid, not by checking every pair
 *   - ALL fish are drawn with ONE InstancedMesh draw call
 *   - the CPU only uploads a position + direction per fish; the vertex shader
 *     (TSL) builds each fish's orientation from its direction and wiggles the
 *     tail with a per-fish phase. (In three r180 a positionNode runs after the
 *     instance matrix, so we leave the instance matrices at identity and do the
 *     placement ourselves in the shader.)
 */

import * as T from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  Fn, vec3, float, sin, cross, normalize, smoothstep, positionGeometry,
  instancedDynamicBufferAttribute, instancedBufferAttribute, uniform,
} from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { reef } from "./reefState.js";
import { uTime, uNight } from "./shaders.js";
import { makeRng, noise3 } from "./util/noise.js";
import { SCHOOL_CENTER, SCHOOL_EXTENT, OBSTACLES, SHAPE_CENTER, SHAPE_SIZE } from "./layout.js";

/** fish body built along +Z (nose at +Z), about 1 unit long */
export function makeFishGeometry() {
  const body = new T.SphereGeometry(0.5, 12, 8);
  body.scale(0.32, 0.55, 1.0);
  const tail = new T.ConeGeometry(0.34, 0.5, 4);
  tail.rotateX(Math.PI / 2); // tip -> +Z (joins the body)
  tail.scale(0.12, 1, 1);
  tail.translate(0, 0, -0.62);
  const dorsal = new T.ConeGeometry(0.16, 0.36, 3);
  dorsal.scale(0.15, 1, 1.4);
  dorsal.translate(0, 0.3, -0.05);
  return mergeGeometries([body, tail, dorsal]);
}

/** the tail wiggle: bend x more and more toward the tail, as a traveling wave */
const wiggle = Fn(([p, phase, freq]) => {
  const amount = smoothstep(float(0.35), float(-1.0), p.z).mul(0.28);
  const bend = sin(uTime.mul(freq).add(phase).add(p.z.mul(3.0))).mul(amount);
  return vec3(p.x.add(bend), p.y, p.z);
});

// a school of yellow and silver reef fish - bright so they read against the blue water
const FISH_COLORS = [0xffd23f, 0xffc42e, 0xffe27a, 0xf4f8fa, 0xe2eef4, 0xffb627];

export class FishSchool extends GrObject {
  /**
   * @param {Object} [params]
   * @param {number} [params.count=320]
   * @param {string} [params.name]
   */
  constructor(params = {}) {
    const N = params.count ?? 400;
    const root = new T.Group();
    const rng = makeRng(2026);

    // --- per-fish simulation state
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const dir = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const scale = new Float32Array(N);
    const color = new Float32Array(N * 3);
    const c = new T.Color();
    for (let i = 0; i < N; i++) {
      pos[i * 3] = SCHOOL_CENTER[0] + (rng() - 0.5) * 20;
      pos[i * 3 + 1] = SCHOOL_CENTER[1] + (rng() - 0.5) * 6;
      pos[i * 3 + 2] = SCHOOL_CENTER[2] + (rng() - 0.5) * 20;
      const a = rng() * Math.PI * 2;
      vel[i * 3] = Math.cos(a) * 3;
      vel[i * 3 + 2] = Math.sin(a) * 3;
      dir[i * 3] = Math.cos(a);
      dir[i * 3 + 2] = Math.sin(a);
      phase[i] = rng() * Math.PI * 2;
      scale[i] = 0.45 + rng() * 0.2;
      c.set(FISH_COLORS[Math.floor(rng() * FISH_COLORS.length)]);
      c.offsetHSL(0, 0, (rng() - 0.5) * 0.08);
      color.set([c.r, c.g, c.b], i * 3);
    }
    scale[0] = 0; // fish 0 is drawn by the LeadFish object instead

    // --- rendering: one instanced mesh, placed in the vertex shader
    const geometry = makeFishGeometry();
    const posAttr = new T.InstancedBufferAttribute(pos, 3);
    const dirAttr = new T.InstancedBufferAttribute(dir, 3);
    posAttr.setUsage(T.DynamicDrawUsage);
    dirAttr.setUsage(T.DynamicDrawUsage);
    const iPos = instancedDynamicBufferAttribute(posAttr, "vec3");
    const iDir = instancedDynamicBufferAttribute(dirAttr, "vec3");
    const iPhase = instancedBufferAttribute(new T.InstancedBufferAttribute(phase, 1), "float");
    const scaleAttr = new T.InstancedBufferAttribute(scale, 1);
    const iScale = instancedBufferAttribute(scaleAttr, "float");
    const iColor = instancedBufferAttribute(new T.InstancedBufferAttribute(color, 3), "vec3");

    const uGlow = uniform(0.0); // extra glow while holding a shape

    const material = new MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.15, flatShading: true });
    material.positionNode = Fn(() => {
      const p = wiggle(positionGeometry, iPhase, float(9.0));
      // build the fish's frame from its swimming direction
      const fwd = normalize(iDir);
      const right = normalize(cross(vec3(0, 1, 0), fwd));
      const up = cross(fwd, right);
      return iPos.add(right.mul(p.x).add(up.mul(p.y)).add(fwd.mul(p.z)).mul(iScale));
    })();
    material.colorNode = iColor;
    // bioluminescence: glow at night, brighter while they hold a shape
    material.emissiveNode = vec3(0.25, 0.85, 1.0).mul(uNight.mul(0.55).add(uGlow.mul(uNight).mul(0.9)));

    const mesh = new T.InstancedMesh(geometry, material, N);
    mesh.frustumCulled = false; // the instance matrices are identity, so bounds are meaningless
    root.add(mesh);

    // --- food pellets
    const MAX_FOOD = 80;
    const foodMesh = new T.InstancedMesh(
      new T.IcosahedronGeometry(0.12, 0),
      new T.MeshStandardMaterial({ color: 0xd9823b, roughness: 0.8, emissive: 0x5a2a00, emissiveIntensity: 0.3 }),
      MAX_FOOD
    );
    foodMesh.count = 0;
    foodMesh.frustumCulled = false;
    root.add(foodMesh);

    super(params.name ?? "Fish School", root);

    this.N = N;
    this.pos = pos;
    this.vel = vel;
    this.dir = dir;
    this.phase = phase;
    this.posAttr = posAttr;
    this.dirAttr = dirAttr;
    this.uGlow = uGlow;
    this.mesh = mesh;
    this.rng = rng;
    /** per-fish target (only used in shape mode) */
    this.target = new Float32Array(N * 3);
    /** seconds of panic left per fish (shark nearby) */
    this.panic = new Float32Array(N);
    /** @type {"free"|"shape"} */
    this.mode = "free";
    this.shapeTimer = 0;
    this.shapeHold = 40; // seconds before the school lets go on its own
    this.time = 0;
    /** @type {Array<{x:number,y:number,z:number,size:number,vy:number,phase:number}>} */
    this.food = [];
    this.foodMesh = foodMesh;
    this.MAX_FOOD = MAX_FOOD;
    this.cellSize = 2.6;
    /** @type {Map<number, number[]>} */
    this.grid = new Map();
    this._m = new T.Matrix4();
  }

  /**
   * Swim into a shape.
   * @param {Array<[number, number]>} pts2d - N points, roughly within [-0.5, 0.5]^2 (y up)
   * @param {T.Camera} [camera] - the shape forms in front of this camera, facing it
   */
  formShape(pts2d, camera) {
    const N = this.N;
    let S = SHAPE_SIZE;
    const center = new T.Vector3(...SHAPE_CENTER);
    // the shape's plane: by default it faces +z
    const normal = new T.Vector3(0, 0, 1);
    const right = new T.Vector3(1, 0, 0);
    const up = new T.Vector3(0, 1, 0);
    if (camera) {
      // put the shape ~30 units in front of the camera, facing it squarely, so it
      // looks on screen the way it was drawn
      const eye = camera.getWorldPosition(new T.Vector3());
      const look = camera.getWorldDirection(new T.Vector3());
      const camUp = new T.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new T.Quaternion()));
      right.crossVectors(look, camUp).normalize();
      up.crossVectors(right, look).normalize();
      normal.copy(look).negate();
      // Fit the shape at distance D: its bottom must stay above the rooftops and
      // its top must stay inside the view. With h = how far we slide the center
      // "up" (in screen space):
      //    bottom: base.y + (h - S/2) * up.y >= minBottom  ->  h >= need + S/2
      //    top:    h + S/2 <= halfView
      // so S <= halfView - need, and then h = need + S/2.
      const D = 34;
      const fov = /** @type {any} */ (camera).fov ?? 45;
      const halfView = Math.tan((fov * Math.PI) / 360) * D * 0.9;
      const base = eye.clone().addScaledVector(look, D);
      const minBottom = Math.max(0, floorHeight(base.x, base.z)) + 7.5;
      const need = (minBottom - base.y) / Math.max(0.2, up.y);
      S = Math.max(9, Math.min(SHAPE_SIZE, halfView - need));
      const h = Math.max(0, need + S / 2);
      center.copy(base).addScaledVector(up, h);
      center.x = Math.max(-40, Math.min(40, center.x));
      center.z = Math.max(-40, Math.min(40, center.z));
      center.y = Math.min(32, center.y);
    }
    this.shapeCenter = center;
    const targets = [];
    for (let k = 0; k < N; k++) {
      const [u, v] = pts2d[k % pts2d.length];
      const depth = (this.rng() - 0.5) * 0.8;
      targets.push(
        new T.Vector3()
          .copy(center)
          .addScaledVector(right, u * S)
          .addScaledVector(up, v * S)
          .addScaledVector(normal, depth)
      );
    }
    // greedy assignment: each target (in random order) takes the nearest free fish,
    // so fish don't cross the whole school to reach their spot
    const taken = new Uint8Array(N);
    const order = targets.map((_, i) => i).sort(() => this.rng() - 0.5);
    for (const ti of order) {
      const t = targets[ti];
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < N; i++) {
        if (taken[i]) continue;
        const dx = this.pos[i * 3] - t.x;
        const dy = this.pos[i * 3 + 1] - t.y;
        const dz = this.pos[i * 3 + 2] - t.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      taken[best] = 1;
      this.target.set([t.x, t.y, t.z], best * 3);
    }
    this.mode = "shape";
    this.shapeTimer = 0;
  }

  /** let go of the shape: burst outward and go back to flocking */
  release() {
    if (this.mode !== "shape") return;
    this.mode = "free";
    const { x: cx, y: cy, z: cz } = this.shapeCenter ?? new T.Vector3(...SHAPE_CENTER);
    for (let i = 0; i < this.N; i++) {
      const dx = this.pos[i * 3] - cx;
      const dy = this.pos[i * 3 + 1] - cy;
      const dz = this.pos[i * 3 + 2] - cz;
      const d = Math.hypot(dx, dy, dz) || 1;
      this.vel[i * 3] += (dx / d) * 4;
      this.vel[i * 3 + 1] += (dy / d) * 2;
      this.vel[i * 3 + 2] += (dz / d) * 4;
    }
  }

  /**
   * drop a little cloud of food at a point
   * @param {number} x @param {number} y @param {number} z
   */
  dropFood(x, y, z) {
    for (let k = 0; k < 18 && this.food.length < this.MAX_FOOD; k++) {
      this.food.push({
        x: x + (this.rng() - 0.5) * 2.5,
        y: y + (this.rng() - 0.5) * 1.5,
        z: z + (this.rng() - 0.5) * 2.5,
        size: 1,
        vy: -0.25 - this.rng() * 0.2,
        phase: this.rng() * 6,
      });
    }
  }

  /** key for the spatial grid cell containing a point */
  cellKey(ix, iy, iz) {
    return ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    let dt = Math.min(delta, 100) / 1000;
    if (dt <= 0) return;
    // two half steps when the frame is long, for stability
    const sub = dt > 0.034 ? 2 : 1;
    dt /= sub;
    for (let s = 0; s < sub; s++) this.simulate(dt);

    this.updateFood(dt * sub);
    this.posAttr.needsUpdate = true;
    this.dirAttr.needsUpdate = true;

    // glow while holding a shape
    const wantGlow = this.mode === "shape" ? 1 : 0;
    this.uGlow.value += (wantGlow - this.uGlow.value) * Math.min(1, dt * sub * 1.5);

    if (this.mode === "shape") {
      this.shapeTimer += dt * sub;
      if (this.shapeTimer > this.shapeHold) this.release();
    }
  }

  /** @param {number} dt */
  simulate(dt) {
    const N = this.N;
    const { pos, vel, dir, target, panic } = this;
    this.time += dt;
    const t = this.time;

    // --- build the spatial grid
    const cs = this.cellSize;
    const grid = this.grid;
    grid.clear();
    for (let i = 0; i < N; i++) {
      const key = this.cellKey(Math.floor(pos[i * 3] / cs), Math.floor(pos[i * 3 + 1] / cs), Math.floor(pos[i * 3 + 2] / cs));
      let cell = grid.get(key);
      if (!cell) grid.set(key, (cell = []));
      cell.push(i);
    }

    const shark = reef.objects.shark;
    const sharkPos = shark ? shark.getPosition() : null;
    const shapeMode = this.mode === "shape";
    const [cxS, cyS, czS] = SCHOOL_CENTER;
    const [exS, eyS, ezS] = SCHOOL_EXTENT;
    const neighborR2 = cs * cs;
    const sepR = 0.95;
    const maxSpeed = 6;

    for (let i = 0; i < N; i++) {
      const ix = i * 3;
      const px = pos[ix], py = pos[ix + 1], pz = pos[ix + 2];
      const vx = vel[ix], vy = vel[ix + 1], vz = vel[ix + 2];
      let ax = 0, ay = 0, az = 0;

      // --- neighbors (27 cells around this fish)
      let sepX = 0, sepY = 0, sepZ = 0;
      let aliX = 0, aliY = 0, aliZ = 0;
      let cohX = 0, cohY = 0, cohZ = 0;
      let count = 0;
      const gx = Math.floor(px / cs), gy = Math.floor(py / cs), gz = Math.floor(pz / cs);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            const cell = this.grid.get(this.cellKey(gx + ox, gy + oy, gz + oz));
            if (!cell) continue;
            for (const j of cell) {
              if (j === i) continue;
              const dx = px - pos[j * 3], dy = py - pos[j * 3 + 1], dz = pz - pos[j * 3 + 2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > neighborR2) continue;
              count++;
              aliX += vel[j * 3]; aliY += vel[j * 3 + 1]; aliZ += vel[j * 3 + 2];
              cohX += pos[j * 3]; cohY += pos[j * 3 + 1]; cohZ += pos[j * 3 + 2];
              if (d2 < sepR * sepR && d2 > 1e-6) {
                const inv = 1 / d2;
                sepX += dx * inv; sepY += dy * inv; sepZ += dz * inv;
              }
            }
          }
        }
      }

      const seeking = shapeMode && panic[i] <= 0;
      const wSep = seeking ? 2.5 : 6;
      const wAli = seeking ? 0.1 : 1.1;
      const wCoh = seeking ? 0 : 0.7;
      ax += sepX * wSep; ay += sepY * wSep; az += sepZ * wSep;
      if (count > 0) {
        ax += (aliX / count - vx) * wAli;
        ay += (aliY / count - vy) * wAli;
        az += (aliZ / count - vz) * wAli;
        ax += (cohX / count - px) * wCoh;
        ay += (cohY / count - py) * wCoh;
        az += (cohZ / count - pz) * wCoh;
      }

      if (seeking) {
        // --- seek my spot on the shape, circling it slowly once there
        const orbit = 0.35;
        const tx = target[ix] + orbit * Math.cos(t * 1.3 + this.phase[i]);
        const ty = target[ix + 1] + orbit * Math.sin(t * 1.3 + this.phase[i]);
        const tz = target[ix + 2];
        const dx = tx - px, dy = ty - py, dz = tz - pz;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const want = Math.min(maxSpeed, d * 1.6 + 0.4);
        ax += ((dx / d) * want - vx) * 3.2;
        ay += ((dy / d) * want - vy) * 3.2;
        az += ((dz / d) * want - vz) * 3.2;
      } else {
        // --- stay in the school's home region
        const bx = px - cxS, by = py - cyS, bz = pz - czS;
        if (Math.abs(bx) > exS) ax -= Math.sign(bx) * (Math.abs(bx) - exS) * 1.5;
        if (Math.abs(by) > eyS) ay -= Math.sign(by) * (Math.abs(by) - eyS) * 1.5;
        if (Math.abs(bz) > ezS) az -= Math.sign(bz) * (Math.abs(bz) - ezS) * 1.5;

        // --- wander (smooth noise) and the current
        ax += noise3(px * 0.06, py * 0.06, t * 0.15 + 3) * 2.2 + reef.current[0] * 0.5;
        ay += noise3(px * 0.06 + 50, py * 0.06, t * 0.15) * 0.8;
        az += noise3(px * 0.06, pz * 0.06 + 90, t * 0.15) * 2.2 + reef.current[1] * 0.5;

        // --- food attracts (like the cheese in the WB2 boids)
        let best = null;
        let bestD = 22;
        for (const f of this.food) {
          const d = Math.hypot(f.x - px, f.y - py, f.z - pz);
          if (d < bestD) { bestD = d; best = f; }
        }
        if (best) {
          const d = bestD || 1e-6;
          ax += ((best.x - px) / d * maxSpeed - vx) * 1.6;
          ay += ((best.y - py) / d * maxSpeed - vy) * 1.6;
          az += ((best.z - pz) / d * maxSpeed - vz) * 1.6;
          if (d < 0.8) best.size -= dt * 0.06; // nibble (slowly, so the swarm lasts)
        }
      }

      // --- the shark scares fish away (like the poop in the WB2 boids)
      if (sharkPos) {
        const dx = px - sharkPos.x, dy = py - sharkPos.y, dz = pz - sharkPos.z;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const fearR = 9;
        if (d < fearR) {
          const k = ((fearR - d) / fearR) * 26;
          ax += (dx / d) * k; ay += (dy / d) * k * 0.6; az += (dz / d) * k;
          panic[i] = 1.6;
        }
      }
      if (panic[i] > 0) panic[i] -= dt;

      // --- stay above the sea floor
      const fh = floorHeight(px, pz);
      if (py < fh + 2.5) ay += (fh + 2.5 - py) * 8;

      // --- steer around buildings (vertical cylinders) - not needed while holding
      // a shape, since shapes are kept above the rooftops
      if (!seeking) for (const [ox, oz, r, h] of OBSTACLES) {
        if (py > h + 1.5) continue;
        const dx = px - ox, dz = pz - oz;
        const d = Math.hypot(dx, dz) || 1e-6;
        if (d < r + 1.5) {
          const k = (r + 1.5 - d) * 10;
          ax += (dx / d) * k; az += (dz / d) * k;
          ay += 2; // and swim up over it
        }
      }

      // --- integrate: limit the force, then the speed
      const amag = Math.hypot(ax, ay, az);
      const maxForce = seeking ? 22 : 14;
      if (amag > maxForce) {
        ax *= maxForce / amag; ay *= maxForce / amag; az *= maxForce / amag;
      }
      let nvx = vx + ax * dt, nvy = vy + ay * dt, nvz = vz + az * dt;
      // fish don't swim straight up or down
      nvy *= 0.98;
      let sp = Math.hypot(nvx, nvy, nvz) || 1e-6;
      const minSpeed = seeking ? 0.2 : 1.8;
      const topSpeed = panic[i] > 0 ? maxSpeed * 1.5 : maxSpeed;
      const clamped = Math.min(topSpeed, Math.max(minSpeed, sp));
      nvx *= clamped / sp; nvy *= clamped / sp; nvz *= clamped / sp;
      sp = clamped;
      vel[ix] = nvx; vel[ix + 1] = nvy; vel[ix + 2] = nvz;
      pos[ix] = px + nvx * dt;
      pos[ix + 1] = Math.max(fh + 0.6, py + nvy * dt);
      pos[ix + 2] = pz + nvz * dt;

      // --- smoothed facing direction (kept fairly level)
      const k = Math.min(1, dt * 6);
      let dx = dir[ix] + (nvx / sp - dir[ix]) * k;
      let dy = dir[ix + 1] + (nvy / sp - dir[ix + 1]) * k;
      let dz = dir[ix + 2] + (nvz / sp - dir[ix + 2]) * k;
      dy = Math.max(-0.6, Math.min(0.6, dy));
      const dl = Math.hypot(dx, dy, dz) || 1;
      dir[ix] = dx / dl; dir[ix + 1] = dy / dl; dir[ix + 2] = dz / dl;
    }
  }

  /** @param {number} dt */
  updateFood(dt) {
    for (const f of this.food) {
      f.y += f.vy * dt;
      f.x += Math.sin(this.time * 1.5 + f.phase) * 0.15 * dt;
      const fh = floorHeight(f.x, f.z);
      if (f.y < fh + 0.1) {
        f.y = fh + 0.1;
        f.size -= dt * 0.08; // food on the floor slowly dissolves
      }
    }
    this.food = this.food.filter(f => f.size > 0.05);
    const m = this._m;
    this.food.forEach((f, k) => {
      m.makeScale(f.size, f.size, f.size).setPosition(f.x, f.y, f.z);
      this.foodMesh.setMatrixAt(k, m);
    });
    this.foodMesh.count = this.food.length;
    this.foodMesh.instanceMatrix.needsUpdate = true;
  }

  lookFromLookAt() {
    // look at the center of the school
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < this.N; i++) {
      x += this.pos[i * 3]; y += this.pos[i * 3 + 1]; z += this.pos[i * 3 + 2];
    }
    x /= this.N; y /= this.N; z /= this.N;
    return [x, y + 8, z + 26, x, y, z];
  }
}

/**
 * The lead fish: fish #0 of the school, drawn separately (golden) so that it can
 * be ridden - riding hides the object being ridden, and we want to still see
 * the rest of the school around us.
 */
export class LeadFish extends GrObject {
  /** @param {FishSchool} school */
  constructor(school) {
    const root = new T.Group();
    const material = new MeshStandardNodeMaterial({ color: 0xffc23a, roughness: 0.3, metalness: 0.5, flatShading: true });
    material.positionNode = wiggle(positionGeometry, float(0), float(9.0));
    material.emissiveNode = vec3(1.0, 0.7, 0.2).mul(uNight.mul(0.8).add(0.08));
    const mesh = new T.Mesh(makeFishGeometry(), material);
    mesh.scale.setScalar(0.62);
    root.add(mesh);
    // rider sits just above the head, looking forward
    const seat = new T.Object3D();
    seat.position.set(0, 0.35, 0.3);
    root.add(seat);
    super("Lead Fish Goldie", root);
    this.school = school;
    this.root = root;
    this.rideable = seat;
    this.update0();
  }

  update0() {
    const p = this.school.pos;
    const d = this.school.dir;
    this.root.position.set(p[0], p[1], p[2]);
    this.root.lookAt(p[0] + d[0], p[1] + d[1], p[2] + d[2]);
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    this.update0();
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 3, p.y + 1.5, p.z + 3, p.x, p.y, p.z];
  }
}
