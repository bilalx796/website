# Coralhaven — Graphics Town Plan (CS559 Workbook 7)

A sunken reef town: glass habitat domes, a submarine dock and an old shipwreck,
built into a coral reef. Fish, turtles and mantas live among the buildings.
The signature feature is a **fish school (boids) that swims into a shape the
user draws**.

## Layout (top-down, north = −Z)

```
                 deep trench (drop-off, dark, fog)
   ┌─────────────────────────────────────────────────┐
   │  shark patrol loop             kelp forest       │
   │                                (skinned, sway)   │
   │   SHIPWRECK                                      │
   │   (eels, bubbles)          OPEN WATER            │
   │                          (school forms shapes)   │
   │        HABITAT DOMES                             │
   │        (lit windows, tram,        coral          │
   │         town square)              gardens        │
   │                                                  │
   │  ═══ submarine route (closed spline) ═══         │
   │                                                  │
   │   DOCKING STATION       crab flats    vents      │
   │                         mining rig    (bubbles)  │
   └─────────────────────────────────────────────────┘
```

## Features

### Signature: the living school
1. Free swimming: boids (separation / alignment / cohesion) + avoid floor and buildings.
2. Draw a shape on a pop-up pad → the stroke is resampled at **equal arc length**
   into one target per fish → the school swims into the shape and holds it.
3. Preset shapes (heart, star, fish, "CS559").
4. Food pellets: click to drop food, the school swarms it (attractor — like the WB2 cheese).
5. Shark: predator avoidance scatters the school (repeller — like the WB2 poop), then it re-forms.
6. Night: fish glow (bioluminescence), so drawn shapes light up.
7. Tail wiggle in a TSL vertex shader, per-instance phase. One `InstancedMesh`.

### Everything else
| Kind | Object | Behavior / interest |
|---|---|---|
| Building | Habitat domes | Glass (env map), lit windows at night, connecting tubes (`TubeGeometry`) |
| Building | Docking station | Gangway extends when the sub docks, signal light |
| Building | Shipwreck | Assembled from parts, leaking bubbles, eel lair |
| Building | Beacon tower | Searchlight tracks the submarine with `lookAt` |
| Vehicle | Submarine | Arc-length spline route + state machine: cruise → brake → dock → wait → depart. Banks into turns. **Rideable** |
| Vehicle | Tram | Runs between domes on rails + ties (sweep). **Rideable** |
| Vehicle | Mining rig | 4+ DOF articulated digger: scoop sand, carry, dump |
| Nature | Sea floor | Own `BufferGeometry`, noise dunes, vertex colors, trench |
| Nature | Coral | Procedurally generated branching coral |
| Nature | Kelp forest | Skinned bone chain, noise current |
| Nature | Anemones, vents | Rippling tentacles, bubble columns |
| Creature | Fish school | Boids + shapes (above) |
| Creature | Jellyfish | Morph targets (bell pulse) + color throb, rises on each pulse |
| Creature | Sea turtle, manta | Skinned flippers / wings, spline wandering. **Rideable** |
| Creature | Shark | Patrol loop, scares the school. **Rideable** |
| Creature | Crabs | Articulated; state machine walk / stop / wave claw |
| Creature | Moray eel | Tube body, darts out of the wreck and back |

### Look
Blue-green fog, caustics (animated TSL shader), light rays from the surface,
marine snow, day/night via `timeOfDay` (turquoise noon → black night with glowing
fish, jellies, windows and searchlights).

## Concepts from earlier workbooks

