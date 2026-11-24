// @ts-check
/**
 * The Coralhaven tram: a little train that circles the domes and carries the
 * residents between them (see transit.js for the passengers).
 *
 * Track (Workbook 3 train track, in 3D):
 *  - the center line is our ClosedCardinalSpline, wrapped as a THREE.Curve
 *    (parameterized by arc length) so three can use it
 *  - two rails = SWEEPS: a square cross-section extruded along curves offset to
 *    the left and right of the center line (ExtrudeGeometry with extrudePath)
 *  - rail ties placed at equal ARC-LENGTH spacing and turned to the tangent,
 *    drawn as one InstancedMesh; support pylons down to the sea floor
 *  - four stations, each with its platform on the INSIDE of the loop, facing the
 *    dome it serves (a glass walkway connects them - see transit.js)
 *
 * Tram car: rides the spline with arc-length parameterization; state machine
 *    run -> brake into the next station -> stop (doors slide open, people get
 *    off and on) -> run ...
 * It waits at a station while passengers are still boarding (up to a limit).
 * The windows are see-through, so you can see the riders. Rideable.
 */

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GrObject } from "CS559-Framework/GrObject.js";
import { ClosedCardinalSpline } from "./util/curves.js";
import { floorHeight } from "./terrain.js";
import { glowMaterial, texturePack } from "./materials.js";

const GAUGE = 0.55; // half the distance between rails

/** strip a geometry down to position/normal/uv so different kinds can be merged */
function tidy(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const n of Object.keys(ng.attributes)) if (!["position", "normal", "uv"].includes(n)) ng.deleteAttribute(n);
  return ng;
}

/** @param {number} w @param {number} h @param {(g: CanvasRenderingContext2D) => void} draw */
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(/** @type {CanvasRenderingContext2D} */ (c.getContext("2d")));
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** the tram's side livery: red lower body, cream and gold stripes, lettering, car number */
function liveryTexture() {
  return canvasTex(1024, 176, g => {
    g.fillStyle = "#d94a36";
    g.fillRect(0, 0, 1024, 176);
    g.fillStyle = "#f3ecd8";
    g.fillRect(0, 18, 1024, 22);
    g.fillStyle = "#d9a520";
    g.fillRect(0, 44, 1024, 5);
    g.fillRect(0, 150, 1024, 4);
    g.fillStyle = "#f3ecd8";
    g.font = "bold 40px sans-serif";
    g.fillText("CORALHAVEN", 70, 108);
    g.font = "bold 22px sans-serif";
    g.fillText("RESEARCH TRANSIT", 72, 136);
    g.font = "bold 54px sans-serif";
    g.fillText("07", 860, 120);
    // door outline in the middle (where the real doors are)
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 3;
    g.strokeRect(1024 / 2 - 64, 4, 128, 172);
  });
}

/** amber dot-matrix destination sign */
function destinationTexture() {
  return canvasTex(256, 40, g => {
    g.fillStyle = "#1a0d00";
    g.fillRect(0, 0, 256, 40);
    g.fillStyle = "#ffb347";
    g.font = "bold 24px monospace";
    g.textAlign = "center";
    g.fillText("LOOP · ALL HUBS", 128, 28);
  });
}

/** tactile paving (raised dots) for the platform edge */
function tactileTexture() {
  const t = canvasTex(64, 64, g => {
    g.fillStyle = "#f2c230";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#c99a18";
    for (let y = 8; y < 64; y += 16) for (let x = 8; x < 64; x += 16) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  });
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(1, 20);
  return t;
}

