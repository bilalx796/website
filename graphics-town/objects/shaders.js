// @ts-check
/**
 * Shaders for the reef, written in TSL (three.js Shading Language), since the
 * framework uses the WebGPU renderer.
 *
 * TSL builds a shader from JavaScript function calls: each call (sin, mul, add...)
 * makes a node in a shader graph, and three compiles the graph to WGSL (or GLSL
 * when it falls back to WebGL2).
 *
 * Uniforms here are shared by every material that uses them; the environment
 * object updates their values once per frame.
 */

import {
  Fn, uniform, vec2, vec3, float, sin, cos, abs, pow, max, clamp,
  positionWorld, normalWorld, smoothstep,
} from "three/tsl";

/** world time in seconds (respects pause / speed) */
export const uTime = uniform(0.0);
/** 1 in the day, 0 at night */
export const uDaylight = uniform(1.0);
/** 1 at night, 0 in the day */
export const uNight = uniform(0.0);

/**
 * Caustics: the rippling web of bright light that waves focus onto the sea floor.
 *
 * Real caustics come from light refracting through a wavy surface. We fake the
 * look: sum three sine waves running in different directions over a domain-warped
 * position. Where the sum crosses zero we get thin bright lines, and because the
 * waves move at different speeds the lines form a shifting web.
 * Two layers at different scales are added for detail.
 */
export const causticPattern = Fn(([p, t]) => {
  // layer 1 - big cells
  const w1a = p.mul(0.33);
  const w1 = w1a.add(vec2(sin(w1a.y.mul(1.7).add(t)), cos(w1a.x.mul(1.3).sub(t.mul(0.8)))).mul(0.55));
  const v1 = sin(w1.x.mul(2.1).add(t))
    .add(sin(w1.y.mul(2.3).sub(t.mul(1.1))))
    .add(sin(w1.x.add(w1.y).mul(1.6).add(t.mul(0.6))));
  const c1 = pow(max(float(0), float(1).sub(abs(v1).mul(0.9))), float(3));

  // layer 2 - fine detail, moving the other way
  const w2a = p.mul(0.85).add(vec2(13.1, 7.7));
  const w2 = w2a.add(vec2(cos(w2a.y.mul(1.1).sub(t.mul(1.2))), sin(w2a.x.mul(1.5).add(t))).mul(0.5));
  const v2 = sin(w2.x.mul(1.9).sub(t.mul(1.3)))
    .add(sin(w2.y.mul(2.2).add(t.mul(0.9))))
    .add(sin(w2.x.sub(w2.y).mul(1.4).sub(t.mul(0.5))));
  const c2 = pow(max(float(0), float(1).sub(abs(v2).mul(0.9))), float(3));

  return c1.add(c2.mul(0.55));
});

/**
 * Light emitted by caustics at this fragment: only on surfaces that face up,
 * fading with depth, and only during the day.
 * @param {number} [strength=0.55]
 */
export function causticEmission(strength = 0.55) {
  const c = causticPattern(positionWorld.xz, uTime.mul(0.7));
  const facingUp = clamp(normalWorld.y, 0, 1);
  const depthFade = smoothstep(-22.0, 2.0, positionWorld.y);
  return vec3(0.55, 0.92, 1.0).mul(c).mul(facingUp).mul(depthFade).mul(uDaylight).mul(strength);
}
