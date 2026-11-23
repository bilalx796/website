// @ts-check
/**
 * Walk around Coralhaven in FIRST PERSON as one of the residents.
 *
 *   ↑ / W  walk forward     ↓ / S  walk back      ← →  turn
 *   A / D  sidestep         Space  jump           Shift  run
 *   mouse drag  look around (up / down too)       Esc  stop walking
 *
 * The explorer is a rideable GrObject, so walking uses the framework's own
 * "Drive Object" camera: the camera sits at the explorer's eyes. We turn the
 * explorer for left/right looking and tilt the eye ("seat") for up/down.
 *
 * Where you can stand: the ground height under you is the highest of
 *   - the sea floor (terrain function)
 *   - a dome's floor, if you are inside a dome
 *   - a station platform, if you are on one
 *   - the floor of a glass walkway, if you are in one
 * and the dome glass is SOLID: you can only cross a dome's wall through its
 * airlock (whose doors open for you).
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { makePerson } from "./habitats.js";
import { PLATFORM_HALF_WIDTH } from "./tram.js";

const EYE = 0.62;
const GRAVITY = 9;

export class Explorer extends GrObject {
  /**
   * @param {Object} p
   * @param {Array<import("./habitats.js").HabitatDome>} p.domes
   * @param {Array<import("./transit.js").Link>} p.links
   * @param {Array<{walk: T.Vector3[], half: number}>} p.corridors - walkable corridor floors
   */
  constructor(p) {
    const root = new T.Group();
    const body = makePerson(0xffd23f);
    root.add(body);
    // a little diving helmet, so the explorer stands out
    const helmet = new T.Mesh(
      new T.SphereGeometry(0.16, 14, 10),
      new T.MeshStandardMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.45, metalness: 0.6, roughness: 0.1 })
    );
    helmet.position.y = 0.6;
    body.add(helmet);
    const eye = new T.Object3D();
    eye.position.set(0, EYE, 0.05);
    root.add(eye);
    super("Explorer (you)", root);
    this.root = root;
    this.eye = eye;
    this.rideable = eye;
    this.domes = p.domes;
    this.links = p.links;
    this.corridors = p.corridors;
    // start in the cafeteria, in the aisle in front of the buffet, facing the tables
    const hall = p.domes[0];
    this.pos = hall.root.localToWorld(new T.Vector3(-1.6, 0.46, -1.3));
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.onGround = true;
    this.walkPhase = 0;
    /** set by the WalkController while you control the explorer */
    this.active = false;
    /** @type {{fwd: number, side: number, turn: number, jump: boolean, run: boolean}} */
    this.input = { fwd: 0, side: 0, turn: 0, jump: false, run: false };
    this.pos.y = this.groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
    this.place();
  }

  /** which dome (if any) contains a point horizontally, and how far in */
  domeAt(x, z) {
    for (const d of this.domes) {
      const dist = Math.hypot(x - d.root.position.x, z - d.root.position.z);
      if (dist < d.r - 0.25) return d;
    }
    return null;
  }

  /**
   * height of the ground under (x, z); `fromY` is our current height (so we land
   * on a walkway or platform only when we're near its level)
   */
  groundAt(x, z, fromY) {
    let g = floorHeight(x, z);
    const dome = this.domeAt(x, z);
    if (dome) g = Math.max(g, dome.root.position.y + 0.46);
    for (const l of this.links) {
      // platform: a rectangle beside the track
      const st = l.station;
      const rel = new T.Vector3(x - st.center.x, 0, z - st.center.z);
      if (Math.abs(rel.dot(st.along)) < 2.6 && Math.abs(rel.dot(st.inward)) < PLATFORM_HALF_WIDTH) {
        if (fromY > st.center.y - 0.6) g = Math.max(g, st.center.y);
      }
    }
    // corridor floors (dome-to-dome and dome-to-station): close to the path's polyline
    for (const c of this.corridors) {
      for (let k = 0; k < c.walk.length - 1; k++) {
        const a = c.walk[k], b = c.walk[k + 1];
        const abx = b.x - a.x, abz = b.z - a.z;
        const len2 = abx * abx + abz * abz || 1e-6;
        const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
        const px = a.x + abx * t, pz = a.z + abz * t;
        if (Math.hypot(x - px, z - pz) < c.half) {
          const y = a.y + (b.y - a.y) * t;
          if (fromY > y - 0.6) g = Math.max(g, y);
        }
      }
    }
    return g;
  }

  /** can we step from (ax, az) to (bx, bz)?  Dome glass is solid except at corridor openings. */
  canStep(ax, az, bx, bz) {
    for (const d of this.domes) {
      const cx = d.root.position.x, cz = d.root.position.z;
      const ra = Math.hypot(ax - cx, az - cz);
      const rb = Math.hypot(bx - cx, bz - cz);
      // furniture and machinery inside the hubs (you can always step OUT of an obstacle)
      if (d.blocked(bx, bz) && !d.blocked(ax, az)) return false;
      const wallIn = d.r - 0.25, wallOut = d.r + 0.45;
      const crossing = (ra < wallIn && rb >= wallIn) || (ra > wallOut && rb <= wallOut) || (rb > wallIn && rb < wallOut);
      if (!crossing) continue;
      // through one of the dome's openings? (the airlock or a corridor to another dome)
      const lx = bx - cx, lz = bz - cz;
      // (the station doorways are for residents only - you stay inside the hubs)
      const through = d.openings.find(o => {
        if (o.residentsOnly) return false;
        const along = lx * o.dir.x + lz * o.dir.z;
        const side = Math.abs(lx * o.dir.z - lz * o.dir.x);
        return along > 0 && side < o.half;
      });
      if (through) {
        continue;
      }
      return false;
    }
    return true;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    if (this.active) {
      const inp = this.input;
      this.yaw += inp.turn * 2.0 * dt;
      const speed = inp.run ? 3.4 : 1.7;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      let mx = (fx * inp.fwd + fz * -inp.side) * speed * dt;
      let mz = (fz * inp.fwd - fx * -inp.side) * speed * dt;
      // try the full step, then each axis on its own (slide along walls)
      const tryMove = (dx, dz) => {
        const nx = this.pos.x + dx, nz = this.pos.z + dz;
        if (!this.canStep(this.pos.x, this.pos.z, nx, nz)) return false;
        const g = this.groundAt(nx, nz, this.pos.y);
        if (g > this.pos.y + 0.45) return false; // too high to step up
        this.pos.x = nx;
        this.pos.z = nz;
        return true;
      };
      if (!tryMove(mx, mz)) {
        tryMove(mx, 0) || tryMove(0, mz);
        // near a dome wall and close to its airlock? funnel us into the doorway
        for (const d of this.domes) {
          const lx = this.pos.x - d.root.position.x, lz = this.pos.z - d.root.position.z;
          const dist = Math.hypot(lx, lz);
          if (Math.abs(dist - d.r) > 1.4) continue;
          for (const o of d.openings) {
            if (o.residentsOnly) continue;
            const along = lx * o.dir.x + lz * o.dir.z;
            const sideSigned = lx * o.dir.z - lz * o.dir.x;
            if (along > 0 && Math.abs(sideSigned) < 1.6) {
              const shift = -Math.sign(sideSigned) * Math.min(Math.abs(sideSigned), 1.5 * dt);
              // move sideways toward the opening's center line
              tryMove(o.dir.z * shift, -o.dir.x * shift);
            }
          }
        }
      }
      if (inp.jump && this.onGround) {
        this.vy = 3.2;
        this.onGround = false;
      }
      if (inp.fwd || inp.side) this.walkPhase += dt * (inp.run ? 14 : 9);
    }
    // gravity and landing
    const g = this.groundAt(this.pos.x, this.pos.z, this.pos.y);
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= g) {
      this.pos.y = g;
      this.vy = 0;
      this.onGround = true;
    }
    this.place();
  }

  place() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    // head bob while walking (moves the eye a little)
    this.eye.position.y = EYE + Math.abs(Math.sin(this.walkPhase)) * 0.025;
    this.eye.rotation.x = -this.pitch;
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 2.5, p.y + 1.6, p.z + 2.5, p.x, p.y + 0.4, p.z];
  }
}