/** station name sign: white on dark blue with a tram symbol */
function stationSignTexture(name) {
  return canvasTex(512, 102, g => {
    g.fillStyle = "#123a55";
    g.fillRect(0, 0, 512, 102);
    g.strokeStyle = "#f3ecd8";
    g.lineWidth = 4;
    g.strokeRect(4, 4, 504, 94);
    g.fillStyle = "#f2b630";
    g.beginPath();
    g.arc(56, 51, 32, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#123a55";
    g.font = "bold 40px sans-serif";
    g.textAlign = "center";
    g.fillText("T", 56, 65);
    g.fillStyle = "#ffffff";
    g.font = "bold 44px sans-serif";
    g.textAlign = "left";
    g.fillText(name, 104, 66);
  });
}

/** "next tram" departure display */
function nextTramTexture() {
  return canvasTex(256, 92, g => {
    g.fillStyle = "#04121c";
    g.fillRect(0, 0, 256, 92);
    g.fillStyle = "#7fe8ff";
    g.font = "bold 22px monospace";
    g.fillText("NEXT TRAM", 14, 32);
    g.fillStyle = "#ffd166";
    g.font = "bold 30px monospace";
    g.fillText("LOOP  2 min", 14, 72);
  });
}
export const PLATFORM_OFFSET = 1.75; // platform center, sideways from the track
export const PLATFORM_HALF_WIDTH = 0.9;
export const PLATFORM_TOP = 0.075; // platform top, above the rail line

/**
 * @typedef {Object} Station
 * @property {number} index
 * @property {number} dist - arc length along the track
 * @property {T.Vector3} trackPos - point on the track
 * @property {T.Vector3} along - unit tangent of the track (direction of travel)
 * @property {T.Vector3} inward - unit vector from the track to the platform (toward the town)
 * @property {T.Vector3} center - center of the platform's top surface
 */

/**
 * where the stations are (used by the track, the tram and the passengers)
 * @param {ClosedCardinalSpline} spline
 * @param {Array<number>} indices - control points with stations
 * @returns {Array<Station>}
 */
export function computeStations(spline, indices) {
  return indices.map((idx, i) => {
    const dist = spline.distanceAtParam(idx);
    const { pos, tan } = spline.atDistance(dist);
    const trackPos = new T.Vector3(...pos);
    const along = new T.Vector3(tan[0], 0, tan[2]).normalize();
    // sideways, horizontal; pick the side facing the town center
    const inward = new T.Vector3(-along.z, 0, along.x);
    if (inward.dot(trackPos.clone().setY(0).negate()) < 0) inward.negate();
    const center = trackPos.clone().addScaledVector(inward, PLATFORM_OFFSET);
    center.y = trackPos.y + PLATFORM_TOP;
    return { index: i, dist, trackPos, along, inward, center };
  });
}

/** a THREE.Curve that follows our spline (by arc length), offset sideways */
class OffsetSplineCurve extends T.Curve {
  /** @param {ClosedCardinalSpline} spline @param {number} side @param {number} dy */
  constructor(spline, side, dy) {
    super();
    this.spline = spline;
    this.side = side;
    this.dy = dy;
  }
  /** @param {number} t @param {T.Vector3} [target] */
  getPoint(t, target = new T.Vector3()) {
    const { pos, tan } = this.spline.atDistance(t * this.spline.length);
    const lx = -tan[2], lz = tan[0];
    const ll = Math.hypot(lx, lz) || 1;
    return target.set(pos[0] + (lx / ll) * this.side, pos[1] + this.dy, pos[2] + (lz / ll) * this.side);
  }
}

export class TramTrack extends GrObject {
  /**
   * @param {Array<[number, number, number]>} route
   * @param {Array<number>} stationIndices - control points with stations
   */
  constructor(route, stationIndices) {
    const spline = new ClosedCardinalSpline(route);
    const stations = computeStations(spline, stationIndices);
    const root = new T.Group();
    const steel = new T.MeshStandardMaterial({ color: 0x9aa6ad, metalness: 0.85, roughness: 0.3 });
    const tieMat = new T.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.9 });
    const pylonMat = new T.MeshStandardMaterial({ color: 0x6f7b82, metalness: 0.4, roughness: 0.6 });

    // rails: sweep a small square along each offset curve
    const railShape = new T.Shape();
    railShape.moveTo(-0.07, -0.07);
    railShape.lineTo(0.07, -0.07);
    railShape.lineTo(0.07, 0.07);
    railShape.lineTo(-0.07, 0.07);
    railShape.closePath();
    for (const side of [-GAUGE, GAUGE]) {
      const curve = new OffsetSplineCurve(spline, side, 0);
      const geom = new T.ExtrudeGeometry(railShape, { steps: 420, bevelEnabled: false, extrudePath: curve });
      root.add(new T.Mesh(geom, steel));
    }

    // ties: equal arc-length spacing, rotated to the tangent
    const spacing = 0.8;
    const nTies = Math.floor(spline.length / spacing);
    const ties = new T.InstancedMesh(new T.BoxGeometry(GAUGE * 2 + 0.5, 0.1, 0.28), tieMat, nTies);
    const m = new T.Matrix4();
    const q = new T.Quaternion();
    const up = new T.Vector3(0, 1, 0);
    for (let k = 0; k < nTies; k++) {
      const { pos, tan } = spline.atDistance(k * spacing);
      q.setFromAxisAngle(up, Math.atan2(tan[0], tan[2]));
      m.compose(new T.Vector3(pos[0], pos[1] - 0.12, pos[2]), q, new T.Vector3(1, 1, 1));
      ties.setMatrixAt(k, m);
    }
    root.add(ties);

    // pylons every few units, from the sea floor up to the ties
    const pylonSpacing = 4.8;
    const nPylons = Math.floor(spline.length / pylonSpacing);
    const pylons = new T.InstancedMesh(new T.CylinderGeometry(0.12, 0.18, 1, 8), pylonMat, nPylons);
    for (let k = 0; k < nPylons; k++) {
      const { pos } = spline.atDistance(k * pylonSpacing + 0.4);
      const ground = floorHeight(pos[0], pos[2]);
      const h = Math.max(0.2, pos[1] - 0.17 - ground);
      m.compose(new T.Vector3(pos[0], ground + h / 2, pos[2]), q.identity(), new T.Vector3(1, h, 1));
      pylons.setMatrixAt(k, m);
    }
    root.add(pylons);

    // stations: tiled platform with a tactile safety edge, a curved corrugated
    // canopy on steel columns, glass wind screens, benches, a name sign, a
    // "next tram" display, lamps and a bin. Furniture stays clear of the
    // middle of the platform, where the glass walkway from the dome arrives.
    const tiles = texturePack("Tiles107", 1.2, 3.2);
    const platTop = new T.MeshStandardMaterial({ map: tiles.map, normalMap: tiles.normalMap, color: 0xd8d4cc, roughness: 0.7 });
    const conc = texturePack("Concrete034", 3, 0.3);
    const platSide = new T.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, color: 0xb8b8b0, roughness: 0.9 });
    const tactile = new T.MeshStandardMaterial({ map: tactileTexture(), color: 0xf2c230, roughness: 0.6 });
    const corr = texturePack("CorrugatedSteel009", 3, 1);
    const roofMat = new T.MeshStandardMaterial({ map: corr.map, normalMap: corr.normalMap, color: 0x5d9db5, metalness: 0.55, roughness: 0.45, side: T.DoubleSide });
    const columnMat = new T.MeshStandardMaterial({ color: 0x2f3d47, metalness: 0.7, roughness: 0.35 });
    const screenGlass = new T.MeshStandardMaterial({ color: 0xcfefff, transparent: true, opacity: 0.25, metalness: 0.4, roughness: 0.05, depthWrite: false, side: T.DoubleSide });
    const wood = texturePack("Planks037A", 0.5, 1);
    const benchMat = new T.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, color: 0xc89060, roughness: 0.7 });
    const lightMat = glowMaterial(0xfff0c0, 0.3, 2.0);
    const screenMat = glowMaterial(0xffffff, 0.9, 1.6);
    screenMat.color.set(0xffffff);
    screenMat.map = screenMat.emissiveMap = nextTramTexture();
    const NAMES = ["Coral Square", "Kelp Point", "Vent Row", "Wreck Walk"];
    const len = 5.2;
    const PX = PLATFORM_OFFSET;
    for (const st of stations) {
      const g = new T.Group();
      g.position.copy(st.trackPos);
      // local frame: +z along the track, +x toward the platform
      g.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(st.inward, up, st.inward.clone().cross(up)));
      // platform slab: tiled top, concrete sides, yellow tactile strip at the edge
      const slab = new T.Mesh(new T.BoxGeometry(PLATFORM_HALF_WIDTH * 2, 0.25, len), [platSide, platSide, platTop, platSide, platSide, platSide]);
      slab.position.set(PX, PLATFORM_TOP - 0.125, 0);
      g.add(slab);
      const strip = new T.Mesh(new T.BoxGeometry(0.22, 0.012, len), tactile);
      strip.position.set(PX - PLATFORM_HALF_WIDTH + 0.13, PLATFORM_TOP + 0.006, 0);
      g.add(strip);
      const lip = new T.Mesh(new T.BoxGeometry(0.04, 0.26, len), columnMat);
      lip.position.set(PX - PLATFORM_HALF_WIDTH + 0.02, PLATFORM_TOP - 0.13, 0);
      g.add(lip);
      // legs down to the sand
      const ground = floorHeight(st.center.x, st.center.z) - st.trackPos.y;
      const steelGeos = [], columnGeos = [], glassGeos = [], benchGeos = [];
      for (const pz of [-2.1, 0, 2.1]) {
        const h = Math.max(0.2, -ground);
        columnGeos.push(new T.CylinderGeometry(0.11, 0.15, h, 10).translate(PX, ground / 2, pz));
      }
      // columns with curved brackets holding the canopy (at the back edge, clear of the walkway)
      const cx = PX + 0.72;
      for (const pz of [-2.2, 2.2]) {
        columnGeos.push(new T.CylinderGeometry(0.06, 0.075, 2.05, 12).translate(cx, PLATFORM_TOP + 1.02, pz));
        columnGeos.push(new T.CylinderGeometry(0.1, 0.1, 0.06, 12).translate(cx, PLATFORM_TOP + 0.03, pz)); // base plate
        const arm = new T.TorusGeometry(0.5, 0.03, 6, 12, Math.PI / 2);
        arm.rotateZ(Math.PI / 2);
        arm.translate(cx, PLATFORM_TOP + 1.55, pz);
        columnGeos.push(arm);
      }
      // curved corrugated roof: a shallow arc of a cylinder along the platform
      const roof = new T.CylinderGeometry(2.4, 2.4, len + 0.4, 24, 1, true, -0.48, 0.96);
      roof.rotateX(-Math.PI / 2); // axis along the track, the arc on top
      roof.translate(PX - 0.05, PLATFORM_TOP + 2.25 - 2.4, 0);
      g.add(new T.Mesh(roof, roofMat));
      // gutter + light strip under the roof
      columnGeos.push(new T.BoxGeometry(0.08, 0.08, len + 0.4).translate(PX + 1.1, PLATFORM_TOP + 1.98, 0));
      const lamp = new T.Mesh(new T.BoxGeometry(0.1, 0.05, len - 0.4), lightMat);
      lamp.position.set(PX, PLATFORM_TOP + 2.18, 0);
      g.add(lamp);
      // glass wind screens at both ends of the platform (framed)
      for (const sz of [-1, 1]) {
        const z = sz * (len / 2 - 0.08);
        glassGeos.push(new T.BoxGeometry(1.3, 1.4, 0.02).translate(PX + 0.15, PLATFORM_TOP + 0.85, z));
        steelGeos.push(new T.BoxGeometry(1.34, 0.05, 0.05).translate(PX + 0.15, PLATFORM_TOP + 1.56, z));
        steelGeos.push(new T.BoxGeometry(1.34, 0.05, 0.05).translate(PX + 0.15, PLATFORM_TOP + 0.15, z));
        for (const ex of [-0.65, 0.65]) steelGeos.push(new T.BoxGeometry(0.05, 1.45, 0.05).translate(PX + 0.15 + ex, PLATFORM_TOP + 0.85, z));
      }
      // benches toward the ends (wooden slats on steel legs)
      for (const bz of [-1.65, 1.65]) {
        for (let k = 0; k < 3; k++) benchGeos.push(new T.BoxGeometry(0.12, 0.03, 0.9).translate(PX + 0.45 + k * 0.13, PLATFORM_TOP + 0.4, bz));
        for (let k = 0; k < 2; k++) benchGeos.push(new T.BoxGeometry(0.03, 0.11, 0.9).translate(PX + 0.83, PLATFORM_TOP + 0.52 + k * 0.14, bz));
        for (const lz of [-0.38, 0.38]) {
          steelGeos.push(new T.BoxGeometry(0.4, 0.04, 0.04).translate(PX + 0.6, PLATFORM_TOP + 0.37, bz + lz));
          steelGeos.push(new T.BoxGeometry(0.04, 0.38, 0.04).translate(PX + 0.45, PLATFORM_TOP + 0.19, bz + lz));
          steelGeos.push(new T.BoxGeometry(0.04, 0.72, 0.04).translate(PX + 0.83, PLATFORM_TOP + 0.36, bz + lz));
        }
      }
      // litter bin
      steelGeos.push(new T.CylinderGeometry(0.13, 0.11, 0.42, 12).translate(PX + 0.65, PLATFORM_TOP + 0.21, -2.35 + 0.2));
      g.add(new T.Mesh(mergeGeometries(columnGeos.map(tidy)), columnMat));
      g.add(new T.Mesh(mergeGeometries(steelGeos.map(tidy)), steel));
      const glassMesh = new T.Mesh(mergeGeometries(glassGeos.map(tidy)), screenGlass);
      glassMesh.renderOrder = 6;
      g.add(glassMesh);
      g.add(new T.Mesh(mergeGeometries(benchGeos.map(tidy)), benchMat));
      // station name sign hanging under the canopy (both faces readable)
      const signTex = stationSignTexture(NAMES[st.index % NAMES.length]);
      for (const face of [-1, 1]) {
        const sign = new T.Mesh(new T.PlaneGeometry(1.5, 0.3), new T.MeshStandardMaterial({ map: signTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.35 }));
        sign.position.set(PX - 0.1 + face * 0.012, PLATFORM_TOP + 1.78, 1.45);
        sign.rotation.y = face * Math.PI / 2;
        g.add(sign);
      }
      // "next tram" display on a post
      const disp = new T.Mesh(new T.PlaneGeometry(0.55, 0.2), screenMat);
      disp.position.set(PX - 0.1, PLATFORM_TOP + 1.78, -1.45);
      disp.rotation.y = -Math.PI / 2;
      g.add(disp);
      const dispBack = new T.Mesh(new T.BoxGeometry(0.04, 0.24, 0.6), columnMat);
      dispBack.position.set(PX - 0.08, PLATFORM_TOP + 1.78, -1.45);
      g.add(dispBack);
      root.add(g);
    }

    super("Tram Track & Stations", root);
    this.spline = spline;
    this.stations = stations;
    this.stationDist = stations.map(s => s.dist);
  }

  lookFromLookAt() {
    return [0, 22, 32, 0, 0, 2];
  }
}

