// @ts-check
/**
 * Piloting: YOU steer the shark or the manta ray.
 *
 *   ← →  turn left / right      ↑ ↓  swim up / down      Shift  sprint      Esc  stop
 *   (it swims forward on its own)
 *
 * Two ways to pilot:
 *  - the "Drive" buttons in the Coralhaven panel (and the Shark Frenzy game) use a
 *    CHASE CAMERA that follows behind the animal
 *  - picking the shark or manta in the WorldUI "Drive"/"Follow" camera modes also
 *    gives you control (with the framework's own camera)
 *
 * The animals do the actual moving in their own stepWorld (so pause and the
 * speed slider still work) using pilotStep() below, with the input this
 * controller collects from the keyboard.
 */

import * as T from "three";
import { floorHeight } from "./terrain.js";
import { switchToFreeCamera } from "./freeCamera.js";

const UP = new T.Vector3(0, 1, 0);

/**
 * @typedef {{throttle: number, turn: number, climb: number, sprint: boolean}} PilotInput
 * @typedef {{cruise: number, fast: number, slow: number, sprint: number, turnRate: number}} PilotOptions
 */

/**
 * Move a piloted animal for one step.
 * @param {{pos: T.Vector3, heading: T.Vector3, speed: number, bank?: number}} s
 * @param {PilotInput} inp
 * @param {number} dt
 * @param {PilotOptions} o
 */
export function pilotStep(s, inp, dt, o) {
  // turn (yaw) around the vertical axis
  s.heading.applyAxisAngle(UP, inp.turn * o.turnRate * dt);
  // climb / dive: ease the heading's vertical part toward a target pitch
  const targetY = inp.climb * 0.55;
  const hy = s.heading.y + (targetY - s.heading.y) * Math.min(1, dt * 2.5);
  const flat = Math.hypot(s.heading.x, s.heading.z) || 1e-6;
  const k = Math.sqrt(Math.max(0, 1 - hy * hy)) / flat;
  s.heading.set(s.heading.x * k, hy, s.heading.z * k);
  // speed
  let target = o.cruise;
  if (inp.throttle > 0) target = o.fast;
  if (inp.throttle < 0) target = o.slow;
  if (inp.sprint) target = o.sprint;
  s.speed += (target - s.speed) * Math.min(1, dt * 2);
  s.pos.addScaledVector(s.heading, s.speed * dt);
  // stay in the water: above the floor, below the surface, inside the reef
  const fh = floorHeight(s.pos.x, s.pos.z) + 1.6;
  if (s.pos.y < fh) {
    s.pos.y = fh;
    if (s.heading.y < 0) s.heading.y *= 0.5;
  }
  s.pos.y = Math.min(32, s.pos.y);
  s.pos.x = Math.max(-72, Math.min(72, s.pos.x));
  s.pos.z = Math.max(-72, Math.min(72, s.pos.z));
  s.heading.normalize();
  // lean into turns
  s.bank = (s.bank ?? 0) + (-inp.turn * 0.55 - (s.bank ?? 0)) * Math.min(1, dt * 3);
}

export class PilotController {
  /**
   * @param {import("CS559-Framework/GrWorld.js").GrWorld} world
   * @param {import("./freeCamera.js").FreeCamera} freeCam
   * @param {HTMLElement} wrap - element around the canvas (for the hint overlay)
   * @param {Array<any>} pilotables - objects with pos, heading, piloted, input
   */
  constructor(world, freeCam, wrap, pilotables) {
    this.world = world;
    this.freeCam = freeCam;
    this.pilotables = pilotables;
    /** @type {any} the animal followed by the chase camera */
    this.chase = null;
    this.camPos = new T.Vector3();
    /** @type {null | (() => void)} what Esc does (the game can take this over) */
    this.onEscape = null;
    /** @type {Set<string>} */
    this.keys = new Set();
    this.lastTime = performance.now();

    const typing = e => /** @type {HTMLElement} */ (e.target)?.closest?.("input, textarea, select");
    window.addEventListener("keydown", e => {
      if (typing(e)) return;
      if (e.code === "Escape") {
        if (this.onEscape) this.onEscape();
        else this.stopChase();
        return;
      }
      this.keys.add(e.code);
      if (this.controlled() && (e.code.startsWith("Arrow") || e.code === "Space")) e.preventDefault();
    });
    window.addEventListener("keyup", e => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    // hint shown while piloting
    this.hint = document.createElement("div");
    Object.assign(this.hint.style, {
      position: "absolute", left: "50%", bottom: "10px", transform: "translateX(-50%)",
      background: "rgba(0,20,30,0.7)", color: "#e6f6fb", padding: "6px 12px", borderRadius: "8px",
      font: "13px system-ui, sans-serif", pointerEvents: "none", display: "none", whiteSpace: "nowrap", zIndex: "5",
    });
    wrap.appendChild(this.hint);
  }

  /** @returns {PilotInput} */
  input() {
    const k = this.keys;
    const has = (...codes) => codes.some(c => k.has(c));
    return {
      throttle: 0, // it swims forward on its own; Shift sprints
      turn: (has("KeyA", "ArrowLeft") ? 1 : 0) - (has("KeyD", "ArrowRight") ? 1 : 0),
      climb: (has("KeyW", "ArrowUp", "Space") ? 1 : 0) - (has("KeyS", "ArrowDown") ? 1 : 0),
      sprint: has("ShiftLeft", "ShiftRight"),
    };
  }

  /** which animal is being piloted right now (or null) */
  controlled() {
    if (this.chase) return this.chase;
    const w = this.world;
    if ((w.view_mode === "Drive Object" || w.view_mode === "Follow Object") && this.pilotables.includes(w.active_object)) {
      return w.active_object;
    }
    return null;
  }

  /** start piloting an animal with the chase camera */
  startChase(obj) {
    switchToFreeCamera(this.world);
    this.freeCam.suspended = true;
    this.chase = obj;
    const flat = new T.Vector3(obj.heading.x, 0, obj.heading.z).normalize();
    this.camPos.copy(obj.pos).addScaledVector(flat, -9).add(new T.Vector3(0, 3, 0));
  }

  stopChase() {
    if (!this.chase) return;
    this.chase = null;
    this.freeCam.suspended = false;
  }

  /** once per frame (even when paused) */
  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const who = this.controlled();
    for (const p of this.pilotables) {
      p.piloted = p === who;
      if (p.piloted) p.input = this.input();
    }

    if (who) {
      this.hint.style.display = "block";
      this.hint.textContent = `Piloting ${who.name}: ← → turn · ↑ ↓ up / down · Shift sprint · Esc stop`;
    } else {
      this.hint.style.display = "none";
    }

    // chase camera: behind and above the animal, looking a little ahead of it
    if (this.chase) {
      const o = this.chase;
      const cam = this.world.active_camera;
      const flat = new T.Vector3(o.heading.x, 0, o.heading.z);
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
      flat.normalize();
      const back = o.chaseDistance ?? 9;
      const want = o.pos.clone().addScaledVector(flat, -back).add(new T.Vector3(0, back * 0.33, 0));
      want.y = Math.max(want.y, floorHeight(want.x, want.z) + 1);
      this.camPos.lerp(want, 1 - Math.exp(-dt * 4));
      cam.position.copy(this.camPos);
      cam.lookAt(o.pos.clone().addScaledVector(o.heading, 4).add(new T.Vector3(0, 0.6, 0)));
    }
  }
}
