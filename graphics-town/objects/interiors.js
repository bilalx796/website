// @ts-check
/**
 * What's inside each hub. Each builder adds its furniture to the dome's root
 * (in the dome's own coordinates, floor at y = Y) and returns:
 *   anims     - functions (t, dt) run every step (things that move)
 *   obstacles - circles [x, z, radius] the first-person walker can't enter
 *   spots     - free floor spots where visitors can stand / wander
 * Everything stays inside ~74% of the dome radius, leaving a walkway ring by
 * the glass, so every doorway and corridor can reach every part.
 *
 * Lots of small static parts are MERGED into one mesh per material (e.g. all
 * the chair legs in the cafeteria are one draw call), and blinking lights are
 * one InstancedMesh with per-instance colors.
 *
 *   cafeteria  - buffet line (counter, sneeze guard, food pans, heat lamps,
 *                trays, plates, drinks station), round tables with chairs,
 *                pendant lights, a menu board, a chef, and DINERS who line up,
 *                take a tray, sit down to eat, then come back for more
 *   botany     - a lab growing exotic plants: glowing bulb plants, curling
 *                spiral ferns, pitcher plants, spiky succulents and a giant
 *                leaf plant, hydroponic racks, bell jars, grow lights, and a
 *                scientist who walks between the beds inspecting them
 *   servers    - a data center: two rows of tall server racks with BLINKING
 *                LEDs, cable trays, a cooling unit with spinning fans, a
 *                glowing status ring overhead, and a technician
 *   computers  - a computer lab: desks with monitors SCROLLING code, office
 *                chairs, engineers working, a big curved wall display drawing
 *                LIVE GRAPHS, and server racks along the wall
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { glowMaterial, rackTexture, codeScreenTexture } from "./materials.js";
import { makePerson } from "./people.js";
import { reef } from "./reefState.js";

/** keep only position/normal/uv so different geometries can be merged */
function clean(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(ng.attributes)) if (!["position", "normal", "uv"].includes(n)) ng.deleteAttribute(n);
  if (!ng.attributes.uv) ng.setAttribute("uv", new T.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
  return ng;
}
/** collects geometries per material, then makes one mesh per material */
class Batch {
  constructor() {
    /** @type {Map<T.Material, T.BufferGeometry[]>} */
    this.map = new Map();
  }
  /** @param {T.Material} mat @param {T.BufferGeometry} geo */
  add(mat, geo) {
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(clean(geo));
    return geo;
  }
  /** @param {T.Object3D} parent */
  flush(parent) {
    for (const [mat, list] of this.map) parent.add(new T.Mesh(mergeGeometries(list), mat));
    this.map.clear();
  }
}
/** a box geometry placed at (x, y, z) (y = its bottom), turned by ry */
function box(w, h, d, x, y, z, ry = 0) {
  const g = new T.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
function cyl(rt, rb, h, x, y, z, seg = 12) {
  const g = new T.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}
const mat = (color, rough = 0.6, metal = 0) => new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

/** a walking helper: move a person toward a target; returns true when there */
function stepToward(person, target, speed, dt) {
  const p = person.position;
  const dx = target.x - p.x, dz = target.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.02) return true;
  const s = Math.min(d, speed * dt);
  p.x += (dx / d) * s;
  p.z += (dz / d) * s;
  person.rotation.y = Math.atan2(dx, dz);
  return d - s < 0.02;
}

