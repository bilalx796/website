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
import { glowMaterial } from "./materials.js";

const GAUGE = 0.55; // half the distance between rails
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

    // stations: platform on the inside, posts, a glowing canopy and a name sign
    const platMat = new T.MeshStandardMaterial({ color: 0xc9c3b4, roughness: 0.8 });
    const edgeMat = new T.MeshStandardMaterial({ color: 0xf2b630, roughness: 0.6 });
    const canopyMat = new T.MeshStandardMaterial({ color: 0x1f6f8b, roughness: 0.5 });
    const lightMat = glowMaterial(0xfff0c0, 0.3, 2.0);
    for (const st of stations) {
      const g = new T.Group();
      g.position.copy(st.trackPos);
      // local frame: +z along the track, +x toward the platform
      g.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(st.inward, up, st.inward.clone().cross(up)));
      const len = 5.2;
      const plat = new T.Mesh(new T.BoxGeometry(PLATFORM_HALF_WIDTH * 2, 0.25, len), platMat);
      plat.position.set(PLATFORM_OFFSET, PLATFORM_TOP - 0.125, 0);
      g.add(plat);
      const edge = new T.Mesh(new T.BoxGeometry(0.12, 0.26, len), edgeMat);
      edge.position.set(PLATFORM_OFFSET - PLATFORM_HALF_WIDTH + 0.06, PLATFORM_TOP - 0.12, 0);
      g.add(edge);
      const ground = floorHeight(st.center.x, st.center.z) - st.trackPos.y;
      for (const pz of [-2.1, 2.1]) {
        const leg = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, Math.max(0.2, -ground), 8), pylonMat);
        leg.position.set(PLATFORM_OFFSET, ground / 2, pz);
        g.add(leg);
        const post = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 2.1, 8), steel);
        post.position.set(PLATFORM_OFFSET + 0.75, 1.05, pz);
        g.add(post);
      }
      const canopy = new T.Mesh(new T.BoxGeometry(2.1, 0.12, len + 0.2), canopyMat);
      canopy.position.set(PLATFORM_OFFSET, 2.15, 0);
      canopy.rotation.z = 0.12;
      g.add(canopy);
      const lamp = new T.Mesh(new T.BoxGeometry(0.15, 0.08, len - 0.6), lightMat);
      lamp.position.set(PLATFORM_OFFSET, 2.05, 0);
      g.add(lamp);
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

    const paint = new T.MeshStandardMaterial({ color: 0xe8553f, metalness: 0.3, roughness: 0.45 });
    const cream = new T.MeshStandardMaterial({ color: 0xf3ecd8, roughness: 0.6 });
    const dark = new T.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.6, roughness: 0.4 });
    // see-through glowing windows, so the riders inside show
    const windows = glowMaterial(0xffe2a0, 0.25, 1.4);
    windows.transparent = true;
    windows.opacity = 0.35;
    windows.depthWrite = false;

    // floor + lower body (open on top), window band, rounded roof
    const floorPlate = new T.Mesh(new T.BoxGeometry(1.5, 0.08, 3.4), cream);
    floorPlate.position.y = 0.04;
    body.add(floorPlate);
    for (const s of [-1, 1]) {
      const side = new T.Mesh(new T.BoxGeometry(0.06, 0.6, 3.4), paint);
      side.position.set(s * 0.72, 0.3, 0);
      body.add(side);
    }
    for (const z of [-1.68, 1.68]) {
      const end = new T.Mesh(new T.BoxGeometry(1.5, 1.1, 0.06), paint);
      end.position.set(0, 0.55, z);
      body.add(end);
    }
    const band = new T.Mesh(new T.BoxGeometry(1.46, 0.5, 3.3), windows);
    band.position.y = 0.85;
    band.renderOrder = 7;
    body.add(band);
    // window pillars (merged into one mesh)
    const pillarGeos = [];
    for (let k = -3; k <= 3; k++) {
      for (const s of [-1, 1]) {
        const g = new T.BoxGeometry(0.04, 0.5, 0.08);
        g.translate(s * 0.74, 0.85, k * 0.48);
        pillarGeos.push(g);
      }
    }
    body.add(new T.Mesh(mergeGeometries(pillarGeos), cream));
    const roof = new T.Mesh(new T.CylinderGeometry(0.78, 0.78, 3.4, 20, 1, false, -Math.PI / 2, Math.PI), cream);
    roof.rotation.x = Math.PI / 2;
    roof.scale.set(1, 1, 0.35);
    roof.position.y = 1.1;
    body.add(roof);

    // sliding doors on both sides (in the middle of the car)
    /** @type {Array<{mesh: T.Mesh, dir: number}>} */
    const doors = [];
    for (const s of [-1, 1]) {
      for (const dz of [-1, 1]) {
        const door = new T.Mesh(new T.BoxGeometry(0.05, 0.95, 0.42), paint);
        door.position.set(s * 0.77, 0.62, dz * 0.21);
        body.add(door);
        doors.push({ mesh: door, dir: dz });
      }
    }
    // headlights
    const lampMat = glowMaterial(0xfff6d0, 0.6, 2.5);
    for (const z of [1.71, -1.71]) {
      const lamp = new T.Mesh(new T.CircleGeometry(0.12, 12), lampMat);
      lamp.position.set(0, 0.35, z);
      if (z < 0) lamp.rotation.y = Math.PI;
      body.add(lamp);
    }

    // two bogies, each with 4 wheels that spin
    /** @type {Array<T.Mesh>} */
    const wheels = [];
    for (const bz of [-1.1, 1.1]) {
      const bogie = new T.Mesh(new T.BoxGeometry(1.0, 0.16, 0.9), dark);
      bogie.position.set(0, -0.08, bz);
      body.add(bogie);
      for (const s of [-1, 1]) {
        for (const wz of [-0.3, 0.3]) {
          const wheel = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.08, 14), dark);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(s * GAUGE, -0.25, bz + wz);
          body.add(wheel);
          wheels.push(wheel);
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