/**
 * Reads the keyboard / mouse while you are "driving" the explorer.
 */
export class WalkController {
  /**
   * @param {import("CS559-Framework/GrWorld.js").GrWorld} world
   * @param {Explorer} explorer
   * @param {HTMLElement} wrap
   */
  constructor(world, explorer, wrap) {
    this.world = world;
    this.explorer = explorer;
    /** @type {Set<string>} */
    this.keys = new Set();
    /** what Esc does while walking (set by the UI) */
    this.onEscape = null;
    const typing = e => /** @type {HTMLElement} */ (e.target)?.closest?.("input, textarea, select");
    window.addEventListener("keydown", e => {
      if (typing(e) || !this.isActive()) return;
      if (e.code === "Escape" && this.onEscape) this.onEscape();
      if (e.code === "Space") this.jumpQueued = true; // a quick tap still jumps
      this.keys.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", e => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    // drag to look
    const canvas = world.renderer.domElement;
    let drag = false;
    let last = [0, 0];
    canvas.addEventListener("pointerdown", e => {
      if (!this.isActive() || e.button !== 0) return;
      drag = true;
      last = [e.clientX, e.clientY];
    });
    window.addEventListener("pointermove", e => {
      if (!drag) return;
      this.explorer.yaw -= (e.clientX - last[0]) * 0.004;
      this.explorer.pitch = Math.max(-1.3, Math.min(1.3, this.explorer.pitch - (e.clientY - last[1]) * 0.004));
      last = [e.clientX, e.clientY];
    });
    window.addEventListener("pointerup", () => (drag = false));

    this.hint = document.createElement("div");
    Object.assign(this.hint.style, {
      position: "absolute", left: "50%", bottom: "10px", transform: "translateX(-50%)",
      background: "rgba(0,20,30,0.7)", color: "#e6f6fb", padding: "6px 12px", borderRadius: "8px",
      font: "13px system-ui, sans-serif", pointerEvents: "none", display: "none", whiteSpace: "nowrap", zIndex: "5",
    });
    this.hint.textContent = "Walking: ↑/W forward · ↓/S back · ←→ turn · A/D sidestep · Space jump · Shift run · drag to look · Esc stop";
    wrap.appendChild(this.hint);
    // a small crosshair in the middle of the view
    this.cross = document.createElement("div");
    Object.assign(this.cross.style, {
      position: "absolute", left: "50%", top: "50%", width: "6px", height: "6px", margin: "-3px 0 0 -3px",
      borderRadius: "50%", background: "rgba(255,255,255,0.7)", pointerEvents: "none", display: "none", zIndex: "5",
    });
    wrap.appendChild(this.cross);
  }

  isActive() {
    return this.world.view_mode === "Drive Object" && this.world.active_object === this.explorer;
  }

  /** once per frame */
  update() {
    const on = this.isActive();
    this.explorer.active = on;
    this.hint.style.display = on ? "block" : "none";
    this.cross.style.display = on ? "block" : "none";
    if (!on) return;
    const k = this.keys;
    const has = (...c) => c.some(x => k.has(x));
    this.explorer.input = {
      fwd: (has("KeyW", "ArrowUp") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0),
      side: (has("KeyD") ? 1 : 0) - (has("KeyA") ? 1 : 0),
      turn: (has("ArrowLeft") ? 1 : 0) - (has("ArrowRight") ? 1 : 0),
      jump: has("Space") || this.jumpQueued,
      run: has("ShiftLeft", "ShiftRight"),
    };
    this.jumpQueued = false;
  }
}
