// @ts-check
/**
 * Shared state for the whole reef.
 *
 * The environment object updates this at the start of every step (it is the
 * first object added to the world, so it steps first). Everything else reads it:
 * e.g. dome windows read `night` to turn on, the fish read `night` to glow.
 *
 * `time` is accumulated from the stepWorld delta, so it stops when the world is
 * paused and speeds up with the speed slider.
 */
export const reef = {
  /** seconds of (scaled) world time since start */
  time: 0,
  /** hours on the reef clock, 0-24 */
  hours: 10,
  /** 1 = full day, 0 = full night (smoothly blended) */
  daylight: 1,
  /** 1 - daylight */
  night: 0,
  /** "cycle" (automatic), "day" or "night" - set from the Reef panel */
  mode: "cycle",
  /** real seconds (at speed 1) for one full day on the reef clock */
  dayLength: 150,
  /** 0..1: how red / bloodthirsty the water is (Shark Frenzy game) */
  blood: 0,
  /** water current direction/strength (changes slowly) */
  current: [0.6, 0.2],
  /** objects that other objects need to find (filled in by main) */
  /** @type {Record<string, any>} */
  objects: {},
};
