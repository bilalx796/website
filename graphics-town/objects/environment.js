// @ts-check
/**
 * The ocean itself: lights, water color + fog, light rays from the surface,
 * the water surface seen from below, and the day/night cycle.
 *
 * Day/night: the reef keeps its own clock (accumulated from delta, so it
 * respects pause and speed). The framework's timeOfDay runs a full day in 24
 * seconds, which is too fast to enjoy the night scenes, so the reef clock runs
 * a day in `reef.dayLength` seconds instead. The Reef panel can also lock it to
 * day or night.
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { reef } from "./reefState.js";
import { uTime, uDaylight, uNight } from "./shaders.js";
import { smoothstep, makeRng } from "./util/noise.js";
import { updateGlowMaterials } from "./materials.js";

const DAY_WATER = new T.Color(0x1680a3);
const DUSK_WATER = new T.Color(0x0c3d68);
const NIGHT_WATER = new T.Color(0x020a18);

/** a vertical gradient texture: bright at the top, transparent at the bottom */
function makeRayTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

/** ripply texture for the underside of the water surface (painted procedurally) */
function makeSurfaceTexture() {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#6fd6f0";
  g.fillRect(0, 0, S, S);
  const rng = makeRng(77);
  for (let i = 0; i < 140; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 6 + rng() * 22;
    g.strokeStyle = `rgba(255,255,255,${0.15 + rng() * 0.35})`;
    g.lineWidth = 1 + rng() * 2.5;
    g.beginPath();
    // draw each blob 9 times so the texture tiles seamlessly
    for (let ox = -S; ox <= S; ox += S) {
      for (let oy = -S; oy <= S; oy += S) {
        g.moveTo(x + ox + r, y + oy);
        g.ellipse(x + ox, y + oy, r, r * (0.5 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
      }
    }
    g.stroke();
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

export class ReefEnvironment extends GrObject {
  /**
   * @param {import("CS559-Framework/GrWorld.js").GrWorld} world
   */
  constructor(world) {
    const group = new T.Group();

    // sky light from above (blue) and bounce from the sand (warm, dim)
    const hemi = new T.HemisphereLight(0xa8ecff, 0x6a6040, 1.5);
    group.add(hemi);
    // the sun, filtered through the water
    const sun = new T.DirectionalLight(0xdaf7ff, 2.4);
    sun.position.set(14, 60, 10);
    group.add(sun);
    // a little ambient so nothing is ever pitch black
    const ambient = new T.AmbientLight(0x3a7fa0, 0.5);
    group.add(ambient);

    // light rays: open cones hanging from the surface with a fading gradient
    const rayTex = makeRayTexture();
    const rays = new T.Group();
    const rng = makeRng(12);
    /** @type {Array<{mesh: T.Mesh, phase: number, tilt: number}>} */
    const rayList = [];
    for (let i = 0; i < 9; i++) {
      const height = 30 + rng() * 8;
      const geom = new T.CylinderGeometry(0.8 + rng() * 1.2, 3 + rng() * 3, height, 20, 1, true);
      geom.translate(0, -height / 2, 0); // hang from the top
      const mat = new T.MeshBasicMaterial({
        map: rayTex,
        color: 0xbff4ff,
        transparent: true,
        opacity: 0.07,
        blending: T.AdditiveBlending,
        depthWrite: false,
        side: T.DoubleSide,
      });
      const mesh = new T.Mesh(geom, mat);
      const ang = rng() * Math.PI * 2;
      const rad = 6 + rng() * 30;
      mesh.position.set(Math.cos(ang) * rad, 33, Math.sin(ang) * rad - 4);
      mesh.renderOrder = 10;
      rays.add(mesh);
      rayList.push({ mesh, phase: rng() * 10, tilt: 0.12 + rng() * 0.1 });
    }
    group.add(rays);

    // the water surface, seen from underneath
    const surfTex = makeSurfaceTexture();
    const surfMat = new T.MeshBasicMaterial({
      map: surfTex,
      transparent: true,
      opacity: 0.55,
      side: T.DoubleSide,
      depthWrite: false,
    });
    const surface = new T.Mesh(new T.PlaneGeometry(260, 260), surfMat);
    surface.rotation.x = Math.PI / 2;
    surface.position.y = 34;
    group.add(surface);

    super("Ocean (light & water)", group);

    this.world = world;
    this.hemi = hemi;
    this.sun = sun;
    this.ambient = ambient;
    this.rayList = rayList;
    this.surfTex = surfTex;
    this.surfMat = surfMat;
    this.waterColor = new T.Color().copy(DAY_WATER);
    world.scene.background = this.waterColor;
    this.fog = new T.FogExp2(this.waterColor.getHex(), 0.016);
    world.scene.fog = this.fog;
    this.apply();
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    reef.time += dt;

    // advance the reef clock
    if (reef.mode === "cycle") {
      reef.hours = (reef.hours + (dt * 24) / reef.dayLength) % 24;
    } else {
      // glide towards noon or midnight
      const target = reef.mode === "day" ? 12 : 0;
      let diff = target - reef.hours;
      if (diff > 12) diff -= 24;
      if (diff < -12) diff += 24;
      const stepH = Math.sign(diff) * Math.min(Math.abs(diff), dt * 6);
      reef.hours = (reef.hours + stepH + 24) % 24;
    }
    // sun elevation: +1 at noon, -1 at midnight
    const elevation = Math.sin(((reef.hours - 6) / 12) * Math.PI);
    reef.daylight = smoothstep(-0.25, 0.35, elevation);
    reef.night = 1 - reef.daylight;

    // slowly wandering current
    reef.current[0] = 0.6 * Math.cos(reef.time * 0.05);
    reef.current[1] = 0.4 * Math.sin(reef.time * 0.037);

    this.apply();

    // sway the light rays, and drift the surface ripples
    for (const r of this.rayList) {
      r.mesh.rotation.z = r.tilt + 0.05 * Math.sin(reef.time * 0.3 + r.phase);
      r.mesh.rotation.x = 0.06 * Math.sin(reef.time * 0.23 + r.phase * 2);
    }
    this.surfTex.offset.x = reef.time * 0.004;
    this.surfTex.offset.y = reef.time * 0.0025;
  }

  /** push the current daylight value into lights, fog, colors and shader uniforms */
  apply() {
    const d = reef.daylight;
    // day -> dusk -> night water color
    if (d > 0.5) this.waterColor.copy(DUSK_WATER).lerp(DAY_WATER, (d - 0.5) * 2);
    else this.waterColor.copy(NIGHT_WATER).lerp(DUSK_WATER, d * 2);
    this.fog.color.copy(this.waterColor);
    this.fog.density = 0.015 + 0.01 * (1 - d);

    this.hemi.intensity = 0.12 + 1.15 * d;
    this.hemi.color.setRGB(0.55 + 0.1 * d, 0.75 + 0.18 * d, 1.0);
    this.sun.intensity = 0.15 + 1.7 * d;
    this.sun.color.setRGB(0.6 + 0.25 * d, 0.75 + 0.22 * d, 1.0); // bluish moonlight at night
    this.ambient.intensity = 0.25 + 0.3 * d;

    for (const r of this.rayList) {
      /** @type {T.MeshBasicMaterial} */ (r.mesh.material).opacity = 0.06 * d;
      r.mesh.visible = d > 0.02;
    }
    this.surfMat.opacity = 0.12 + 0.45 * d;

    uTime.value = reef.time;
    uDaylight.value = d;
    uNight.value = 1 - d;
    updateGlowMaterials();
  }

  lookFromLookAt() {
    return [0, 30, 62, 0, 4, 0];
  }
}