// ---------------------------------------------------------------------------
export function buildCafeteria(root, { Y, rng }) {
  const anims = [], obstacles = [], spots = [];
  const B = new Batch();
  const steel = mat(0xc9d0d4, 0.25, 0.85);
  const teal = mat(0x2f7d8c, 0.5);
  const wood = mat(0xa8744a, 0.55);
  const dark = mat(0x2a2f36, 0.6);
  const chairMat = mat(0xe0663f, 0.5);
  const glass = new T.MeshStandardMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.5, depthWrite: false });

  // ---- buffet line along z = -2.7
  const LZ = -2.7;
  B.add(teal, box(4.6, 0.55, 0.6, 0, Y, LZ));
  B.add(dark, box(4.6, 0.08, 0.62, 0, Y, LZ));
  B.add(steel, box(4.75, 0.05, 0.72, 0, Y + 0.55, LZ));
  B.add(steel, box(4.7, 0.03, 0.12, 0, Y + 0.42, LZ + 0.4)); // tray rail
  for (let x = -2.2; x <= 2.21; x += 1.1) {
    B.add(steel, cyl(0.015, 0.015, 0.42, x, Y + 0.6, LZ + 0.22, 6)); // sneeze-guard posts
  }
  const guard = new T.Mesh(new T.PlaneGeometry(4.6, 0.36), glass);
  guard.position.set(0, Y + 0.95, LZ + 0.2);
  guard.rotation.x = -0.35;
  root.add(guard);
  // food pans with food
  const foods = [0x6fbf4a, 0xf2a03d, 0xd8453a, 0xf2d24a, 0x8a5a3a, 0xf2efe6, 0x4a8f3f, 0xe27c9c];
  const foodMats = foods.map(c => mat(c, 0.9));
  for (let k = 0; k < 8; k++) {
    const x = -1.9 + k * 0.54;
    B.add(steel, box(0.44, 0.06, 0.34, x, Y + 0.57, LZ));
    for (let m = 0; m < 3; m++) {
      const mound = new T.SphereGeometry(0.07 + rng() * 0.03, 8, 6);
      mound.scale(1.2, 0.45, 1);
      mound.translate(x - 0.12 + m * 0.12, Y + 0.64, LZ + (rng() - 0.5) * 0.15);
      B.add(foodMats[k], mound);
    }
  }
  // heat lamps hanging over the food
  B.add(steel, box(4.4, 0.04, 0.06, 0, Y + 1.45, LZ));
  const lampMat = glowMaterial(0xffa040, 1.2, 2.2);
  for (let k = 0; k < 4; k++) {
    const x = -1.65 + k * 1.1;
    B.add(steel, cyl(0.01, 0.01, 0.2, x, Y + 1.25, LZ, 4));
    const shade = new T.ConeGeometry(0.12, 0.12, 12, 1, true);
    shade.translate(x, Y + 1.2, LZ);
    B.add(steel, shade);
    const bulb = new T.SphereGeometry(0.05, 8, 6);
    bulb.translate(x, Y + 1.16, LZ);
    B.add(lampMat, bulb);
  }
  // trays and plates at the start, drinks station at the end
  for (let k = 0; k < 6; k++) B.add(mat(0x5a6a7a), box(0.32, 0.02, 0.24, -2.75, Y + 0.6 + k * 0.022, LZ));
  for (let k = 0; k < 8; k++) B.add(mat(0xf4f4f0, 0.3), cyl(0.09, 0.08, 0.012, -2.75, Y + 0.75 + k * 0.014, LZ + 0.25, 14));
  B.add(steel, box(0.55, 1.1, 0.5, 2.9, Y, LZ));
  const drinkPanel = glowMaterial(0x6fd6ff, 0.8, 1.8);
  B.add(drinkPanel, box(0.44, 0.4, 0.02, 2.9, Y + 0.6, LZ + 0.26));
  for (let k = 0; k < 3; k++) B.add(dark, box(0.05, 0.08, 0.06, 2.75 + k * 0.15, Y + 0.45, LZ + 0.28));
  obstacles.push([-2.0, LZ, 0.55], [-0.7, LZ, 0.55], [0.7, LZ, 0.55], [2.0, LZ, 0.55], [2.9, LZ, 0.45], [-2.75, LZ, 0.35]);

  // ---- menu board (canvas texture)
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 160;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  g.fillStyle = "#1d2a24";
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = "#ffd36a";
  g.font = "bold 26px sans-serif";
  g.fillText("CAFÉ CORAL", 46, 32);
  g.font = "18px sans-serif";
  g.fillStyle = "#f4f1ea";
  [["Kelp Salad", "4"], ["Sea-grape Soup", "5"], ["Coral Curry", "7"], ["Bubble Tea", "3"]].forEach(([n, p], i) => {
    g.fillText(n, 18, 66 + i * 24);
    g.fillText(p, 222, 66 + i * 24);
  });
  const menuTex = new T.CanvasTexture(c);
  menuTex.colorSpace = T.SRGBColorSpace;
  const menu = new T.Mesh(new T.PlaneGeometry(0.9, 0.56), new T.MeshStandardMaterial({ map: menuTex, emissive: 0xffffff, emissiveMap: menuTex, emissiveIntensity: 0.35 }));
  menu.position.set(-3.35, Y + 1.15, LZ + 0.9);
  menu.rotation.y = 0.9;
  root.add(menu);
  B.add(dark, cyl(0.03, 0.03, 0.85, -3.4, Y, LZ + 0.85, 6));

  // ---- round tables with four chairs each
  /** @type {Array<{seat: T.Vector3, face: number, lane: number, taken: boolean}>} */
  const seats = [];
  const tables = [[-2.4, 0], [0, 0], [2.4, 0], [-2.4, 2.35], [0, 2.35], [2.4, 2.35]];
  const cupMats = [mat(0xe85d4a), mat(0x4a8be8), mat(0xf2c14e)];
  for (const [tx, tz] of tables) {
    B.add(wood, cyl(0.46, 0.46, 0.04, tx, Y + 0.48, tz, 20));
    B.add(steel, cyl(0.04, 0.04, 0.48, tx, Y, tz, 8));
    B.add(steel, cyl(0.2, 0.22, 0.03, tx, Y, tz, 14));
    B.add(cupMats[Math.floor(rng() * 3)], cyl(0.03, 0.025, 0.07, tx + 0.15, Y + 0.52, tz - 0.1, 8));
    B.add(mat(0xf4f4f0, 0.3), cyl(0.1, 0.09, 0.012, tx - 0.12, Y + 0.52, tz + 0.08, 14));
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const sx = tx + Math.cos(a) * 0.68, sz = tz + Math.sin(a) * 0.68;
      const face = Math.atan2(tx - sx, tz - sz);
      B.add(chairMat, box(0.26, 0.04, 0.26, sx, Y + 0.28, sz, face));
      const back = new T.BoxGeometry(0.26, 0.28, 0.04);
      back.translate(0, 0.14, -0.13);
      back.rotateY(face);
      back.translate(sx, Y + 0.32, sz);
      B.add(chairMat, back);
      for (const [lx, lz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) {
        const leg = new T.CylinderGeometry(0.012, 0.012, 0.28, 4);
        leg.translate(lx, 0.14, lz);
        leg.rotateY(face);
        leg.translate(sx, Y, sz);
        B.add(steel, leg);
      }
      seats.push({ seat: new T.Vector3(sx, Y, sz), face, lane: tx + (sx > tx ? 1.2 : -1.2), taken: false });
    }
    obstacles.push([tx, tz, 0.95]);
    // pendant light above the table
    B.add(dark, cyl(0.008, 0.008, 1.6, tx, Y + 2.3, tz, 4));
    const shade = new T.ConeGeometry(0.22, 0.18, 16, 1, true);
    shade.translate(tx, Y + 2.3, tz);
    B.add(mat(0x2f7d8c, 0.4, 0.3), shade);
    const bulb = new T.SphereGeometry(0.07, 10, 8);
    bulb.translate(tx, Y + 2.22, tz);
    B.add(glowMaterial(0xffe2a0, 0.6, 2.4), bulb);
  }
  // potted plants
  for (const [px, pz] of [[-3.6, 1.2], [3.6, 1.2], [3.4, -1.4]]) {
    B.add(mat(0x8a5a3a), cyl(0.18, 0.14, 0.3, px, Y, pz, 12));
    const bush = new T.IcosahedronGeometry(0.3, 1);
    bush.translate(px, Y + 0.55, pz);
    B.add(mat(0x4f8f3a, 0.8), bush);
    obstacles.push([px, pz, 0.35]);
  }
  B.flush(root);

  // ---- the chef walks back and forth behind the counter
  const chef = makePerson(0xffffff, { chefHat: true });
  chef.position.set(0, Y, LZ - 0.6);
  root.add(chef);
  let chefTarget = 1.8;
  anims.push((t, dt) => {
    if (stepToward(chef, new T.Vector3(chefTarget, Y, LZ - 0.6), 0.6, dt)) {
      chefTarget = -chefTarget * (0.5 + rng() * 0.5);
      if (Math.abs(chefTarget) < 0.5) chefTarget = 1.8;
    }
    if (Math.abs(chef.position.x - chefTarget) < 0.05) chef.rotation.y = 0; // face the counter while serving
  });

  // ---- diners: queue -> buffet -> seat -> eat -> back to the queue
  const shirts = [0xe85d4a, 0x4a8be8, 0xf2c14e, 0x6bc46b, 0xb06ad8, 0xf28c4e, 0x47c6c6];
  const lineZ = LZ + 0.75;
  const diners = [];
  for (let k = 0; k < 7; k++) {
    const p = makePerson(shirts[k]);
    const tray = new T.Mesh(new T.BoxGeometry(0.22, 0.02, 0.16), mat(0x5a6a7a));
    tray.position.set(0, 0.34, 0.16);
    tray.visible = false;
    p.add(tray);
    root.add(p);
    const d = { p, tray, state: "queue", path: [], seat: null, timer: rng() * 6 };
    // half of them start out already eating
    const free = seats.filter(s => !s.taken);
    if (k % 2 === 0 && free.length) {
      d.seat = free[Math.floor(rng() * free.length)];
      d.seat.taken = true;
      d.state = "eating";
      d.timer = 3 + rng() * 10;
      p.position.copy(d.seat.seat);
      p.rotation.y = d.seat.face;
      tray.visible = true;
    } else {
      p.position.set(-3.0 + rng() * 0.5, Y, lineZ);
    }
    diners.push(d);
  }
  anims.push((t, dt) => {
    for (const d of diners) {
      const p = d.p;
      if (d.state === "queue") {
        // shuffle along the buffet, pausing at the food
        const x = p.position.x;
        const pause = Math.sin(x * 6) > 0.7;
        stepToward(p, new T.Vector3(2.3, Y, lineZ), pause ? 0.12 : 0.4, dt);
        p.rotation.y = -Math.PI / 2 + Math.PI; // face along the line
        if (x > -2.5) d.tray.visible = true;
        if (x >= 2.28) {
          const free = seats.filter(s => !s.taken);
          if (free.length) {
            d.seat = free[Math.floor(rng() * free.length)];
            d.seat.taken = true;
            // walk the aisle, then down the lane between tables, then to the chair
            d.path = [new T.Vector3(d.seat.lane, Y, -1.2), new T.Vector3(d.seat.lane, Y, d.seat.seat.z), d.seat.seat.clone()];
            d.state = "toSeat";
          }
        }
      } else if (d.state === "toSeat" || d.state === "leave") {
        if (d.path.length && stepToward(p, d.path[0], 0.7, dt)) d.path.shift();
        if (!d.path.length) {
          if (d.state === "toSeat") {
            d.state = "eating";
            d.timer = 6 + rng() * 10;
            p.rotation.y = d.seat.face;
          } else {
            d.state = "queue";
          }
        }
      } else if (d.state === "eating") {
        d.timer -= dt;
        // sit a little lower, nod while eating
        p.position.y = Y - 0.08;
        const head = p.getObjectByName("head");
        if (head) head.position.y = 0.6 - 0.025 * Math.max(0, Math.sin(t * 5 + p.id));
        if (d.timer <= 0) {
          p.position.y = Y;
          d.seat.taken = false;
          d.tray.visible = false;
          d.path = [new T.Vector3(d.seat.lane, Y, d.seat.seat.z), new T.Vector3(d.seat.lane, Y, -1.2), new T.Vector3(-3.0, Y, -1.2), new T.Vector3(-3.0, Y, lineZ)];
          d.state = "leave";
          d.seat = null;
        }
      }
    }
  });
  for (let x = -3; x <= 3; x += 1.5) spots.push(new T.Vector3(x, Y, -1.2));
  spots.push(new T.Vector3(-1.2, Y, 1.2), new T.Vector3(1.2, Y, 1.2), new T.Vector3(0, Y, 3.6));
  return { anims, obstacles, spots };
}