export class TramCar extends GrObject {
  /** @param {TramTrack} track */
  constructor(track) {
    const root = new T.Group();
    const body = new T.Group();
    body.position.y = 0.42; // sits on the rails
    root.add(body);

    const plates = texturePack("MetalPlates004", 2, 1);
    const paint = new T.MeshStandardMaterial({ color: 0xd94a36, metalness: 0.35, roughness: 0.38, normalMap: plates.normalMap, normalScale: new T.Vector2(0.25, 0.25) });
    const livery = new T.MeshStandardMaterial({ map: liveryTexture(), metalness: 0.3, roughness: 0.4 });
    const cream = new T.MeshStandardMaterial({ color: 0xf3ecd8, roughness: 0.55 });
    const corr = texturePack("CorrugatedSteel009", 1, 4);
    const roofMat = new T.MeshStandardMaterial({ map: corr.map, normalMap: corr.normalMap, color: 0xe8e4da, metalness: 0.5, roughness: 0.45 });
    const dark = new T.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.6, roughness: 0.4 });
    const chrome = new T.MeshStandardMaterial({ color: 0xdfe6ea, metalness: 1, roughness: 0.15 });
    const rub = texturePack("Rubber004", 1, 2);
    const floorMat = new T.MeshStandardMaterial({ map: rub.map, normalMap: rub.normalMap, color: 0x6a7078, roughness: 0.9 });
    const seatMat = new T.MeshStandardMaterial({ color: 0x2c5d8a, roughness: 0.7 });
    // see-through glowing windows, so the riders inside show
    const windows = glowMaterial(0xffe2a0, 0.25, 1.4);
    windows.transparent = true;
    windows.opacity = 0.32;
    windows.depthWrite = false;
    const windshield = new T.MeshStandardMaterial({ color: 0x9fd6ee, transparent: true, opacity: 0.35, metalness: 0.7, roughness: 0.05, depthWrite: false });

    const L = 3.4; // body length
    // floor (rubber), lower body sides with the livery painted on
    const floorPlate = new T.Mesh(new T.BoxGeometry(1.5, 0.08, L), floorMat);
    floorPlate.position.y = 0.04;
    body.add(floorPlate);
    for (const s of [-1, 1]) {
      const side = new T.Mesh(new T.BoxGeometry(0.06, 0.6, L), paint);
      side.position.set(s * 0.72, 0.3, 0);
      body.add(side);
      // livery panel on the outside, facing out (so the lettering reads on both sides)
      const panel = new T.Mesh(new T.PlaneGeometry(L - 0.02, 0.58), livery);
      panel.position.set(s * 0.755, 0.3, 0);
      panel.rotation.y = s * Math.PI / 2;
      body.add(panel);
    }
    // rounded cab ends: a tapered nose with a sloped windshield, headlights and a destination sign
    const noseGeos = [], trimGeos = [];
    const destTex = destinationTexture();
    for (const dir of [-1, 1]) {
      const z = dir * L / 2;
      const nose = new T.CylinderGeometry(0.75, 0.75, 1.1, 20, 1, false, -Math.PI / 2, Math.PI);
      nose.scale(1, 1, 0.28);
      nose.translate(0, 0.55, 0);
      if (dir < 0) nose.rotateY(Math.PI);
      nose.translate(0, 0, z);
      noseGeos.push(nose);
      // bumper
      trimGeos.push(new T.BoxGeometry(1.3, 0.1, 0.12).translate(0, 0.08, z + dir * 0.2));
      const ws = new T.Mesh(new T.PlaneGeometry(1.1, 0.45), windshield);
      ws.position.set(0, 0.86, z + dir * 0.2);
      ws.rotation.set(dir * -0.25, dir < 0 ? Math.PI : 0, 0);
      ws.renderOrder = 7;
      body.add(ws);
      const signMat = glowMaterial(0xffffff, 0.9, 1.2);
      signMat.color.set(0xffffff);
      signMat.map = signMat.emissiveMap = destTex;
      const sign = new T.Mesh(new T.PlaneGeometry(0.8, 0.13), signMat);
      sign.position.set(0, 1.15, z + dir * 0.135);
      if (dir < 0) sign.rotation.y = Math.PI;
      body.add(sign);
    }
    body.add(new T.Mesh(mergeGeometries(noseGeos.map(tidy)), paint));
    // window band, pillars, roof (corrugated) with roof equipment
    const band = new T.Mesh(new T.BoxGeometry(1.46, 0.5, L - 0.1), windows);
    band.position.y = 0.85;
    band.renderOrder = 7;
    body.add(band);
    const pillarGeos = [];
    for (let k = -3; k <= 3; k++) {
      for (const s of [-1, 1]) pillarGeos.push(new T.BoxGeometry(0.04, 0.5, 0.08).translate(s * 0.74, 0.85, k * 0.48));
    }
    // window sill and rain gutter lines
    for (const s of [-1, 1]) {
      pillarGeos.push(new T.BoxGeometry(0.05, 0.04, L).translate(s * 0.745, 0.6, 0));
      pillarGeos.push(new T.BoxGeometry(0.05, 0.04, L).translate(s * 0.745, 1.1, 0));
    }
    body.add(new T.Mesh(mergeGeometries(pillarGeos.map(tidy)), cream));
    const roof = new T.Mesh(new T.CylinderGeometry(0.78, 0.78, L, 20, 1, false, -Math.PI / 2, Math.PI), roofMat);
    roof.rotation.x = Math.PI / 2;
    roof.scale.set(1, 1, 0.35);
    roof.position.y = 1.1;
    body.add(roof);
    // roof pod (pumps / batteries), a pantograph frame and roof-edge lights
    trimGeos.push(new T.BoxGeometry(0.8, 0.14, 1.3).translate(0, 1.36, -0.6));
    trimGeos.push(new T.CylinderGeometry(0.05, 0.05, 1.3, 8).rotateX(Math.PI / 2).translate(0.3, 1.45, -0.6));
    trimGeos.push(new T.CylinderGeometry(0.05, 0.05, 1.3, 8).rotateX(Math.PI / 2).translate(-0.3, 1.45, -0.6));
    trimGeos.push(new T.BoxGeometry(0.04, 0.4, 0.04).rotateX(0.6).translate(0, 1.5, 0.75));
    trimGeos.push(new T.BoxGeometry(0.04, 0.4, 0.04).rotateX(-0.6).translate(0, 1.5, 1.15));
    trimGeos.push(new T.BoxGeometry(0.7, 0.03, 0.06).translate(0, 1.66, 0.95));
    // skirts hiding the bogies a little
    for (const s of [-1, 1]) trimGeos.push(new T.BoxGeometry(0.04, 0.14, L - 1.0).translate(s * 0.7, -0.05, 0));
    body.add(new T.Mesh(mergeGeometries(trimGeos.map(tidy)), dark));

    // interior: bench seats along both sides at the ends, grab poles
    const seatGeos = [], poleGeos = [];
    for (const s of [-1, 1]) {
      for (const sz of [-1, 1]) {
        seatGeos.push(new T.BoxGeometry(0.34, 0.08, 0.9).translate(s * 0.5, 0.36, sz * 1.15));
        seatGeos.push(new T.BoxGeometry(0.06, 0.36, 0.9).translate(s * 0.68, 0.56, sz * 1.15));
      }
    }
    for (const pz of [-0.55, 0.55]) poleGeos.push(new T.CylinderGeometry(0.02, 0.02, 1.15, 8).translate(0, 0.62, pz));
    for (const s of [-1, 1]) poleGeos.push(new T.CylinderGeometry(0.015, 0.015, L - 0.4, 6).rotateX(Math.PI / 2).translate(s * 0.35, 1.12, 0));
    body.add(new T.Mesh(mergeGeometries(seatGeos.map(tidy)), seatMat));
    body.add(new T.Mesh(mergeGeometries(poleGeos.map(tidy)), chrome));

    // sliding doors on both sides (in the middle of the car), with windows
    /** @type {Array<{mesh: T.Mesh, dir: number}>} */
    const doors = [];
    for (const s of [-1, 1]) {
      for (const dz of [-1, 1]) {
        const door = new T.Mesh(new T.BoxGeometry(0.05, 0.95, 0.42), paint);
        door.position.set(s * 0.77, 0.62, dz * 0.21);
        const win = new T.Mesh(new T.BoxGeometry(0.06, 0.4, 0.3), windows);
        win.position.y = 0.18;
        door.add(win);
        body.add(door);
        doors.push({ mesh: door, dir: dz });
      }
    }
    // headlights (and red tail lights next to them)
    const lampMat = glowMaterial(0xfff6d0, 0.6, 2.5);
    const tailMat = glowMaterial(0xff3020, 0.6, 1.5);
    for (const z of [L / 2 + 0.2, -L / 2 - 0.2]) {
      for (const lx of [-0.45, 0.45]) {
        const lamp = new T.Mesh(new T.CircleGeometry(0.08, 12), lampMat);
        lamp.position.set(lx, 0.32, z + Math.sign(z) * 0.005);
        if (z < 0) lamp.rotation.y = Math.PI;
        body.add(lamp);
        const tail = new T.Mesh(new T.CircleGeometry(0.04, 8), tailMat);
        tail.position.set(lx * 1.25, 0.32, z + Math.sign(z) * -0.04);
        if (z < 0) tail.rotation.y = Math.PI;
        body.add(tail);
      }
    }

    // two bogies: frame, springs, and 4 flanged wheels that spin
    /** @type {Array<T.Mesh>} */
    const wheels = [];
    const wheelGeo = mergeGeometries([
      tidy(new T.CylinderGeometry(0.17, 0.17, 0.07, 16)),
      tidy(new T.CylinderGeometry(0.2, 0.2, 0.02, 16).translate(0, 0.04, 0)), // flange (inside)
      tidy(new T.CylinderGeometry(0.05, 0.05, 0.1, 8)), // hub
    ]);
    for (const bz of [-1.1, 1.1]) {
      const bg = [];
      bg.push(new T.BoxGeometry(1.0, 0.1, 0.9).translate(0, -0.1, bz));
      for (const s of [-1, 1]) {
        bg.push(new T.BoxGeometry(0.08, 0.14, 0.95).translate(s * (GAUGE + 0.1), -0.22, bz));
        for (const wz of [-0.18, 0.18]) bg.push(new T.CylinderGeometry(0.04, 0.04, 0.1, 8).translate(s * 0.4, -0.02, bz + wz)); // springs
      }
      body.add(new T.Mesh(mergeGeometries(bg.map(tidy)), dark));
      for (const s of [-1, 1]) {
        for (const wz of [-0.3, 0.3]) {
          const wheel = new T.Mesh(wheelGeo, chrome);
          wheel.rotation.z = s * Math.PI / 2;
          wheel.position.set(s * GAUGE, -0.25, bz + wz);
          // spin around the axle: wrap in a holder so rotation.x is the axle spin
          const holder = new T.Group();
          holder.position.copy(wheel.position);
          wheel.position.set(0, 0, 0);
          holder.add(wheel);
          body.add(holder);
          wheels.push(/** @type {any} */ (holder));
        }
      }
    }

    // driver's seat
    const seat = new T.Object3D();
    seat.position.set(0, 1.0, 1.4);
    body.add(seat);

    super("Tram Car", root);
    this.track = track;
    this.root = root;
    this.wheels = wheels;
    this.doors = doors;
    this.rideable = seat;
    this.dist = 3;
    this.speed = 0;
    this.maxSpeed = 3.6;
    /** @type {"run"|"brake"|"stopped"} */
    this.state = "run";
    this.timer = 0;
    this.doorOpen = 0;
    /** index of the station we're stopped at (-1 when moving) */
    this.stoppedAt = -1;
    /** passengers can ask the tram to wait (they set this while boarding) */
    this.holdDoors = 0;
    /** standing spots inside the car (local to root), for passengers */
    this.spots = [];
    for (const x of [-0.32, 0.32]) for (const z of [-1.25, -0.75, 0.75, 1.25]) this.spots.push(new T.Vector3(x, 0.5, z));
    this.place();
  }

  /** index of the next station ahead and the distance to it */
  nextStation() {
    const L = this.track.spline.length;
    let best = Infinity;
    let idx = -1;
    this.track.stationDist.forEach((d, i) => {
      const ahead = (((d - this.dist) % L) + L) % L;
      if (ahead > 0.05 && ahead < best) {
        best = ahead;
        idx = i;
      }
    });
    return { dist: best, index: idx };
  }

  /** world position of a point given in the car's own coordinates */
  toWorld(local) {
    return this.root.localToWorld(local.clone());
  }

  /** which side (+1 / -1 local x) the platform is on at a station */
  platformSide(stationIndex) {
    const st = this.track.stations[stationIndex];
    const localX = new T.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    return localX.dot(st.inward) > 0 ? 1 : -1;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    const brakeDist = 6;
    // passengers set holdDoors while they are still getting on or off
    const hold = this.holdDoors;
    this.holdDoors = 0;
    if (this.state === "run") {
      this.speed = Math.min(this.maxSpeed, this.speed + 1.2 * dt);
      if (this.nextStation().dist < brakeDist) this.state = "brake";
    } else if (this.state === "brake") {
      const { dist: rem, index } = this.nextStation();
      this.speed = Math.max(0.15, Math.min(this.speed, this.maxSpeed * Math.sqrt(rem / brakeDist)));
      if (rem < this.speed * dt + 0.06 || rem > brakeDist * 2) {
        this.dist += rem;
        this.speed = 0;
        this.state = "stopped";
        this.stoppedAt = index;
        this.timer = 0;
      }
    } else {
      this.timer += dt;
      // wait at least 5 s; longer (up to 12 s) while passengers are still getting on/off
      if (this.timer > 5 && (hold <= 0 || this.timer > 12)) {
        this.state = "run";
        this.stoppedAt = -1;
      }
    }
    this.dist = (this.dist + this.speed * dt) % this.track.spline.length;

    // doors: open while stopped (after a moment), closed again before leaving
    const closing = this.state === "stopped" && this.timer > 4.4 && (hold <= 0 || this.timer > 11.5);
    const wantOpen = this.state === "stopped" && this.timer > 0.4 && !closing ? 1 : 0;
    this.doorOpen += (wantOpen - this.doorOpen) * Math.min(1, dt * 5);
    for (const d of this.doors) d.mesh.position.z = d.dir * (0.21 + 0.38 * this.doorOpen);

    // wheels turn by distance / radius
    for (const w of this.wheels) w.rotation.x += (this.speed * dt) / 0.17;
    this.place();
  }

  place() {
    const { pos, tan } = this.track.spline.atDistance(this.dist);
    this.root.position.set(pos[0], pos[1], pos[2]);
    this.root.lookAt(pos[0] + tan[0], pos[1] + tan[1], pos[2] + tan[2]);
  }

  lookFromLookAt() {
    const p = this.root.position;
    return [p.x + 5, p.y + 3.5, p.z + 5, p.x, p.y + 0.8, p.z];
  }
}
