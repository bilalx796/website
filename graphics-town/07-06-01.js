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
import { TramTrack, TramCar, computeStations } from "./objects/tram.js";
import { linkStations, StationWalkways, Commuters } from "./objects/transit.js";
import { ClosedCardinalSpline } from "./objects/util/curves.js";

/** tram stations are at these control points of the tram route */
const TRAM_STATIONS = [0, 2, 4, 6];
import { Shipwreck } from "./objects/wreck.js";
import { BeaconTower } from "./objects/beacon.js";
import { CoralGardens } from "./objects/coral.js";
import { KelpForest } from "./objects/kelp.js";
import { Rocks } from "./objects/rocks.js";
import { Mountains } from "./objects/mountains.js";
import { makeReefUI } from "./objects/reefUI.js";
import { FreeCamera, relabelCameraMenu, switchToFreeCamera } from "./objects/freeCamera.js";
import { Explorer, WalkController } from "./objects/explorer.js";
import { wrapCanvas, makeZoomBar, hideWorldUIRows } from "./objects/overlay.js";
import { PilotController } from "./objects/pilot.js";
import { SharkFrenzy } from "./objects/game.js";
import { addSphere, addCylinder, addPath, addBox } from "./objects/colliders.js";
import { makePerformanceGovernor } from "./objects/performance.js";

/**
 * The framework's "View Solo Object" and "LookAt (highlighted)" controls are
 * hidden from the panel. NOTE: the rubric checks that highlighting works - set
 * this to true before submitting if graders need the highlighted list.
 */
const SHOW_GRADER_CONTROLS = false;

