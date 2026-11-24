// @ts-check
/**
 * Huge undersea mountains around the reef, far beyond the sand, so the town
 * sits in a valley.
 *
 * Each mountain is a HEIGHTFIELD: a flat grid whose vertices are pushed up by
 *   peak shape (a rounded cone)  x  (1 + ridged fBm noise)
 * so it gets crags, ridges and gullies instead of a smooth cone. All of them
 * are merged into ONE mesh (one draw call) with a CC0 rock texture
 * (ambientCG Rock064).
 *
 * The scene's fog is so thick that anything this far away would vanish, so the
 * mountains skip the fog and glow faintly in the water color instead (updated
 * every frame, so they follow day and night): they read as tall hazy
 * silhouettes with a little rock detail.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { texturePack } from "./materials.js";
import { fbm2, makeRng } from "./util/noise.js";

/** ridged noise: sharp crests where fbm crosses zero */
function ridged(x, y) {
  return 1 - Math.abs(fbm2(x, y, 4));
}

/**
 * one mountain: a heightfield grid (in world coordinates)
 * @param {number} cx @param {number} cz @param {number} R - base radius @param {number} H - height
 * @param {number} seed
 */
function mountain(cx, cz, R, H, seed) {
  const N = 44;
  const g = new T.PlaneGeometry(2 * R, 2 * R, N, N);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    // wobble the outline so it isn't a perfect circle
    const ang = Math.atan2(z, x);
    const rr = R * (0.8 + 0.2 * fbm2(Math.cos(ang) * 1.5 + seed, Math.sin(ang) * 1.5, 2));
    const d = Math.hypot(x, z) / rr;
    const shape = d >= 1 ? 0 : Math.pow(1 - d, 1.7) * (1 + 0.6 * Math.pow(1 - d, 3));
    const crag = ridged((x + seed * 31) * 0.045, (z - seed * 17) * 0.045);
    const h = H * shape * (0.65 + 0.55 * crag) - 12;
    p.setY(i, h);
    // lower = darker rock, the peaks a bit paler
    const t = Math.min(1, Math.max(0, (h + 12) / H));
    const c = 0.55 + 0.45 * t;
    col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c * 1.02;
  }
  g.setAttribute("color", new T.BufferAttribute(col, 3));
  g.translate(cx, 0, cz);
  g.computeVertexNormals();
  return g;
}

export class Mountains extends GrObject {
  /** @param {import("CS559-Framework/GrWorld.js").GrWorld} world */
  constructor(world) {
    const rng = makeRng(777);
    const geos = [];
    const n = 15;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + (rng() - 0.5) * 0.3;
      const dist = 125 + rng() * 30;
      const R = 40 + rng() * 18;
      const H = 50 + rng() * 45;
      geos.push(mountain(Math.cos(a) * dist, Math.sin(a) * dist, R, H, k + 1));
    }
    const rock = texturePack("Rock064", 40, 40);
    const mat = new T.MeshStandardMaterial({
      map: rock.map, normalMap: rock.normalMap, normalScale: new T.Vector2(1.2, 1.2),
      vertexColors: true, roughness: 0.95, fog: false, color: 0x5a5650, emissive: 0x0e5a7a, emissiveIntensity: 0.62,
    });
    const mesh = new T.Mesh(mergeGeometries(geos), mat);
    mesh.matrixAutoUpdate = false; // never moves
    super("Mountains", mesh);
    this.world = world;
    this.mat = mat;
  }

  stepWorld() {
    // haze: the mountains glow faintly in the water's color (which changes with
    // the time of day), so they sit just a little darker than the open water
    // behind them, like distant shapes in murky water. The rock texture and
    // lighting add detail on top.
    const fog = /** @type {any} */ (this.world.scene.fog);
    if (fog) this.mat.emissive.copy(fog.color);
  }
}
