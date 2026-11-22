// @ts-check
/**
 * Seeded random numbers and 2D/3D gradient noise.
 *
 * The noise is gradient ("Perlin-style") noise: a random gradient lives at each
 * integer lattice point, and a point's value blends the dot products with the
 * gradients of the surrounding corners using a smooth fade curve.
 * The algorithm follows Ken Perlin's "Improved Noise" (2002); this is our own
 * implementation of that published algorithm.
 *
 * fbm = "fractal Brownian motion": several octaves of noise added together,
 * each one with double the frequency and half the amplitude.
 */

/**
 * small fast seeded random number generator (mulberry32)
 * @param {number} seed
 * @returns {() => number} function returning numbers in [0,1)
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// permutation table (doubled to avoid wrapping)
const perm = new Uint8Array(512);
{
  const rng = makeRng(559);
  const p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

/** @param {number} t */
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
/** @param {number} a @param {number} b @param {number} t */
function lerp(a, b, t) {
  return a + (b - a) * t;
}
/** 2D gradient: pick one of 8 directions from the hash */
function grad2(hash, x, y) {
  switch (hash & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}
/** 3D gradient: one of the 12 cube-edge directions */
function grad3(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * 2D gradient noise, roughly in [-1, 1]
 * @param {number} x @param {number} y
 */
export function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const X = xi & 255;
  const Y = yi & 255;
  const xf = x - xi;
  const yf = y - yi;
  const u = fade(xf);
  const v = fade(yf);
  const aa = perm[perm[X] + Y];
  const ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y];
  const bb = perm[perm[X + 1] + Y + 1];
  const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v) * 0.7;
}

/**
 * 3D gradient noise, roughly in [-1, 1] (used with time as the 3rd coordinate)
 * @param {number} x @param {number} y @param {number} z
 */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const X = xi & 255, Y = yi & 255, Z = zi & 255;
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad3(perm[AA], xf, yf, zf), grad3(perm[BA], xf - 1, yf, zf), u),
      lerp(grad3(perm[AB], xf, yf - 1, zf), grad3(perm[BB], xf - 1, yf - 1, zf), u),
      v
    ),
    lerp(
      lerp(grad3(perm[AA + 1], xf, yf, zf - 1), grad3(perm[BA + 1], xf - 1, yf, zf - 1), u),
      lerp(grad3(perm[AB + 1], xf, yf - 1, zf - 1), grad3(perm[BB + 1], xf - 1, yf - 1, zf - 1), u),
      v
    ),
    w
  );
}

/**
 * fractal noise: sum of octaves
 * @param {number} x @param {number} y
 * @param {number} [octaves=4]
 */
export function fbm2(x, y, octaves = 4) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise2(x * freq + o * 17.3, y * freq - o * 9.1);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * smoothstep, like GLSL
 * @param {number} a @param {number} b @param {number} x
 */
export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