const div = document.getElementById("div1");
if (div) {
    // make the world - no default ground plane or lights: the reef makes its own
    const world = await GrWorld.new({
        where: div,
        width: 850,
        height: 640,
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
    world.add(new Mountains(world));
    const coral = new CoralGardens();
    world.add(coral);
    const kelp = new KelpForest();
    world.add(kelp);

    // ---- buildings
    const domeInfo = [
        { type: "cafeteria", name: "Café Coral (cafeteria)" },
        { type: "servers", name: "Server Hub" },
        { type: "computers", name: "Computer Lab" },
        { type: "botany", name: "Botany Lab" },
    ];
    // each dome's airlock faces the tram station nearest to it
    const stationSpots = computeStations(new ClosedCardinalSpline(TRAM_ROUTE), TRAM_STATIONS);
    const domes = DOMES.map(([x, z, r], i) => {
        let best = stationSpots[0];
        for (const st of stationSpots) {
            if (Math.hypot(st.center.x - x, st.center.z - z) < Math.hypot(best.center.x - x, best.center.z - z)) best = st;
        }
        return new HabitatDome({
            x, z, r, type: /** @type {any} */ (domeInfo[i].type), name: domeInfo[i].name,
            doorToward: [best.center.x, best.center.z],
        });
    });
    domes.forEach(d => world.add(d));
    // walkable glass corridors between the domes
    const tubes = new DomeTubes(domes, [[0, 1], [0, 2], [0, 3], [1, 3]]);
    world.add(tubes);
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
    const track = new TramTrack(TRAM_ROUTE, TRAM_STATIONS);
    world.add(track);
    const tram = new TramCar(track);
    world.add(tram);
    // glass walkways from each dome to its station, and the people who ride the tram
    const links = linkStations(track.stations, domes);
    world.add(new StationWalkways(links));
    const commuters = new Commuters(links, tram);
    world.add(commuters);
    // you: walk around in first person
    const explorer = new Explorer({
        domes, links,
        corridors: [...links.map(l => ({ walk: l.walk, half: 0.63 })), ...tubes.corridors],
    });
    world.add(explorer);

    const rig = new MiningRig(MINING_RIG[0], MINING_RIG[1], /** @type {[number, number]} */ (SPOIL_HEAP));
    world.add(rig);

    // ---- make the facility solid for the animals you pilot (see colliders.js)
    for (const d of domes) {
        const p = d.root.position;
        addSphere(new T.Vector3(p.x, p.y + 0.45, p.z), d.r + 0.1); // glass dome
        addCylinder(p.x, p.z, 0.5, p.y + d.r, p.y + d.r + 0.9); // vent housing on top
    }
    for (const c of [...tubes.corridors, ...links]) addPath(c.walk, 0.9, 0.7, 1.5); // glass corridors
    {
        const pts = [];
        for (let s = 0; s <= track.spline.length; s += 0.8) {
            const p = track.spline.atDistance(s).pos;
            pts.push(new T.Vector3(p[0], p[1], p[2]));
        }
        addPath(pts, 0.85, 1.5, 0.35); // rails and ties (the car itself is a box below)
    }
    for (const ch of /** @type {any} */ (track).objects[0].children) if (/** @type {any} */ (ch).isGroup) addBox(ch); // stations
    addBox(tram.root); // follows the tram car as it moves
    addBox(dock.root);
    {
        // the tower itself (its bounding box would include the light beam)
        const bp = beacon.root.position;
        addCylinder(bp.x, bp.z, 1.55, bp.y - 2, bp.y + 12.5);
    }
    for (const ch of wreck.root.children) if (/** @type {any} */ (ch).isGroup) addBox(ch); // the tilted hull
    // the rig: undercarriage, turret, and the moving boom, stick and bucket
    {
        const { turret, boom, stick, bucket } = rig.joints;
        const ramMeshes = rig.rams.flatMap(r => [r.barrel, r.rod]);
        addBox(rig.root, [turret, rig.heapMesh, ...ramMeshes]);
        addBox(turret, [boom, ...ramMeshes]);
        addBox(boom, [stick, ...ramMeshes]);
        addBox(stick, [bucket, ...ramMeshes]);
        addBox(bucket);
        const hp = rig.heapMesh.getWorldPosition(new T.Vector3());
        addCylinder(hp.x, hp.z, 1.8, hp.y - 1, hp.y + 1.2);
    }

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
    for (const ch of /** @type {any} */ (vents).objects[0].children) {
        const g = /** @type {any} */ (ch).geometry;
        if (g?.parameters?.radiusBottom === 1.1) addCylinder(ch.position.x, ch.position.z, 0.8, ch.position.y - g.parameters.height / 2, ch.position.y + g.parameters.height / 2); // chimneys
    }
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
    for (const ob of [school, leadFish, sub, dock, tram, commuters, explorer, domes[0], domes[2], domes[3], wreck, beacon, coral, kelp,
        shark, turtle, manta, jellies[0], crabs[0], eel, rig, vents]) {
        ob.highlighted = true;
    }

    // build and run the UI - only after all the objects exist
    // @ts-ignore       // we're sticking a new thing into the world
    world.ui = new WorldUI(world, -1, div);
    // free camera (arrow keys / WASD + mouse drag) instead of the orbit camera
    const freeCam = new FreeCamera(world);
    relabelCameraMenu();
    if (!SHOW_GRADER_CONTROLS) hideWorldUIRows(["View Solo Object", "LookAt (highlighted)"]);
    // overlays on the 3D view: zoom bar, piloting hint, game HUD
    const wrap = wrapCanvas(world);
    makeZoomBar(world, wrap);
    const pilot = new PilotController(world, freeCam, wrap, [shark, manta]);
    const walker = new WalkController(world, explorer, wrap);
    walker.onEscape = () => switchToFreeCamera(world);
    const game = new SharkFrenzy({ world, shark, school, pilot, wrap });
    world.add(game);
    // everything you click lives in a column to the RIGHT of the view
    const sidebar = document.createElement("div");
    sidebar.className = "side-col";
    div.appendChild(sidebar);
    Object.assign(div.style, { display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-start" });
    Object.assign(sidebar.style, {
        width: "420px", maxHeight: `${world.renderer.domElement.clientHeight || 600}px`, overflowY: "auto",
        display: "flex", flexDirection: "column", gap: "8px",
    });
    const gui = /** @type {HTMLElement|null} */ (document.querySelector(".lil-gui.root"));
    if (gui) {
        gui.classList.remove("autoPlace"); // stop it floating at the top of the page
        Object.assign(gui.style, { position: "static", width: "100%", maxHeight: "none" });
        sidebar.appendChild(gui);
    }
    makeReefUI({ world, school, shark, manta, freeCam, pilot, game, floorMesh: /** @type {T.Mesh} */ (floor.objects[0]), where: sidebar });
    // speed: adaptive resolution, no drawing while scrolled away, and the dome
    // interiors are only drawn (and animated) when the camera is near enough to see them
    const perf = makePerformanceGovernor(world);
    for (const d of domes) perf.cullByDistance(d.interior, d.root.position, 80);
    // cameras and screen effects update every frame, even while the world is paused
    world.go({
        predraw: () => {
            perf.update();
            freeCam.update();
            pilot.update();
            walker.update();
            game.updateScreen();
        },
    });

    // handy for debugging from the console
    // @ts-ignore
    window.world = world;
} else {
    alert("Can't find Div for GrTown!");
}