// ---------------------------------------------------------------------------
export function buildBotany(root, { Y, rng }) {
  const anims = [], obstacles = [], spots = [];
  const B = new Batch();
  const soil = mat(0x4a3424, 0.95);
  const planter = mat(0x6f7b82, 0.5, 0.4);
  const stem = mat(0x3f7a3a, 0.7);
  const white = mat(0xf1f4f5, 0.4, 0.2);

  // ---- central round bed with the giant leaf plant
  B.add(planter, cyl(0.95, 1.0, 0.32, 0, Y, 0, 28));
  B.add(soil, cyl(0.9, 0.9, 0.04, 0, Y + 0.3, 0, 28));
  obstacles.push([0, 0, 1.15]);
  const giant = new T.Group();
  giant.position.set(0, Y + 0.32, 0);
  root.add(giant);
  const trunk = new T.Mesh(new T.CylinderGeometry(0.06, 0.1, 0.9, 8), stem);
  trunk.position.y = 0.45;
  giant.add(trunk);
  const leafMat = new T.MeshStandardMaterial({ color: 0x2f9a5a, roughness: 0.6, side: T.DoubleSide });
  /** @type {T.Object3D[]} */
  const leaves = [];
  for (let k = 0; k < 7; k++) {
    const pivot = new T.Group();
    pivot.position.y = 0.85;
    pivot.rotation.y = (k / 7) * Math.PI * 2;
    const leaf = new T.Mesh(new T.SphereGeometry(0.5, 12, 6), leafMat);
    leaf.scale.set(0.28, 0.03, 1);
    leaf.position.z = 0.45;
    leaf.rotation.x = 0.5;
    pivot.add(leaf);
    giant.add(pivot);
    leaves.push(pivot);
  }
  anims.push(t => leaves.forEach((l, k) => (l.rotation.x = 0.15 * Math.sin(t * 0.9 + k))));

  // ---- beds around the room, each with a different exotic plant
  const glowMats = [];
  const bedAngles = [0.4, 1.6, 2.8, 4.0, 5.2];
  bedAngles.forEach((a, i) => {
    const bx = Math.cos(a) * 1.9, bz = Math.sin(a) * 1.9;
    B.add(planter, box(0.7, 0.28, 0.5, bx, Y, bz, -a));
    B.add(soil, box(0.64, 0.03, 0.44, bx, Y + 0.27, bz, -a));
    obstacles.push([bx, bz, 0.5]);
    const gy = Y + 0.3;
    const kind = i % 5;
    if (kind === 0) {
      // glowing bulb plants: curved stalks with pulsing glowing bulbs
      for (let k = 0; k < 4; k++) {
        const ox = bx + (rng() - 0.5) * 0.4, oz = bz + (rng() - 0.5) * 0.25;
        const h = 0.4 + rng() * 0.4;
        const curve = new T.QuadraticBezierCurve3(new T.Vector3(ox, gy, oz), new T.Vector3(ox + 0.1, gy + h * 0.6, oz), new T.Vector3(ox - 0.05, gy + h, oz + 0.05));
        B.add(stem, new T.TubeGeometry(curve, 8, 0.015, 5));
        const gm = new T.MeshStandardMaterial({ color: 0x9ff7ff, emissive: k % 2 ? 0x40e0ff : 0xff60d0, emissiveIntensity: 1.5 });
        glowMats.push(gm);
        const bulb = new T.Mesh(new T.SphereGeometry(0.07, 12, 8), gm);
        bulb.position.copy(curve.getPoint(1));
        root.add(bulb);
      }
    } else if (kind === 1) {
      // spiral ferns: tubes along spiral curves (curled fronds)
      for (let k = 0; k < 3; k++) {
        const pts = [];
        const ox = bx + (k - 1) * 0.18;
        for (let s = 0; s <= 24; s++) {
          const u = s / 24;
          const rr = 0.18 * (1 - u * 0.8);
          const ang = u * Math.PI * 3;
          pts.push(new T.Vector3(ox + rr * Math.sin(ang) * 0.3, gy + u * 0.35 + rr * Math.cos(ang) * 0.5, bz + rr * Math.sin(ang)));
        }
        B.add(mat(0x5fb83a, 0.6), new T.TubeGeometry(new T.CatmullRomCurve3(pts), 40, 0.018, 5));
      }
    } else if (kind === 2) {
      // pitcher plants: cups made by turning a profile (lathe), with lids
      for (let k = 0; k < 3; k++) {
        const prof = [[0.001, 0], [0.05, 0.02], [0.07, 0.12], [0.055, 0.22], [0.07, 0.28]].map(([x, y]) => new T.Vector2(x, y));
        const cup = new T.LatheGeometry(prof, 14);
        const px = bx + (k - 1) * 0.2;
        cup.translate(px, gy, bz);
        B.add(new T.MeshStandardMaterial({ color: [0xa02a4a, 0x7a2a8a, 0xb84a2a][k], roughness: 0.5, side: T.DoubleSide }), cup);
        const lid = new T.SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
        lid.scale(1, 0.3, 1);
        lid.translate(px + 0.03, gy + 0.32, bz);
        B.add(mat(0x6a2a3a), lid);
      }
    } else if (kind === 3) {
      // spiky succulents: clusters of cones
      for (let k = 0; k < 12; k++) {
        const cone = new T.ConeGeometry(0.03, 0.22 + rng() * 0.12, 6);
        cone.translate(0, 0.11, 0);
        cone.rotateZ((rng() - 0.5) * 1.2);
        cone.rotateY(rng() * 6);
        cone.translate(bx + (rng() - 0.5) * 0.35, gy, bz + (rng() - 0.5) * 0.2);
        B.add(mat(0x6aa88a, 0.5), cone);
      }
    } else {
      // tall striped flower stalks with glowing tips
      for (let k = 0; k < 3; k++) {
        const ox = bx + (k - 1) * 0.18;
        B.add(mat(0x3a6a2a), cyl(0.012, 0.016, 0.6, ox, gy, bz, 5));
        const gm = new T.MeshStandardMaterial({ color: 0xffe0f0, emissive: 0xffa0e0, emissiveIntensity: 1.2 });
        glowMats.push(gm);
        const tip = new T.Mesh(new T.ConeGeometry(0.06, 0.16, 8), gm);
        tip.position.set(ox, gy + 0.68, bz);
        tip.rotation.x = Math.PI;
        root.add(tip);
      }
    }
  });
  anims.push(t => glowMats.forEach((m, k) => (m.emissiveIntensity = 0.9 + 0.8 * Math.sin(t * 1.8 + k * 1.3) + 0.6 * reef.night)));

  // ---- hydroponic rack: a frame with pipes and little plant pods
  const rack = (rx, rz, ry) => {
    const g = new T.Group();
    g.position.set(rx, Y, rz);
    g.rotation.y = ry;
    root.add(g);
    const fb = new Batch();
    for (const sx of [-0.45, 0.45]) fb.add(white, box(0.04, 1.3, 0.04, sx, 0, 0));
    for (let k = 0; k < 3; k++) {
      const pipe = new T.CylinderGeometry(0.04, 0.04, 0.9, 10);
      pipe.rotateZ(Math.PI / 2);
      pipe.translate(0, 0.35 + k * 0.38, 0);
      fb.add(white, pipe);
      for (let m = 0; m < 5; m++) {
        const pod = new T.IcosahedronGeometry(0.06, 0);
        pod.translate(-0.36 + m * 0.18, 0.43 + k * 0.38, 0);
        fb.add(mat(0x6fd04a, 0.7), pod);
      }
      fb.add(glowMaterial(0xc060ff, 0.9, 1.8), box(0.85, 0.02, 0.03, 0, 0.62 + k * 0.38, -0.06));
    }
    fb.flush(g);
  };
  rack(0, -2.55, 0);
  obstacles.push([0, -2.55, 0.5]);

  // ---- bell jars with glowing specimens
  for (const [jx, jz] of [[-2.35, 0.6], [2.35, -0.6]]) {
    B.add(white, cyl(0.16, 0.2, 0.55, jx, Y, jz, 14));
    const jar = new T.Mesh(
      new T.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new T.MeshStandardMaterial({ color: 0xe6f8ff, transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false })
    );
    jar.scale.y = 1.6;
    jar.position.set(jx, Y + 0.55, jz);
    root.add(jar);
    const gm = new T.MeshStandardMaterial({ color: 0xbaff9a, emissive: 0x7aff4a, emissiveIntensity: 1 });
    glowMats.push(gm);
    const spec = new T.Mesh(new T.DodecahedronGeometry(0.06, 0), gm);
    spec.position.set(jx, Y + 0.66, jz);
    root.add(spec);
    anims.push(t => (spec.rotation.y = t));
    obstacles.push([jx, jz, 0.3]);
  }

  // ---- grow-light truss overhead
  const growMat = glowMaterial(0xd060ff, 1.2, 2.0);
  for (let k = 0; k < 3; k++) B.add(growMat, box(3.2, 0.04, 0.1, 0, Y + 2.35, (k - 1) * 0.9));
  B.add(white, box(3.4, 0.04, 0.04, 0, Y + 2.42, 0));
  B.flush(root);

  // ---- the scientist inspects the beds
  const sci = makePerson(0x4a8be8, { coat: true, clipboard: true });
  root.add(sci);
  const stops = bedAngles.map(a => new T.Vector3(Math.cos(a) * 2.75, Y, Math.sin(a) * 2.75));
  let stop = 0, wait = 2;
  sci.position.copy(stops[0]);
  anims.push((t, dt) => {
    if (wait > 0) {
      wait -= dt;
      sci.rotation.y = Math.atan2(-sci.position.x, -sci.position.z); // face the bed
      const head = sci.getObjectByName("head");
      if (head) head.rotation.x = 0.35; // looking down at the plants
      return;
    }
    const head = sci.getObjectByName("head");
    if (head) head.rotation.x = 0;
    if (stepToward(sci, stops[stop], 0.5, dt)) {
      stop = (stop + 1) % stops.length;
      wait = 2 + rng() * 2;
    }
  });
  for (const a of [0, 1.2, 2.4, 3.6, 4.8]) spots.push(new T.Vector3(Math.cos(a) * 2.7, Y, Math.sin(a) * 2.7));
  return { anims, obstacles, spots };
}

