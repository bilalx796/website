// @ts-check
/**
 * Scattered rocks and boulders.
 *
 * Each rock template is an icosahedron whose vertices are pushed in and out by
 * noise (so no two templates look alike); the surface detail comes from a
 * NORMAL MAP computed from a noise height field (Workbook 5).
 * Drawn as instanced meshes with random rotation/scale and slightly different
 * grey-brown colors.
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight } from "./terrain.js";
import { isFree } from "./placement.js";
import { noiseNormalMap } from "./materials.js";
import { makeRng, noise3 } from "./util/noise.js";
import { BEACON, WRECK } from "./layout.js";

/** @param {number} seed */
function rockGeometry(seed) {
  const g = new T.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const v = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise3(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3) * 0.35 + noise3(v.x * 3 + seed, v.y * 3, v.z * 3) * 0.1;
    v.multiplyScalar(1 + n);
    v.y *= 0.65;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Rocks extends GrObject {
  /** @param {number} [count=90] */
  constructor(count = 90) {
    const root = new T.Group();
    const rng = makeRng(77);
    const normalMap = noiseNormalMap(3, 0.12, 6);
    const mat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, normalMap, normalScale: new T.Vector2(1.2, 1.2) });
    const templates = [0, 1, 2, 3].map(k => rockGeometry(k * 13.7));
    const lists = templates.map(() => /** @type {Array<[number, number, number]>} */ ([]));

    let tries = 0;
    let placed = 0;
    while (placed < count && tries < 5000) {
      tries++;
      let x, z, s;
      const r = rng();
      if (r < 0.2) {
        // clustered around the beacon's rock outcrop
        const a = rng() * Math.PI * 2, d = 3 + rng() * 4;
        x = BEACON[0] + Math.cos(a) * d; z = BEACON[1] + Math.sin(a) * d; s = 0.6 + rng() * 1.2;
      } else if (r < 0.32) {
        const a = rng() * Math.PI * 2, d = 9 + rng() * 4;
        x = WRECK[0] + Math.cos(a) * d; z = WRECK[1] + Math.sin(a) * d; s = 0.5 + rng() * 1;
      } else if (r < 0.6) {
        // big boulders toward the edges
        x = (rng() < 0.5 ? -1 : 1) * (36 + rng() * 28); z = (rng() - 0.5) * 120; s = 1.5 + rng() * 2.5;
      } else {
        x = (rng() - 0.5) * 120; z = (rng() - 0.5) * 100; s = 0.3 + rng() * 0.9;
      }
      if (!isFree(x, z, s)) continue;
      lists[Math.floor(rng() * templates.length)].push([x, z, s]);
      placed++;
    }

    const m = new T.Matrix4();
    const q = new T.Quaternion();
    const c = new T.Color();
    templates.forEach((geo, ti) => {
      const list = lists[ti];
      if (!list.length) return;
      const mesh = new T.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, s], i) => {
        q.setFromEuler(new T.Euler(rng() * 0.3, rng() * Math.PI * 2, rng() * 0.3));
        m.compose(new T.Vector3(x, floorHeight(x, z) + s * 0.15, z), q, new T.Vector3(s, s * (0.7 + rng() * 0.5), s));
        mesh.setMatrixAt(i, m);
        const shade = 0.45 + rng() * 0.25;
        c.setRGB(shade * (1 + rng() * 0.1), shade * 0.97, shade * 0.9);
        mesh.setColorAt(i, c);
      });
      mesh.computeBoundingSphere();
      root.add(mesh);
    });
    super("Rocks & Boulders", root);
  }

  lookFromLookAt() {
    return [BEACON[0] + 12, 8, BEACON[1] + 12, BEACON[0], 1, BEACON[1]];
  }
}
