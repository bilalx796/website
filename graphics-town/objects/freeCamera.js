// @ts-check
/**
 * Free-roaming camera (replaces the framework's orbit / fly controls).
 *
 *   W / ↑  forward        S / ↓  back
 *   A / ←  left           D / →  right
 *   E / Space  up         Q / C  down
 *   Shift  faster         mouse drag  look around      scroll wheel  move forward/back
 *
 * It is installed WITHOUT editing the framework: the framework's OrbitControls
 * and FlyControls are switched off, and this controller drives the camera
 * whenever the WorldUI camera mode is "Orbit Camera" or "Fly Camera" (both are
 * relabeled "Free Camera"). Follow / Drive (riding) and LookAt keep working:
 *  - if anything else moves the camera (e.g. the LookAt menu), the controller
 *    adopts that new position and direction
 *  - when you stop riding, the camera goes back to where you left it
 *
 * flyTo() glides the camera smoothly to a new viewpoint (used to show the
 * shapes the fish school makes).
 */

import * as T from "three";
import { floorHeight } from "./terrain.js";

const FREE_MODES = ["Orbit Camera", "Fly Camera"];
const noop = () => {};

export class FreeCamera {
  /** @param {import("CS559-Framework/GrWorld.js").GrWorld} world */
  constructor(world) {
    this.world = world;
    const canvas = world.renderer.domElement;

    // --- switch off the framework's orbit and fly controls
    const oc = /** @type {any} */ (world.orbit_controls);
    oc.dispose();
    oc.enabled = false;
    oc.update = noop;
    oc.reset = noop;
    oc.saveState = noop;
    const fc = /** @type {any} */ (world.fly_controls);
    fc.disconnect();
    fc.connect = noop;
    fc.update = noop;
    fc.reset = noop;
    fc.saveState = noop;

    // --- our state: position + yaw/pitch
    this.pos = new T.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.adoptFrom(world.camera);
    this.lastQ = new T.Quaternion();
    this.lastP = new T.Vector3();
    this.lastCam = /** @type {T.Camera|null} */ (null);
    this.writeTo(world.active_camera);

    /** @type {Set<string>} */
    this.keys = new Set();
    /** @type {null | {fromP: T.Vector3, toP: T.Vector3, fromYaw: number, toYaw: number, fromPitch: number, toPitch: number, t: number, dur: number}} */
    this.flight = null;
    this.lastTime = performance.now();

    // --- keyboard (ignored while typing in a text box)
    const typing = e => /** @type {HTMLElement} */ (e.target)?.closest?.("input, textarea, select");
    window.addEventListener("keydown", e => {
      if (typing(e) || !this.isFree()) return;
      this.keys.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
      this.flight = null;
    });
    window.addEventListener("keyup", e => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());

    // --- mouse drag to look
    let dragging = false;
    let last = [0, 0];
    canvas.addEventListener("pointerdown", e => {
      if (!this.isFree() || e.button !== 0) return;
      dragging = true;
      last = [e.clientX, e.clientY];
    });
    window.addEventListener("pointermove", e => {
      if (!dragging) return;
      const dx = e.clientX - last[0];
      const dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      if (dx === 0 && dy === 0) return;
      this.flight = null;
      this.yaw -= dx * 0.004;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * 0.004));
    });
    window.addEventListener("pointerup", () => (dragging = false));
    // --- scroll wheel: move forward / back
    canvas.addEventListener(
      "wheel",
      e => {
        if (!this.isFree()) return;
        e.preventDefault();
        this.flight = null;
        this.pos.addScaledVector(this.forward(), -e.deltaY * 0.03);
        this.clamp();
      },
      { passive: false }
    );

    // --- when you stop riding, put the camera back where it was
    const setViewMode = world.setViewMode.bind(world);
    world.setViewMode = mode => {
      const wasRiding = !FREE_MODES.includes(world.view_mode);
      setViewMode(mode);
      if (wasRiding && FREE_MODES.includes(mode)) this.writeTo(world.active_camera);
    };
  }

  isFree() {
    return FREE_MODES.includes(this.world.view_mode);
  }

  /** the direction we're looking */
  forward() {
    return new T.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }

  /** take position + direction from a camera */
  adoptFrom(cam) {
    cam.getWorldPosition(this.pos);
    const d = cam.getWorldDirection(new T.Vector3());
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  }

  /** put our state onto a camera */
  writeTo(cam) {
    cam.position.copy(this.pos);
    cam.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    cam.updateMatrixWorld();
    this.lastP.copy(cam.position);
    this.lastQ.copy(cam.quaternion);
    this.lastCam = cam;
  }

  clamp() {
    this.pos.x = Math.max(-90, Math.min(90, this.pos.x));
    this.pos.z = Math.max(-90, Math.min(90, this.pos.z));
    this.pos.y = Math.max(floorHeight(this.pos.x, this.pos.z) + 0.6, Math.min(45, this.pos.y));
  }

  /**
   * glide to a viewpoint
   * @param {T.Vector3} to - where the camera should end up
   * @param {T.Vector3} lookAt - what it should look at
   * @param {number} [dur=2] seconds
   */
  flyTo(to, lookAt, dur = 2) {
    const d = lookAt.clone().sub(to).normalize();
    let toYaw = Math.atan2(-d.x, -d.z);
    // turn the short way around
    while (toYaw - this.yaw > Math.PI) toYaw -= Math.PI * 2;
    while (toYaw - this.yaw < -Math.PI) toYaw += Math.PI * 2;
    this.flight = {
      fromP: this.pos.clone(), toP: to.clone(),
      fromYaw: this.yaw, toYaw,
      fromPitch: this.pitch, toPitch: Math.asin(Math.max(-1, Math.min(1, d.y))),
      t: 0, dur,
    };
  }

  /** call once per frame (even when the world is paused) */
  update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (!this.isFree()) return;
    const cam = this.world.active_camera;

    // something else moved the camera (LookAt menu, solo view...) - adopt it
    if (cam !== this.lastCam || cam.position.distanceToSquared(this.lastP) > 1e-8 || 1 - Math.abs(cam.quaternion.dot(this.lastQ)) > 1e-8) {
      this.adoptFrom(cam);
      this.flight = null;
    }

    if (this.flight) {
      const f = this.flight;
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      const s = u * u * (3 - 2 * u);
      this.pos.lerpVectors(f.fromP, f.toP, s);
      this.yaw = f.fromYaw + (f.toYaw - f.fromYaw) * s;
      this.pitch = f.fromPitch + (f.toPitch - f.fromPitch) * s;
      if (u >= 1) this.flight = null;
    } else {
      const k = this.keys;
      const speed = (k.has("ShiftLeft") || k.has("ShiftRight") ? 30 : 11) * dt;
      const fwd = this.forward();
      const right = new T.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const move = new T.Vector3();
      if (k.has("KeyW") || k.has("ArrowUp")) move.add(fwd);
      if (k.has("KeyS") || k.has("ArrowDown")) move.sub(fwd);
      if (k.has("KeyD") || k.has("ArrowRight")) move.add(right);
      if (k.has("KeyA") || k.has("ArrowLeft")) move.sub(right);
      if (k.has("KeyE") || k.has("Space")) move.y += 1;
      if (k.has("KeyQ") || k.has("KeyC")) move.y -= 1;
      if (move.lengthSq() > 0) this.pos.addScaledVector(move.normalize(), speed);
    }
    this.clamp();
    this.writeTo(cam);
  }
}

