// @ts-check

/**
 * Graphics Town - Coralhaven, a sunken reef town.
 *
 * This is the main file: it creates the world, puts the town's objects into it,
 * marks the interesting ones as highlighted, builds the UI, and starts things.
 *
 * The objects themselves are defined in the files in ./objects/.
 * See PLAN.md for the overall design and NOTES.md for documentation notes.
 */

import * as T from "three";
import { GrWorld } from "CS559-Framework/GrWorld.js";
import { WorldUI } from "CS559-Framework/WorldUI.js";

import {
    WATER_COLOR, SUB_ROUTE, SUB_DOCK_INDEX, DOMES, TRAM_ROUTE, WRECK, BEACON, VENTS,
    MINING_RIG, SPOIL_HEAP, CRAB_FLATS, EEL_DEN, TURTLE_ROUTE, MANTA_ROUTE, SHARK_ROUTE,
} from "./objects/layout.js";
import { makeJellies } from "./objects/jellyfish.js";
import { SeaTurtle } from "./objects/turtle.js";
import { MantaRay } from "./objects/manta.js";
import { Shark } from "./objects/shark.js";
import { Crab } from "./objects/crabs.js";
import { MorayEel } from "./objects/eel.js";
import { MiningRig } from "./objects/miningRig.js";
import { HydrothermalVents, Bubbles, MarineSnow, Anemones } from "./objects/effects.js";
import { reef } from "./objects/reefState.js";
import { ReefEnvironment } from "./objects/environment.js";
import { SeaFloor } from "./objects/seafloor.js";
import { Submarine } from "./objects/submarine.js";
import { DockingStation } from "./objects/dock.js";
import { FishSchool, LeadFish } from "./objects/fishSchool.js";
import { HabitatDome, DomeTubes } from "./objects/habitats.js";
import { TramTrack, TramCar } from "./objects/tram.js";
import { Shipwreck } from "./objects/wreck.js";
import { BeaconTower } from "./objects/beacon.js";
import { CoralGardens } from "./objects/coral.js";
import { KelpForest } from "./objects/kelp.js";
import { Rocks } from "./objects/rocks.js";
import { makeReefUI } from "./objects/reefUI.js";
import { FreeCamera, relabelCameraMenu } from "./objects/freeCamera.js";

