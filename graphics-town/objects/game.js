// @ts-check
/**
 * SHARK FRENZY - play as the shark and eat as many fish as you can in 30 seconds.
 *
 *  - you pilot the shark with the chase camera (see pilot.js)
 *  - the fish notice you from farther away and flee harder than usual
 *  - a fish is eaten when it gets close to the shark's mouth: it vanishes, a
 *    cloud of blood puffs out, the screen flashes red and shakes
 *  - the screen grows more "bloodthirsty" as the clock runs down: the water
 *    turns red, a red vignette closes in, colors get hotter, and in the last
 *    seconds it pulses like a heartbeat
 *  - the high score is saved in the browser (localStorage)
 *
 * The countdown uses the world's time (stepWorld delta), so pausing the world
 * pauses the game.
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { reef } from "./reefState.js";
import { makeRng } from "./util/noise.js";

const GAME_TIME = 30;
const COUNTDOWN = 3;
const EAT_RADIUS = 2.4;
const HS_KEY = "coralhaven-shark-frenzy-highscore";

function loadHigh() {
  try {
    return Number(localStorage.getItem(HS_KEY)) || 0;
  } catch (e) {
    return 0;
  }
}
function saveHigh(v) {
  try {
    localStorage.setItem(HS_KEY, String(v));
  } catch (e) {
    /* private window etc. - the high score just won't persist */
  }
}

const CSS = `
.frenzy-vignette { position: absolute; inset: 0; pointer-events: none; z-index: 3; opacity: 0;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(120,0,0,0.55) 70%, rgba(60,0,0,0.95) 100%); }
.frenzy-flash { position: absolute; inset: 0; pointer-events: none; z-index: 3; background: #b00000; opacity: 0; }
.frenzy-hud { position: absolute; top: 10px; left: 0; right: 0; z-index: 4; pointer-events: none; display: none;
  text-align: center; font: 700 16px system-ui, sans-serif; color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.8); line-height: 1.2; }
.frenzy-hud .time { font-size: 44px; letter-spacing: 1px; }
.frenzy-hud .row { display: flex; justify-content: center; gap: 28px; margin-top: 2px; }
.frenzy-center { position: absolute; inset: 0; z-index: 5; display: none; align-items: center; justify-content: center;
  pointer-events: none; text-align: center; color: #fff; font: 900 72px system-ui, sans-serif;
  text-shadow: 0 4px 18px rgba(120,0,0,0.9); line-height: 1.1; }
.frenzy-card { pointer-events: auto; background: rgba(20, 0, 0, 0.82); border: 2px solid #c0392b; border-radius: 14px;
  padding: 22px 30px; font: 600 18px system-ui, sans-serif; color: #ffe6e6; text-shadow: none; }
.frenzy-card h2 { margin: 0 0 6px; font: 900 34px system-ui, sans-serif; color: #ff4d4d; }
.frenzy-card .big { font: 900 54px system-ui, sans-serif; color: #fff; margin: 6px 0; }
.frenzy-card button { margin: 14px 6px 0; padding: 8px 16px; border-radius: 8px; border: 0; cursor: pointer;
  font: 700 16px system-ui, sans-serif; background: #c0392b; color: #fff; }
.frenzy-card button.alt { background: #3a3a3a; }
.frenzy-pop { position: absolute; z-index: 4; pointer-events: none; color: #ff5555; font: 900 26px system-ui, sans-serif;
  text-shadow: 0 2px 6px #000; transition: transform 0.7s ease-out, opacity 0.7s ease-out; }
`;

export class SharkFrenzy extends GrObject {
  /**
   * @param {Object} p
   * @param {import("CS559-Framework/GrWorld.js").GrWorld} p.world
   * @param {import("./shark.js").Shark} p.shark
   * @param {import("./fishSchool.js").FishSchool} p.school
   * @param {import("./pilot.js").PilotController} p.pilot
   * @param {HTMLElement} p.wrap - the box around the canvas
   */
  constructor(p) {
    // blood clouds: instanced red puffs that grow and fade
    const MAX = 240;
    const mat = new T.MeshBasicMaterial({ color: 0x8a0000, transparent: true, opacity: 0.38, depthWrite: false });
    const mesh = new T.InstancedMesh(new T.IcosahedronGeometry(0.25, 1), mat, MAX);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    super("Shark Frenzy (game)", mesh);
    this.world = p.world;
    this.shark = p.shark;
    this.school = p.school;
    this.pilot = p.pilot;
    this.wrap = p.wrap;
    this.blood = mesh;
    this.MAX = MAX;
    /** @type {Array<{p: T.Vector3, v: T.Vector3, age: number, life: number, s: number}>} */
    this.puffs = [];
    this.rng = makeRng(666);
    /** @type {"idle"|"countdown"|"play"|"over"} */
    this.phase = "idle";
    this.t = 0;
    this.score = 0;
    this.high = loadHigh();
    this.flash = 0;
    this.shake = 0;
    this.time = 0;
    this._m = new T.Matrix4();
    this.buildDom();
  }