/**
 * Relabel the WorldUI camera menu: "Orbit Camera" -> "Free Camera" and hide
 * "Fly Camera" (both now mean the free camera). Only the visible text changes;
 * the framework still receives its own mode names.
 */
export function relabelCameraMenu() {
  const fix = () => {
    document.querySelectorAll(".lil-gui select").forEach(sel => {
      const s = /** @type {HTMLSelectElement} */ (sel);
      for (const opt of Array.from(s.options)) {
        if (opt.textContent === "Orbit Camera") opt.textContent = "Free Camera";
        if (opt.textContent === "Fly Camera") opt.hidden = true;
      }
    });
    document.querySelectorAll(".lil-gui .display").forEach(d => {
      if (d.textContent === "Orbit Camera" || d.textContent === "Fly Camera") d.textContent = "Free Camera";
    });
  };
  fix();
  // lil-gui rewrites the display text when the value changes - fix it again
  new MutationObserver(fix).observe(document.body, { subtree: true, childList: true, characterData: true });
}

/** switch the WorldUI to the free camera (through the menu, so the panel updates) */
export function switchToFreeCamera(world) {
  if (FREE_MODES.includes(world.view_mode)) return;
  for (const sel of Array.from(document.querySelectorAll(".lil-gui select"))) {
    const s = /** @type {HTMLSelectElement} */ (sel);
    const idx = Array.from(s.options).findIndex(o => o.value === "Orbit Camera" || o.textContent === "Free Camera");
    if (idx >= 0 && Array.from(s.options).some(o => o.textContent === "Drive Object")) {
      s.selectedIndex = idx;
      s.dispatchEvent(new Event("change"));
      return;
    }
  }
  world.setViewMode("Orbit Camera");
}
