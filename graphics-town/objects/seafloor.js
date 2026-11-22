// @ts-check
/**
 * The sea floor: a grid mesh built by hand as a BufferGeometry (Workbook 5),
 * with heights from the noise terrain function and per-vertex colors
 * (sand, darker sand, rock on steep slopes, dark blue-grey in the trench).
 *
 * The material adds animated caustics through a TSL emissive node.
 */

import * as T from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { vertexColor } from "three/tsl";
import { GrObject } from "CS559-Framework/GrObject.js";
import { floorHeight, floorSlope } from "./terrain.js";
import { FLOOR_HALF } from "./layout.js";
import { fbm2, smoothstep, makeRng } from "./util/noise.js";
import { causticEmission } from "./shaders.js";

const SAND_LIGHT = [0.93, 0.84, 0.64];
const SAND_DARK = [0.74, 0.64, 0.47];
const ALGAE = [0.5, 0.6, 0.4];
const ROCK = [0.42, 0.39, 0.37];
const DEEP = [0.1, 0.16, 0.22];

/** @param {number[]} a @param {number[]} b @param {number} t */
function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export class SeaFloor extends GrObject {
  /** @param {number} [resolution=200] grid cells per side */
  constructor(resolution = 200) {
    const N = resolution;
    const size = FLOOR_HALF * 2;
    const positions = new Float32Array((N + 1) * (N + 1) * 3);
    const colors = new Float32Array((N + 1) * (N + 1) * 3);
    const rng = makeRng(4242);

    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -FLOOR_HALF + (i / N) * size;
        const z = -FLOOR_HALF + (j / N) * size;
        const y = floorHeight(x, z);
        const k = (j * (N + 1) + i) * 3;
        positions[k] = x;
        positions[k + 1] = y;
        positions[k + 2] = z;

        // color: sand patches, algae tint, rock where steep or high, dark in the trench
        let c = mix3(SAND_LIGHT, SAND_DARK, smoothstep(-0.4, 0.6, fbm2(x * 0.11, z * 0.11, 3)));
        c = mix3(c, ALGAE, 0.35 * smoothstep(0.25, 0.7, fbm2(x * 0.05 + 40, z * 0.05, 3)));
        const rocky = Math.max(smoothstep(0.45, 1.0, floorSlope(x, z)), smoothstep(3.5, 7, y));
        c = mix3(c, ROCK, rocky);
        c = mix3(c, DEEP, smoothstep(-2, -16, y));
        const speck = (rng() - 0.5) * 0.06;
        colors[k] = c[0] + speck;
        colors[k + 1] = c[1] + speck;
        colors[k + 2] = c[2] + speck;
      }
    }

    // two triangles per grid cell, counter-clockwise seen from above
    const indices = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        const b = a + 1;
        const c = a + (N + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new T.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    material.colorNode = vertexColor();
    material.emissiveNode = causticEmission(0.32);

    const mesh = new T.Mesh(geometry, material);
    super("Sea Floor", mesh);
  }

  lookFromLookAt() {
    return [0, 40, 70, 0, 0, -5];
  }
}
