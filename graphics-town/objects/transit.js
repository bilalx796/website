// @ts-check
/**
 * Getting around Coralhaven: glass walkways from each dome to its tram station,
 * and the COMMUTERS who use them.
 *
 * StationWalkways: a glass tube (TubeGeometry along a curve) from each dome's
 * airlock to the inner edge of its station platform, with a floor strip inside.
 *
 * Commuters: each person runs a state machine -
 *    home      - hangs around inside a dome for a while
 *    toStation - walks to the airlock (the doors slide open), through the glass
 *                walkway, onto the platform, to a free waiting spot
 *    waiting   - waits on the platform until the tram stops at THIS station and
 *                its doors are open, and there is room inside
 *    boarding  - walks to the tram door and in to a standing spot (the tram
 *                holds its doors while people are still getting on)
 *    riding    - rides along (you can see them through the windows), until the
 *                tram stops at their DESTINATION station
 *    alighting - gets off, walks across the platform, through the walkway and
 *                the airlock into the destination dome, and becomes "home" there
 * This is the "train stops at a station and people get on and off" behavior.
 */

import * as T from "three";
import { GrObject } from "CS559-Framework/GrObject.js";
import { makePerson, corridorMaterials } from "./habitats.js";
import { walkPose } from "./people.js";
import { buildCorridor } from "./corridor.js";
import { PLATFORM_HALF_WIDTH } from "./tram.js";
import { makeRng } from "./util/noise.js";

/**
 * @typedef {Object} Link
 * @property {import("./tram.js").Station} station
 * @property {import("./habitats.js").HabitatDome} dome
 * @property {Array<T.Vector3>} walk - floor-level points from the dome's airlock to the platform edge
 */

/**
 * pair each station with its nearest dome and build the walking path between them
 * @param {Array<import("./tram.js").Station>} stations
 * @param {Array<import("./habitats.js").HabitatDome>} domes
 * @returns {Array<Link>}
 */
export function linkStations(stations, domes) {
  return stations.map(station => {
    let dome = domes[0];
    for (const d of domes) {
      if (d.root.position.distanceTo(station.center) < dome.root.position.distanceTo(station.center)) dome = d;
    }
    // from the airlock's outer door, ramping up onto the platform
    const a = dome.doorOutside().addScaledVector(dome.doorDir, -0.2);
    const b = station.center.clone().addScaledVector(station.inward, PLATFORM_HALF_WIDTH - 0.35);
    const walk = [a, a.clone().lerp(b, 0.5), b];
    return { station, dome, walk };
  });
}

export class StationWalkways extends GrObject {
  /** @param {Array<Link>} links */
  constructor(links) {
    const root = new T.Group();
    const mats = corridorMaterials();
    for (const l of links) {
      const c = buildCorridor(l.walk, mats, { width: 1.5, height: 1.3 });
      c.meshes.forEach(m => root.add(m));
      l.walk = c.walk; // walk along the corridor's own (smooth) path
    }
    super("Station Walkways", root);
    this.links = links;
  }

  lookFromLookAt() {
    const l = this.links[1];
    const p = l.walk[Math.floor(l.walk.length / 2)];
    return [p.x + 5, p.y + 4, p.z + 5, p.x, p.y, p.z];
  }
}

const SHIRTS = [0xe85d4a, 0x4a8be8, 0xf2c14e, 0x6bc46b, 0xb06ad8, 0xf28c4e, 0x47c6c6, 0xff8fb1];

export class Commuters extends GrObject {
  /**
   * @param {Array<Link>} links
   * @param {import("./tram.js").TramCar} tram
   * @param {number} [count=14]
   */
  constructor(links, tram, count = 14) {
    const root = new T.Group();
    const rng = makeRng(31415);
    /** @type {Array<any>} */
    const people = [];
    for (let k = 0; k < count; k++) {
      const mesh = makePerson(SHIRTS[k % SHIRTS.length]);
      root.add(mesh);
      const home = k % links.length;
      people.push({
        mesh,
        state: "home",
        link: home, // where they are (station / dome index)
        dest: -1,
        timer: 1 + rng() * 10, // staggered start
        path: /** @type {T.Vector3[]} */ ([]),
        spot: -1, // standing spot in the tram
        wait: new T.Vector3(),
        bob: rng() * 6,
      });
      mesh.position.copy(links[home].dome.randomInside());
    }
    super("Commuters", root);
    this.links = links;
    this.tram = tram;
    this.people = people;
    this.rng = rng;
    this.speed = 1.3;
    /** @type {Array<any>} which person stands in each tram spot */
    this.spotTaken = tram.spots.map(() => null);
  }

  /** a free waiting spot on a station's platform */
  waitSpot(li) {
    const st = this.links[li].station;
    return st.center.clone()
      .addScaledVector(st.along, (this.rng() - 0.5) * 3.6)
      .addScaledVector(st.inward, 0.05 + this.rng() * 0.45);
  }