  buildDom() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    const mk = cls => {
      const d = document.createElement("div");
      d.className = cls;
      this.wrap.appendChild(d);
      return d;
    };
    this.vignette = mk("frenzy-vignette");
    this.flashEl = mk("frenzy-flash");
    this.hud = mk("frenzy-hud");
    this.hud.innerHTML = `<div class="time">30.0</div><div class="row"><span data-g="score">🩸 0 eaten</span><span data-g="high">best 0</span></div>`;
    this.center = mk("frenzy-center");
    this.canvas = this.world.renderer.domElement;
  }

  get running() {
    return this.phase === "countdown" || this.phase === "play";
  }

  start() {
    if (this.running) return;
    this.center.style.display = "none";
    this.school.release();
    this.school.reviveAll();
    // a real chase: they notice you sooner, bolt faster, and only sprinting catches them
    this.school.fearRadius = 13;
    this.school.fearStrength = 40;
    this.school.panicBoost = 1.55;
    this.school.homePull = 0.6;
    // put the shark a little way from the school, facing it
    const c = this.school.centerOfSchool();
    const from = new T.Vector3(c.x, 0, c.z);
    const away = from.lengthSq() > 1 ? from.clone().normalize() : new T.Vector3(0, 0, 1);
    this.shark.pos.set(c.x + away.x * 22, c.y, c.z + away.z * 22);
    this.shark.heading.copy(c).sub(this.shark.pos).normalize();
    this.shark.speed = 3;
    this.pilot.startChase(this.shark);
    this.pilot.onEscape = () => this.end(true);
    this.phase = "countdown";
    this.t = COUNTDOWN;
    this.score = 0;
    this.hud.style.display = "block";
    this.updateHud();
  }

  /** @param {boolean} [quit=false] */
  end(quit = false) {
    if (!this.running) return;
    this.phase = "over";
    this.pilot.stopChase();
    this.pilot.onEscape = null;
    this.school.fearRadius = 9;
    this.school.fearStrength = 26;
    this.school.panicBoost = 1.35;
    this.school.homePull = 1.5;
    this.school.reviveAll();
    this.hud.style.display = "none";
    const newHigh = !quit && this.score > this.high;
    if (newHigh) {
      this.high = this.score;
      saveHigh(this.high);
    }
    this.center.style.display = "flex";
    this.center.innerHTML = `<div class="frenzy-card">
        <h2>${quit ? "FRENZY OVER" : "TIME!"}</h2>
        <div>You ate</div><div class="big">${this.score}</div><div>fish</div>
        <div style="margin-top:8px">${newHigh ? "🏆 NEW HIGH SCORE!" : `High score: ${this.high}`}</div>
        <button data-g="again">Play again</button><button class="alt" data-g="close">Close</button>
      </div>`;
    /** @type {HTMLElement} */ (this.center.querySelector('[data-g="again"]')).onclick = () => this.start();
    /** @type {HTMLElement} */ (this.center.querySelector('[data-g="close"]')).onclick = () => (this.center.style.display = "none");
  }

  updateHud() {
    /** @type {HTMLElement} */ (this.hud.querySelector(".time")).textContent =
      this.phase === "countdown" ? "GET READY" : this.t.toFixed(1);
    /** @type {HTMLElement} */ (this.hud.querySelector(".time")).style.color = this.phase === "play" && this.t < 6 ? "#ff4040" : "#fff";
    /** @type {HTMLElement} */ (this.hud.querySelector('[data-g="score"]')).textContent = `🩸 ${this.score} eaten`;
    /** @type {HTMLElement} */ (this.hud.querySelector('[data-g="high"]')).textContent = `best ${this.high}`;
  }

  /** a floating "+1" where the fish was eaten */
  pop(worldPos) {
    const v = worldPos.clone().project(this.world.active_camera);
    if (v.z > 1) return;
    const el = document.createElement("div");
    el.className = "frenzy-pop";
    el.textContent = "+1";
    el.style.left = `${((v.x + 1) / 2) * this.canvas.clientWidth}px`;
    el.style.top = `${((1 - v.y) / 2) * this.canvas.clientHeight}px`;
    this.wrap.appendChild(el);
    requestAnimationFrame(() => {
      el.style.transform = "translateY(-40px) scale(1.3)";
      el.style.opacity = "0";
    });
    setTimeout(() => el.remove(), 800);
  }

  /** a cloud of blood */
  burst(at) {
    for (let k = 0; k < 10 && this.puffs.length < this.MAX; k++) {
      this.puffs.push({
        p: at.clone(),
        v: new T.Vector3(this.rng() - 0.5, this.rng() - 0.3, this.rng() - 0.5).multiplyScalar(2.2),
        age: 0,
        life: 1.4 + this.rng() * 1.2,
        s: 0.35 + this.rng() * 0.5,
      });
    }
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    this.time += dt;

    if (this.phase === "countdown") {
      this.t -= dt;
      this.center.style.display = "flex";
      this.center.textContent = String(Math.max(1, Math.ceil(this.t)));
      if (this.t <= 0) {
        this.phase = "play";
        this.t = GAME_TIME;
        this.center.textContent = "EAT!";
        setTimeout(() => {
          if (this.phase === "play") this.center.style.display = "none";
        }, 700);
      }
    } else if (this.phase === "play") {
      this.t -= dt;
      // eat any fish near the shark's mouth
      const mouth = this.shark.pos.clone().addScaledVector(this.shark.heading, 2.5);
      const s = this.school;
      for (let i = 0; i < s.N; i++) {
        if (!s.alive[i]) continue;
        const dx = s.pos[i * 3] - mouth.x, dy = s.pos[i * 3 + 1] - mouth.y, dz = s.pos[i * 3 + 2] - mouth.z;
        if (dx * dx + dy * dy + dz * dz < EAT_RADIUS * EAT_RADIUS) {
          const at = new T.Vector3(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]);
          s.kill(i);
          this.score++;
          this.burst(at);
          this.pop(at);
          this.flash = 1;
          this.shake = 1;
        }
      }
      if (this.t <= 0) {
        this.t = 0;
        this.end();
      }
    }
    if (this.running) this.updateHud();

    // how bloodthirsty the screen is: rises through the round
    const target = this.phase === "play" ? 0.15 + 0.85 * (1 - this.t / GAME_TIME) : this.phase === "countdown" ? 0.1 : 0;
    reef.blood += (target - reef.blood) * Math.min(1, dt * (this.running ? 2 : 0.8));
    if (reef.blood < 0.002) reef.blood = 0;

    // blood clouds drift, swell and fade
    for (const p of this.puffs) {
      p.age += dt;
      p.v.multiplyScalar(1 - Math.min(1, dt * 1.2));
      p.p.addScaledVector(p.v, dt);
    }
    this.puffs = this.puffs.filter(p => p.age < p.life);
    this.puffs.forEach((p, i) => {
      const grow = p.s * (1 + p.age * 1.2) * (1 - (p.age / p.life) ** 2);
      this._m.makeScale(grow, grow, grow).setPosition(p.p);
      this.blood.setMatrixAt(i, this._m);
    });
    this.blood.count = this.puffs.length;
    this.blood.instanceMatrix.needsUpdate = true;
  }

  /** screen effects - every frame, even when paused (so the overlay stays right) */
  updateScreen() {
    const b = reef.blood;
    // heartbeat in the last seconds: two quick pulses per beat
    let beat = 0;
    if (this.phase === "play" && this.t < 6) {
      const ph = (performance.now() / 1000) * 1.6 % 1;
      beat = Math.max(0, Math.sin(ph * Math.PI * 2)) ** 6 + 0.6 * Math.max(0, Math.sin((ph - 0.18) * Math.PI * 2)) ** 6;
    }
    this.vignette.style.opacity = String(Math.min(1, b * 0.95 + beat * 0.35));
    this.flash *= 0.85;
    this.flashEl.style.opacity = String(this.flash * 0.28);
    this.canvas.style.filter = b > 0.01
      ? `saturate(${1 + b * 1.3}) contrast(${1 + b * 0.25}) sepia(${b * 0.45}) hue-rotate(${-18 * b}deg) brightness(${1 - b * 0.12})`
      : "";
    this.shake *= 0.82;
    const sx = (Math.random() - 0.5) * 10 * this.shake;
    const sy = (Math.random() - 0.5) * 10 * this.shake;
    this.canvas.style.transform = this.shake > 0.02 ? `translate(${sx}px, ${sy}px)` : "";
  }

  lookFromLookAt() {
    const p = this.shark.root.position;
    return [p.x + 8, p.y + 4, p.z + 8, p.x, p.y, p.z];
  }
}
