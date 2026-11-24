// @ts-check
/**
 * Keeping Coralhaven smooth on slower computers.
 *
 *  - ADAPTIVE RESOLUTION: the frame rate is measured all the time. When it
 *    drops, the canvas renders at fewer pixels (a lower pixel ratio) and is
 *    scaled up; when there's room to spare it goes back up, to the screen's
 *    full sharpness on high-DPI displays (capped at 2x). Fill rate (fog and the
 *    big transparent domes) is what slow GPUs struggle with, so this is the
 *    biggest single win, and fast machines get a sharper picture.
 *  - DON'T DRAW WHEN NOBODY CAN SEE IT: while the canvas is scrolled off the
 *    page, the world keeps animating but nothing is rendered.
 *  - DISTANCE CULLING: detailed things that are only worth drawing up close
 *    (the dome interiors: furniture, screens, people) are hidden when the camera
 *    is far away (the fog and glass hide them there anyway). Hysteresis keeps
 *    them from flickering at the boundary.
 *
 * Elsewhere: people, coral, fish, rocks and anemones are instanced or merged so
 * one material draws many objects at once; textures are loaded once and shared
 * (texturePack).
 */

import * as T from "three";

/**
 * @param {import("CS559-Framework/GrWorld.js").GrWorld} world
 * @param {HTMLElement} [label] - optional element that shows the current quality
 */
export function makePerformanceGovernor(world, label) {
  const renderer = /** @type {any} */ (world.renderer);
  const maxRatio = Math.min(2, window.devicePixelRatio || 1);
  const minRatio = 0.6;
  let ratio = Math.min(1, maxRatio);
  renderer.setPixelRatio(ratio);

  // ---- don't render while the canvas is off screen
  let onScreen = true;
  const canvas = renderer.domElement;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(entries => {
      onScreen = entries.some(e => e.isIntersecting);
    }).observe(canvas);
  }
  const draw = world.draw.bind(world);
  world.draw = () => {
    if (onScreen && !document.hidden) draw();
  };

  // ---- adaptive resolution
  let frames = 0;
  let windowStart = performance.now();
  let goodWindows = 0;
  let settle = 2; // ignore the first windows (loading, shader compiles)
  const setRatio = r => {
    r = Math.round(Math.max(minRatio, Math.min(maxRatio, r)) * 20) / 20;
    if (r === ratio) return;
    ratio = r;
    renderer.setPixelRatio(ratio); // (this resizes the drawing buffer too)
  };

  /** @type {Array<{obj: T.Object3D, center: T.Vector3, far: number, onHide?: () => void}>} */
  const culled = [];
  const camPos = new T.Vector3();
  let cullTick = 0;

  return {
    /**
     * hide `obj` when the camera is more than `far` from `center`
     * @param {T.Object3D} obj @param {T.Vector3} center @param {number} far
     */
    cullByDistance(obj, center, far) {
      culled.push({ obj, center: center.clone(), far });
    },

    get pixelRatio() {
      return ratio;
    },

    /** call once per frame (before drawing) */
    update() {
      // distance culling (a few times a second is plenty)
      if (++cullTick % 6 === 0) {
        world.active_camera.getWorldPosition(camPos);
        for (const c of culled) {
          const d = camPos.distanceTo(c.center);
          // hysteresis: hide beyond `far`, show again inside 90% of it
          if (c.obj.visible && d > c.far) c.obj.visible = false;
          else if (!c.obj.visible && d < c.far * 0.9) c.obj.visible = true;
        }
      }

      if (!onScreen || document.hidden) {
        windowStart = performance.now();
        frames = 0;
        return;
      }
      frames++;
      const now = performance.now();
      const span = now - windowStart;
      if (span < 1500) return;
      const fps = (frames * 1000) / span;
      frames = 0;
      windowStart = now;
      if (settle > 0) {
        settle--;
        return;
      }
      if (fps < 45) {
        // struggling: drop the resolution (more for bigger drops)
        setRatio(ratio * (fps < 25 ? 0.75 : 0.88));
        goodWindows = 0;
      } else if (fps > 57) {
        // comfortably smooth for a while: try a little sharper
        if (++goodWindows >= 3 && ratio < maxRatio) {
          setRatio(ratio + 0.15);
          goodWindows = 0;
        }
      } else {
        goodWindows = 0;
      }
      if (label) label.textContent = `${Math.round(fps)} fps · ${Math.round(ratio * 100)}% res`;
    },
  };
}
