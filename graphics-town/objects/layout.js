// @ts-check
/**
 * Where things are in Coralhaven. Keeping the layout in one place means the
 * objects that need to know about each other (the sub and its dock, the fish and
 * the buildings they avoid, ...) all agree.
 *
 * Coordinates: x = east, y = up, z = south (so north is -z).
 * The town square is at the origin.
 */

/** @typedef {[number, number, number]} Vec3 */

/** half-size of the sea floor (it goes from -FLOOR_HALF to +FLOOR_HALF) */
export const FLOOR_HALF = 75;

/** the water color - used for the background and the fog so they blend */
export const WATER_COLOR = 0x0e5a7a;

/** submarine route: closed cardinal spline. Index 0 is the dock. */
/** @type {Array<Vec3>} */
export const SUB_ROUTE = [
  [-24, 4.5, 20],
  [-8, 5.5, 28],
  [12, 8, 25],
  [31, 9, 6],
  [15, 11, -8],
  [4, 12, -31],
  [-18, 10, -33],
  [-39, 8, -14],
  [-37, 6, 8],
];
export const SUB_DOCK_INDEX = 0;

/** habitat domes [x, z, radius] */
/** @type {Array<[number, number, number]>} */
export const DOMES = [
  [0, -3, 6.5],
  [-13, 5, 4.2],
  [12, 6, 4.6],
  [-2, 13, 3.6],
];

/** tram loop around the domes (closed spline) - y is the rail height */
/** @type {Array<Vec3>} */
export const TRAM_ROUTE = [
  [-19, 1.6, 10],
  [-8, 1.6, 19],
  [6, 1.6, 17],
  [18, 1.6, 12],
  [17, 1.6, -4],
  [8, 1.6, -13],
  [-7, 1.6, -13],
  [-18, 1.6, -3],
];

/** the shipwreck [x, z, heading] */
export const WRECK = [-30, -19, 0.7];

/** the beacon tower stands on a rock outcrop */
export const BEACON = [-24, -4];

/** kelp forest [x, z, radius] */
export const KELP = [27, -19, 10];

/** hydrothermal vents */
/** @type {Array<[number, number]>} */
export const VENTS = [
  [33, 21],
  [36, 26],
  [30, 27],
];

/** crab flats [x, z, radius] */
export const CRAB_FLATS = [4, 27, 8];

/** mining rig [x, z] and the spoil heap it dumps onto */
export const MINING_RIG = [17, 30];
export const SPOIL_HEAP = [21, 33.5];

/** the moray eel's den (next to the wreck) [x, z] */
export const EEL_DEN = [-21.5, -13];

/** sea turtle loop (outside the domes, among the coral) */
/** @type {Array<Vec3>} */
export const TURTLE_ROUTE = [
  [22, 6, 14], [31, 8, -5], [16, 9, -31], [-6, 7, -24], [-21, 6, -26],
  [-31, 7, 3], [-17, 6, 27], [6, 6, 31],
];

/** manta ray: a big, high loop */
/** @type {Array<Vec3>} */
export const MANTA_ROUTE = [
  [0, 17, -38], [30, 19, -30], [43, 18, 4], [28, 20, 32], [-4, 18, 41],
  [-36, 19, 26], [-45, 17, -6], [-28, 18, -35],
];

/** shark patrol loop */
/** @type {Array<Vec3>} */
export const SHARK_ROUTE = [
  [-10, 10, -31], [14, 11, -31], [35, 9, 0], [24, 12, 27], [-8, 10, 33],
  [-35, 11, 16], [-37, 9, -14],
];

/** where the school forms drawn shapes: center of a vertical plane facing +z */
/** @type {Vec3} */
export const SHAPE_CENTER = [0, 19, -4];
export const SHAPE_SIZE = 20;

/** the fish school's home region (center, half-extent) */
/** @type {Vec3} */
export const SCHOOL_CENTER = [0, 10, -6];
/** @type {Vec3} */
export const SCHOOL_EXTENT = [32, 7, 26];

/**
 * simple obstacles (vertical cylinders) that swimmers steer around: [x, z, radius, height]
 * @type {Array<[number, number, number, number]>}
 */
export const OBSTACLES = [
  ...DOMES.map(([x, z, r]) => /** @type {[number, number, number, number]} */ ([x, z, r + 1.5, r + 1])),
  [BEACON[0], BEACON[1], 3, 16],
  [WRECK[0], WRECK[1], 8, 7],
];