const div = document.getElementById("div1");
if (div) {
    // make the world - no default ground plane or lights: the reef makes its own
    const world = await GrWorld.new({
        where: div,
        width: 960,
        height: 600,
        groundplane: false,
        lights: [],
        background: WATER_COLOR,
        lookfrom: new T.Vector3(4, 24, 50),
        lookat: new T.Vector3(0, 4, 0),
        far: 500,
    });

    // the environment must be added first: it steps first and sets the shared
    // reef state (time, daylight) that the other objects read
    const environment = new ReefEnvironment(world);
    world.add(environment);

    // ---- the land(scape)
    const floor = new SeaFloor();
    world.add(floor);
    world.add(new Rocks());
    const coral = new CoralGardens();
    world.add(coral);
    const kelp = new KelpForest();
    world.add(kelp);

    // ---- buildings
    const domeInfo = [
        { type: "hall", name: "Town Hall Dome" },
        { type: "homes", name: "Residential Dome" },
        { type: "lab", name: "Research Lab Dome" },
        { type: "garden", name: "Garden Dome" },
    ];
    const domes = DOMES.map(([x, z, r], i) =>
        new HabitatDome({ x, z, r, type: /** @type {any} */ (domeInfo[i].type), name: domeInfo[i].name })
    );
    domes.forEach(d => world.add(d));
    world.add(new DomeTubes(DOMES, [[0, 1], [0, 2], [0, 3], [1, 3]]));
    const wreck = new Shipwreck(WRECK[0], WRECK[1], WRECK[2]);
    world.add(wreck);

    // ---- vehicles
    const sub = new Submarine({ route: SUB_ROUTE, dockIndex: SUB_DOCK_INDEX });
    world.add(sub);
    reef.objects.sub = sub;
    const dock = new DockingStation({ sub });
    world.add(dock);
    const beacon = new BeaconTower(BEACON[0], BEACON[1], sub);
    world.add(beacon);
    const track = new TramTrack(TRAM_ROUTE, [0, 2, 4, 6]);
    world.add(track);
    const tram = new TramCar(track);
    world.add(tram);

    const rig = new MiningRig(MINING_RIG[0], MINING_RIG[1], /** @type {[number, number]} */ (SPOIL_HEAP));
    world.add(rig);

    // ---- creatures
    const school = new FishSchool();
    world.add(school);
    const leadFish = new LeadFish(school);
    world.add(leadFish);
    reef.objects.school = school;
    const shark = new Shark({ route: SHARK_ROUTE });
    world.add(shark);
    reef.objects.shark = shark;
    const turtle = new SeaTurtle({ route: TURTLE_ROUTE, name: "Sea Turtle Shelly" });
    world.add(turtle);
    const manta = new MantaRay({ route: MANTA_ROUTE, name: "Manta Ray Marina" });
    world.add(manta);
    const jellies = [
        ...makeJellies(5, -10, 14, -24, 12, 1),
        ...makeJellies(4, 16, 15, -10, 10, 2),
        ...makeJellies(3, -28, 12, -14, 8, 3),
    ];
    jellies.forEach(j => world.add(j));
    const crabs = [0, 1, 2, 3, 4].map(k => {
        const a = (k / 5) * Math.PI * 2;
        return new Crab(CRAB_FLATS[0] + Math.cos(a) * 4, CRAB_FLATS[1] + Math.sin(a) * 4, k + 1, `Crab ${["Pinchy", "Sandy", "Clawdia", "Scuttle", "Rocco"][k]}`);
    });
    crabs.forEach(c => world.add(c));
    const eel = new MorayEel(EEL_DEN[0], EEL_DEN[1], Math.atan2(-EEL_DEN[0], -EEL_DEN[1]));
    world.add(eel);
    world.add(new Anemones());

    // ---- effects
    const vents = new HydrothermalVents(/** @type {Array<[number, number]>} */ (VENTS));
    world.add(vents);
    const wreckLeak = new T.Vector3(WRECK[0] + 1, 3, WRECK[1]);
    const domeTops = domes.map(d => {
        const p = d.root.position;
        return new T.Vector3(p.x, p.y + d.r + 0.9, p.z);
    });
    const propPos = new T.Vector3();
    world.add(new Bubbles({
        emitters: [
            ...vents.mouths.map(m => ({ pos: () => m, rate: 9, spread: 0.4 })),
            { pos: () => wreckLeak, rate: 1.2, spread: 2 },
            ...domeTops.map(t => ({ pos: () => t, rate: 0.6, spread: 0.2 })),
            {
                // the submarine's propeller wash, only while moving
                pos: () => (sub.speed > 0.5 ? sub.prop.getWorldPosition(propPos) : null),
                rate: 10,
                spread: 0.5,
            },
        ],
    }));
    world.add(new MarineSnow(world));

    // highlighted objects (described in the documentation)
    for (const ob of [school, leadFish, sub, dock, tram, domes[0], wreck, beacon, coral, kelp,
        shark, turtle, manta, jellies[0], crabs[0], eel, rig, vents]) {
        ob.highlighted = true;
    }

    // build and run the UI - only after all the objects exist
    // @ts-ignore       // we're sticking a new thing into the world
    world.ui = new WorldUI(world, -1, div);
    // free camera (arrow keys / WASD + mouse drag) instead of the orbit camera
    const freeCam = new FreeCamera(world);
    relabelCameraMenu();
    makeReefUI({ world, school, shark, freeCam, floorMesh: /** @type {T.Mesh} */ (floor.objects[0]), where: div });
    // the camera updates every frame, even while the world is paused
    world.go({ predraw: () => freeCam.update() });

    // handy for debugging from the console
    // @ts-ignore
    window.world = world;
} else {
    alert("Can't find Div for GrTown!");
}