// ---------------------------------------------------------------------------
/**
 * a row of server racks with blinking LEDs (helper for the two computer hubs)
 * @returns {{leds: T.InstancedMesh, count: number}}
 */
function serverRow(root, B, { Y, x0, z, n, face, rng }) {
  const body = mat(0x1d2126, 0.5, 0.4);
  const front = new T.MeshStandardMaterial({ map: rackTexture(), roughness: 0.6, metalness: 0.3 });
  const tray = mat(0xf2b630, 0.5, 0.3);
  const W = 0.52, H = 1.85, D = 0.8;
  const fz = z + face * (D / 2 + 0.005); // front face z
  const LED_PER = 14;
  const leds = new T.InstancedMesh(new T.BoxGeometry(0.035, 0.02, 0.01), new T.MeshBasicMaterial({ color: 0xffffff }), n * LED_PER);
  const m = new T.Matrix4();
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (W + 0.02);
    B.add(body, box(W, H, D, x, Y, z));
    const panel = new T.PlaneGeometry(W - 0.04, H - 0.08);
    if (face < 0) panel.rotateY(Math.PI);
    panel.translate(x, Y + H / 2, fz);
    B.add(front, panel);
    for (let k = 0; k < LED_PER; k++) {
      m.makeTranslation(x - W / 2 + 0.06 + (k % 2) * 0.05, Y + 0.12 + Math.floor(k / 2) * 0.24 + rng() * 0.04, fz + face * 0.01);
      leds.setMatrixAt(i * LED_PER + k, m);
      leds.setColorAt(i * LED_PER + k, new T.Color(0x113311));
    }
  }
  // cable tray running above the row, with cables dropping into each rack
  const len = n * (W + 0.02);
  B.add(tray, box(len + 0.2, 0.05, 0.3, x0 - W / 2 + len / 2 - 0.01, Y + H + 0.3, z));
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (W + 0.02);
    for (const off of [-0.12, 0.08]) B.add(mat([0x3a7fd0, 0xd04a3a, 0x40b060][i % 3]), cyl(0.015, 0.015, 0.3, x + off, Y + H, z, 5));
  }
  root.add(leds);
  return { leds, count: n * LED_PER };
}