  /** point on the platform edge, next to the tram's door */
  doorOnPlatform(li) {
    const side = this.tram.platformSide(li);
    const p = this.tram.toWorld(new T.Vector3(side * 1.05, 0, 0));
    p.y = this.links[li].station.center.y;
    return p;
  }

  /** a point just inside the tram's door */
  doorInTram(li) {
    const side = this.tram.platformSide(li);
    return this.tram.toWorld(new T.Vector3(side * 0.35, 0.5, 0));
  }

  /**
   * walk along a person's path; returns true when the path is finished
   * @param {any} p @param {number} dt
   */
  walk(p, dt) {
    let step = this.speed * dt;
    const pos = p.mesh.position;
    while (p.path.length && step > 0) {
      const target = p.path[0];
      const d = pos.distanceTo(target);
      if (d <= step) {
        pos.copy(target);
        p.path.shift();
        step -= d;
      } else {
        const dir = target.clone().sub(pos).divideScalar(d);
        pos.addScaledVector(dir, step);
        if (Math.abs(dir.x) + Math.abs(dir.z) > 0.1) p.mesh.rotation.y = Math.atan2(dir.x, dir.z);
        step = 0;
      }
    }
    // bob up and down a little while walking
    p.bob += dt * 9;
    walkPose(p.mesh, p.bob, p.path.length ? 1 : 0);
    // open the airlock when passing it
    const dome = this.links[p.link].dome;
    if (pos.distanceTo(dome.doorOutside()) < 1.6 || pos.distanceTo(dome.doorInside()) < 1.2) dome.doorRequest = 0.6;
    return p.path.length === 0;
  }

  /**
   * @param {number} delta
   * @param {number} timeOfDay
   */
  stepWorld(delta, timeOfDay) {
    const dt = Math.min(delta, 100) / 1000;
    const tram = this.tram;
    const doorsOpen = tram.state === "stopped" && tram.doorOpen > 0.6;

    for (const p of this.people) {
      const link = this.links[p.link];
      switch (p.state) {
        case "home":
          p.timer -= dt;
          if (p.timer <= 0) {
            // head out to the station
            p.wait = this.waitSpot(p.link);
            p.path = [link.dome.doorInside(), link.dome.doorOutside(), ...link.walk, p.wait];
            p.state = "toStation";
          } else if (p.path.length || this.rng() < dt * 0.3) {
            // wander around inside the dome
            if (!p.path.length) p.path = [link.dome.randomInside()];
            this.walk(p, dt * 0.6);
          }
          break;
        case "toStation":
          if (this.walk(p, dt)) p.state = "waiting";
          break;
        case "waiting": {
          // face the track
          p.mesh.rotation.y = Math.atan2(-link.station.inward.x, -link.station.inward.z);
          const free = this.spotTaken.indexOf(null);
          if (doorsOpen && tram.stoppedAt === p.link && free >= 0) {
            this.spotTaken[free] = p;
            p.spot = free;
            p.path = [this.doorOnPlatform(p.link), this.doorInTram(p.link), tram.toWorld(tram.spots[free])];
            p.state = "boarding";
            // pick somewhere else to go
            p.dest = (p.link + 1 + Math.floor(this.rng() * (this.links.length - 1))) % this.links.length;
          }
          break;
        }
        case "boarding":
          tram.holdDoors = 1;
          if (this.walk(p, dt * 1.3)) p.state = "riding";
          break;
        case "riding":
          // stand in our spot, moving with the tram
          p.mesh.position.copy(tram.toWorld(tram.spots[p.spot]));
          p.mesh.rotation.y = tram.root.rotation.y;
          {
            const q = new T.Quaternion();
            tram.root.getWorldQuaternion(q);
            p.mesh.quaternion.copy(q);
          }
          if (doorsOpen && tram.stoppedAt === p.dest) {
            this.spotTaken[p.spot] = null;
            p.spot = -1;
            p.link = p.dest;
            const l2 = this.links[p.link];
            const wait = this.waitSpot(p.link);
            p.path = [
              this.doorInTram(p.link), this.doorOnPlatform(p.link), wait,
              ...l2.walk.slice().reverse(), l2.dome.doorOutside(), l2.dome.doorInside(), l2.dome.randomInside(),
            ];
            p.mesh.quaternion.identity();
            p.state = "alighting";
          }
          break;
        case "alighting":
          // hold the tram until we're out of the door
          if (p.path.length > p.path.length - 0 && p.mesh.position.distanceTo(tram.root.position) < 2.2) tram.holdDoors = 1;
          if (this.walk(p, dt * 1.2)) {
            p.state = "home";
            p.timer = 5 + this.rng() * 12;
          }
          break;
      }
    }
  }

  lookFromLookAt() {
    const p = this.tram.root.position;
    return [p.x + 6, p.y + 4, p.z + 6, p.x, p.y + 1, p.z];
  }
}