| WB | Concept (what was built) | Where it shows up |
|---|---|---|
| 1 | Time-delta animation, color fades/throbs, mouse events, fireworks particles | All motion uses `stepWorld(delta)`; jellyfish color throb; bubbles spawn/rise/fade like the fireworks; click to drop food |
| 2 | Transforms, hierarchies, articulated characters, quadcopter props, **boids** (ants: cheese/poop, capped turning, collision flash) | Sub propeller and fins; articulated crabs; the fish school extends the ant boids (food = cheese, shark = poop) |
| 3 | Parametric curves, tangents, Bézier, cardinal splines, **arc-length parameterization**, train track with rails/ties, equally spaced points | Sub route = cardinal spline with an arc-length table (same approach as the 03-24 train); tram track with rails and ties; the drawn shape is resampled at equal arc length (03-21) |
| 4 | Three.js scene, materials, lights, spotlights (museum), `lookAt` (radar dish), `CanvasTexture`, 3D particles (04-27) | Beacon tracks the sub with `lookAt`; sub headlight spotlight; canvas-texture signs; vent particles |
| 5 | `GrObject`, hierarchical rides, 4+ DOF machines, hand-built `BufferGeometry`, UVs/textures, normal/bump maps, skybox, env map, procedural textures, day/night glow buildings | Mining rig; sea floor geometry; normal-mapped rocks, bump-mapped coral; glass domes with env map; window glow |
| 6 | Performance: build once, send once, instancing | `InstancedMesh` for fish, coral, kelp; spatial grid for boid neighbors |
| 7 | Skinning, morphing, tubes and sweeps | Kelp/turtle/manta skinned; jellyfish morphed; tubes, eel, tram rails |

## Rubric coverage
| Rubric item | Covered by |
|---|---|
| Object diversity | ~15 kinds: buildings, nature, creatures, vehicles |
| Behavior diversity | Boids, shape forming, predator avoidance, spline paths, state machines, pulsing, swaying, docking, digging |
| Theme | One coherent sunken town |
| Artistic merit | Fog, caustics, day/night, glow |
| Mesh animation | Jellyfish (morph), kelp/turtle/manta (skinning) |
| Particle system | Bubbles, marine snow, the boids |
| Animated shader | Caustics, fish tail wiggle |
| Procedural geometry | Coral |
| Noise | Sea floor, kelp current |
| Curved surface | Dome tubes, eel, tram rails |
| Complex behavior | Shape-forming school + predator; docking submarine; mining rig |

## Build order
- [x] 1. Foundation: sea floor, fog, lighting, submarine (rideable), docking station
- [x] 2. Signature: boids, draw pad, shape forming, food, presets
- [x] 3. Town: domes, tubes, wreck, beacon, coral, kelp, tram
- [x] 4. Creatures: jellyfish, turtle, manta, crabs, shark (+ school reaction), eel, mining rig
- [x] 5. Polish: caustics, day/night + glow, bubbles, marine snow, light rays
- [x] 6. Documentation: notes for the workbook form and video scripts

## Files
```
graphics-town/
├── 07-06-01.html / 07-06-01.js   main page (framework UI preserved)
├── libs/                         CS559 framework (copied from wb5)
└── objects/
    ├── util/noise.js             seeded gradient noise + fBm
    ├── util/curves.js            closed cardinal spline + arc-length table
    ├── terrain.js                floorHeight(x, z) shared by everything
    ├── layout.js                 where things go in the town
    ├── environment.js            lights, fog, water color
    ├── seafloor.js               sea floor mesh
    ├── submarine.js, dock.js     submarine + route state machine, docking station
    ├── fishSchool.js, shapes.js  boids school, lead fish, shape targets
    ├── reefUI.js                 the Coralhaven control panel + drawing pad
    ├── shaders.js, materials.js  TSL caustics/uniforms, procedural textures, glow
    ├── habitats.js, tram.js      domes, walkway tubes, tram track + car
    ├── wreck.js, beacon.js       shipwreck, beacon tower
    ├── coral.js, kelp.js, rocks.js
    ├── jellyfish.js, turtle.js, manta.js, shark.js, crabs.js, eel.js
    ├── miningRig.js, effects.js  digger; vents, bubbles, marine snow, anemones
    └── placement.js, util/       keep-out zones; noise, curves, skinning helpers
```

See NOTES.md for documentation notes.

## Documentation notes
- Write the workbook form answers and the video narration in your own words.
- AI statement: say that Claude (Anthropic) was used to help design and write code.
- Attributions: list anything not made by you; "none" where nothing applies.