/** blink a set of LEDs: each one has its own rhythm, some green, some amber/blue */
function blinker(rows, rng) {
  const palette = [new T.Color(0x40ff60), new T.Color(0x40ff60), new T.Color(0x40ff60), new T.Color(0xffb020), new T.Color(0x40a0ff)];
  const off = new T.Color(0x0c1a0e);
  const info = rows.map(r => Array.from({ length: r.count }, () => ({ c: palette[Math.floor(rng() * palette.length)], rate: 1 + rng() * 9, ph: rng() * 6 })));
  return t => {
    rows.forEach((r, ri) => {
      info[ri].forEach((l, k) => r.leds.setColorAt(k, Math.sin(t * l.rate + l.ph) > -0.2 ? l.c : off));
      if (r.leds.instanceColor) r.leds.instanceColor.needsUpdate = true;
    });
  };
}

export function buildServerRoom(root, { Y, rng }) {
  const anims = [], obstacles = [], spots = [];
  const B = new Batch();
  // two rows facing each other across a cold aisle (fronts toward the aisle at z = 0)
  const rows = [
    serverRow(root, B, { Y, x0: -1.3, z: -1.05, n: 5, face: 1, rng }),
    serverRow(root, B, { Y, x0: -1.3, z: 1.05, n: 5, face: -1, rng }),
  ];
  for (let x = -1.3; x <= 1.0; x += 0.54) obstacles.push([x, -1.05, 0.48], [x, 1.05, 0.48]);
  anims.push(blinker(rows, rng));

  // cooling unit at the end of the aisle, with two spinning fans
  const steel = mat(0xb8c0c6, 0.3, 0.7);
  B.add(steel, box(0.7, 1.5, 1.1, 2.3, Y, 0));
  B.add(mat(0x2a2f36), box(0.02, 0.9, 0.9, 1.94, Y + 0.45, 0));
  obstacles.push([2.3, 0, 0.7]);
  /** @type {T.Group[]} */
  const fans = [];
  for (const fz of [-0.25, 0.25]) {
    const fan = new T.Group();
    fan.position.set(1.92, Y + 0.95, fz);
    root.add(fan);
    for (let k = 0; k < 5; k++) {
      const blade = new T.Mesh(new T.BoxGeometry(0.01, 0.17, 0.05), steel);
      blade.position.y = 0.085;
      const h = new T.Group();
      h.rotation.x = (k / 5) * Math.PI * 2;
      h.add(blade);
      fan.add(h);
    }
    const ring = new T.Mesh(new T.TorusGeometry(0.2, 0.015, 6, 20), steel);
    ring.rotation.y = Math.PI / 2;
    fan.add(ring);
    fans.push(fan);
  }
  anims.push((t, dt) => fans.forEach(f => (f.rotation.x += dt * 14)));

  // a glowing status ring above the aisle, slowly turning, segments pulsing
  const ring = new T.Group();
  ring.position.set(0, Y + 2.75, 0);
  root.add(ring);
  const segMats = [];
  for (let k = 0; k < 12; k++) {
    const sm = new T.MeshStandardMaterial({ color: 0x0a2030, emissive: 0x40e0ff, emissiveIntensity: 1 });
    segMats.push(sm);
    const seg = new T.Mesh(new T.TorusGeometry(0.9, 0.04, 6, 6, (Math.PI * 2) / 12 - 0.06), sm);
    seg.rotation.x = Math.PI / 2;
    seg.rotation.z = (k / 12) * Math.PI * 2;
    ring.add(seg);
  }
  anims.push((t, dt) => {
    ring.rotation.y += dt * 0.4;
    segMats.forEach((m, k) => (m.emissiveIntensity = 0.4 + 1.4 * Math.max(0, Math.sin(t * 2 - k * 0.6))));
  });
  B.flush(root);

  // a technician walks the aisle and checks racks
  const tech = makePerson(0x47c6c6, { clipboard: true });
  root.add(tech);
  const stops = [new T.Vector3(-1.6, Y, 0), new T.Vector3(-0.3, Y, 0), new T.Vector3(0.9, Y, 0)];
  let stop = 0, wait = 1.5;
  tech.position.copy(stops[0]);
  anims.push((t, dt) => {
    if (wait > 0) {
      wait -= dt;
      tech.rotation.y = stop % 2 ? 0 : Math.PI; // face a rack
      return;
    }
    if (stepToward(tech, stops[stop], 0.5, dt)) {
      stop = (stop + 1) % stops.length;
      wait = 1.5 + rng() * 2;
    }
  });
  spots.push(new T.Vector3(-2.2, Y, 0), new T.Vector3(0, Y, 2.4), new T.Vector3(0, Y, -2.4), new T.Vector3(-2.4, Y, 1.4));
  return { anims, obstacles, spots };
}

export function buildComputerLab(root, { Y, rng }) {
  const anims = [], obstacles = [], spots = [];
  const B = new Batch();
  const deskMat = mat(0xe8e2d6, 0.5);
  const legMat = mat(0x5a6168, 0.4, 0.6);
  const black = mat(0x15181c, 0.4, 0.3);
  const chairMat = mat(0x2f4a6a, 0.6);

  // ---- big curved wall display with live graphs (a canvas texture redrawn often)
  const gc = document.createElement("canvas");
  gc.width = 512;
  gc.height = 160;
  const gg = /** @type {CanvasRenderingContext2D} */ (gc.getContext("2d"));
  const graphTex = new T.CanvasTexture(gc);
  graphTex.colorSpace = T.SRGBColorSpace;
  const series = [[], [], []];
  const drawGraphs = t => {
    gg.fillStyle = "#06131c";
    gg.fillRect(0, 0, 512, 160);
    gg.strokeStyle = "rgba(120,200,255,0.15)";
    for (let x = 0; x < 512; x += 32) { gg.beginPath(); gg.moveTo(x, 0); gg.lineTo(x, 160); gg.stroke(); }
    for (let y = 0; y < 160; y += 32) { gg.beginPath(); gg.moveTo(0, y); gg.lineTo(512, y); gg.stroke(); }
    const colors = ["#5dff9a", "#7fd6ff", "#ffb020"];
    series.forEach((s, i) => {
      s.push(80 + 40 * Math.sin(t * (0.7 + i * 0.4) + i) + 20 * Math.sin(t * 3.1 + i * 2) + (rng() - 0.5) * 12);
      if (s.length > 64) s.shift();
      gg.strokeStyle = colors[i];
      gg.lineWidth = 2;
      gg.beginPath();
      s.forEach((v, k) => (k ? gg.lineTo(k * 8, v) : gg.moveTo(0, v)));
      gg.stroke();
    });
    gg.fillStyle = "#cfe8ff";
    gg.font = "bold 14px monospace";
    gg.fillText(`CORALHAVEN NET  load ${(55 + 30 * Math.sin(t * 0.5)).toFixed(0)}%  nodes 128/128`, 10, 18);
    graphTex.needsUpdate = true;
  };
  drawGraphs(0);
  const screen = new T.Mesh(
    new T.CylinderGeometry(3.0, 3.0, 1.2, 32, 1, true, Math.PI - 0.6, 1.2),
    new T.MeshBasicMaterial({ map: graphTex, side: T.DoubleSide })
  );
  screen.position.y = Y + 1.3;
  root.add(screen);
  // frame under the display
  B.add(black, box(3.4, 0.08, 0.2, 0, Y + 0.66, -2.9));
  let redraw = 0;
  anims.push((t, dt) => {
    redraw -= dt;
    if (redraw <= 0) {
      drawGraphs(t);
      redraw = 0.15;
    }
  });

  // ---- desks with two monitors each, keyboards and office chairs
  /** @type {T.Texture[]} */
  const screenTexs = [];
  const desks = [[-1.5, -0.9], [0, -0.9], [1.5, -0.9]];
  desks.forEach(([dx, dz], i) => {
    B.add(deskMat, box(1.2, 0.04, 0.55, dx, Y + 0.5, dz));
    for (const sx of [-0.55, 0.55]) B.add(legMat, box(0.04, 0.5, 0.5, dx + sx, Y, dz));
    B.add(black, box(0.4, 0.015, 0.12, dx, Y + 0.54, dz + 0.12)); // keyboard
    for (const mx of [-0.25, 0.25]) {
      B.add(black, box(0.42, 0.28, 0.03, dx + mx, Y + 0.62, dz - 0.18, mx * -0.6));
      B.add(black, cyl(0.02, 0.02, 0.08, dx + mx, Y + 0.54, dz - 0.18, 6));
      const tex = codeScreenTexture(i * 2 + (mx > 0 ? 1 : 0) + 1);
      screenTexs.push(tex);
      const s = new T.Mesh(new T.PlaneGeometry(0.38, 0.24), new T.MeshBasicMaterial({ map: tex }));
      s.position.set(dx + mx, Y + 0.76, dz - 0.163);
      s.rotation.y = mx * -0.6;
      root.add(s);
    }
    // office chair: seat, back, post, star base
    const cx = dx, cz = dz + 0.5;
    B.add(chairMat, box(0.34, 0.06, 0.34, cx, Y + 0.32, cz));
    B.add(chairMat, box(0.34, 0.36, 0.05, cx, Y + 0.38, cz + 0.17));
    B.add(legMat, cyl(0.025, 0.025, 0.3, cx, Y + 0.02, cz, 6));
    for (let k = 0; k < 5; k++) {
      const arm = new T.BoxGeometry(0.03, 0.02, 0.2);
      arm.translate(0, 0.02, 0.1);
      arm.rotateY((k / 5) * Math.PI * 2);
      arm.translate(cx, Y, cz);
      B.add(legMat, arm);
    }
    obstacles.push([dx, dz, 0.75]);
  });
  anims.push((t, dt) => screenTexs.forEach((tx, k) => (tx.offset.y += dt * (0.05 + k * 0.01))));

  // engineers at the desks, typing (little nods)
  const shirts = [0xe85d4a, 0xf2c14e, 0x6bc46b];
  const engineers = desks.map(([dx, dz], i) => {
    const p = makePerson(shirts[i]);
    p.position.set(dx, Y - 0.08, dz + 0.45);
    p.rotation.y = Math.PI;
    root.add(p);
    return p;
  });
  anims.push(t => engineers.forEach((p, i) => {
    const head = p.getObjectByName("head");
    if (head) head.position.y = 0.6 + 0.015 * Math.sin(t * 9 + i * 2);
  }));

  // ---- server racks along the back
  const rows = [serverRow(root, B, { Y, x0: -1.6, z: 1.75, n: 6, face: -1, rng })];
  for (let x = -1.6; x <= 1.2; x += 0.54) obstacles.push([x, 1.75, 0.48]);
  anims.push(blinker(rows, rng));
  B.flush(root);

  spots.push(new T.Vector3(-2.2, Y, 0.5), new T.Vector3(2.2, Y, 0.5), new T.Vector3(0, Y, 0.55), new T.Vector3(-2.6, Y, -1.8));
  return { anims, obstacles, spots };
}
