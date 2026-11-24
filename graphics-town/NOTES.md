# Coralhaven — documentation notes

Raw material for the Workbook 7 form and the two videos. **These are notes, not
answers.** Write the form answers and the video narration in your own words, and
make sure you can explain every item you list. The course checks for that.

---

## How to run it

ES modules need a web server (opening the file directly won't work):

```
cd /Users/bilalali/website
python3 -m http.server 8000
# then open http://localhost:8000/graphics-town/07-06-01.html
```

The page needs a WebGPU-capable browser (recent Chrome, Edge or Safari). Three.js
falls back to WebGL2 when WebGPU isn't available.

**To submit:** copy `07-06-01.html`, `07-06-01.js`, the `objects/` folder and the
`textures/` folder into the
Workbook 7 repo, which has its own `libs/`. All paths are relative, so it works there
too. Then clone the pushed repo to a fresh folder and test it before the deadline.

---

## Form question notes

### Theme
A sunken research town on a coral reef. Glass habitat domes joined by tubes, a tram
loop, a submarine dock, a lighthouse-style beacon and an old shipwreck, surrounded by
coral, kelp and reef animals. The centerpiece: the fish school swims into any shape you
draw.

### Mesh animation (which method and why)
- **Skinning (kelp, sea turtle, manta ray, moray eel, shark).** All five bend smoothly along a
  chain (a stalk, a flipper, a wing, a body). A bone chain with each vertex blended
  between neighboring bones gives that continuous bend, and each frame only changes a
  few bone rotations.
  - Kelp: 7 bones, weights from vertex height.
  - Turtle: flippers blend body, then shoulder, then tip.
  - Manta: inner and outer wing bones with a traveling wave.
  - Eel: an 8-bone chain.
  - Shark: one lathe body with a 6-bone chain from head to tail, swimming with a
    wave that grows toward the tail. The fins ride on the bones.
- **Morphing (jellyfish).** A jellyfish swims by changing the shape of its whole bell:
  it squeezes narrower and taller and the tentacles pull in. That isn't a rotation of
  rigid parts, so it suits blend shapes. The relaxed and contracted bells are morph
  targets, plus a second "drift" target where the tentacles trail sideways. The offset
  form means the influences don't need to sum to 1.

### Most interesting objects (pick 3–5)
1. **Fish school:** 400 boids in one `InstancedMesh`. The TSL vertex shader orients
   and wiggles each fish from its direction attribute.
2. **Habitat domes:** four interior types (town hall, homes, lab, garden). Glass
   reflects a procedural cube environment map, windows glow at night, and tiny residents
   walk around inside.
3. **Shipwreck:** the hull is a hand-built `BufferGeometry` (U-shaped cross sections
   stitched together, with UVs) and a procedurally painted plank texture. It has a broken
   deck (a shape with a hole), a snapped mast, cannons, an anchor chain, and a treasure
   chest that opens.
4. **Tram and track:** the rails are sweeps (a square profile extruded along curves
   offset from the spline). Ties sit at equal arc-length spacing as one `InstancedMesh`.
   Pylons reach down to the noise terrain. There are four stations.
5. **Procedural coral:** five generators (recursive branching, ridged-noise brain coral,
   planar fan, tubes, table) produce about 220 instanced corals in about 10 draw calls.

Also: submarine (lathe hull, propeller, rudder and dive planes), beacon tower, mining
rig (4 degrees of freedom), shark (skinned lathe body with a real shark profile,
countershading, curved beveled fins, uneven tail), crabs (8 legs and 2
claws each), sea floor (noise height field, vertex colors), hydrothermal vents.

### Most interesting behaviors (pick 2–3)
1. **School forms a drawn shape.**
   - Your strokes are resampled at equal arc length (the WB3 idea), one target per fish.
   - Fish are matched to targets greedily (nearest free fish), so none crosses the
     whole school.
   - Flocking forces drop, a seek force takes over, and each fish circles its target so
     the shape shimmers.
   - The shape is placed to face the camera and stay on screen above the rooftops.
2. **Predator and prey.**
   - The shark patrols by following a "carrot" along a spline with a capped turn rate
     (WB2's `turnToward`), then periodically switches to hunting the school's center.
   - Fish within the fear radius flee and panic, briefly ignoring their shape target,
     then re-form.
   - Food pellets work the opposite way: an attractor, like the WB2 cheese.
3. **Submarine docking.**
   - State machine: cruise, approach, docked, depart, cruise.
   - Braking uses v ∝ √(remaining distance), so it stops exactly at the dock.
   - The dock reacts: its gangway extends and its light blinks amber.
   - The sub banks into turns based on path curvature, and the beacon tracks it with
     `lookAt`.

Others: the tram's stop/doors cycle, the mining rig's dig and dump cycle (the heap
grows), crab state machine (walk sideways, pause, wave a claw, turn), eel
(hide/out/look/back), jellyfish pulse and sink, turtle, manta.

### Technically advanced things (pick up to 3)
1. **Shape-forming boids** (complex behavior plus a large particle system): a spatial
   grid for neighbors, arc-length stroke resampling, greedy assignment, predator
   avoidance and food attraction, all drawn in one instanced draw call.
2. **Mesh animation:** jellyfish morph targets (pulse plus drift) and skinned kelp,
   turtle, manta and eel. Each weight scheme and bone chain was built by hand.
3. **Animated shaders in TSL:**
   - Caustics on the sea floor: domain-warped interference of moving sine waves, only
     on upward-facing surfaces, fading with depth, off at night.
   - The fish vertex shader: places each fish from instance attributes and runs the
     tail-wave wiggle.
   - Anemone tentacle sway.

Also candidates: procedural coral, noise terrain, the day/night cycle.

### Shaders
Yes, written in TSL (required by the WebGPU renderer). They're in `objects/shaders.js`,
`objects/fishSchool.js` and `objects/effects.js`:
- **Caustics:** an emissive node on the sea floor material.
- **Fish:** a position node that builds each fish's frame (forward, right, up) from a
  per-instance direction, plus the tail wiggle.
- **Anemones:** sway that grows toward the tentacle tips, and tips that glow at night.

---

## Newer features (add these to the form and videos)
- **Shark Frenzy game** (`objects/game.js`): play as the shark for 30 seconds and eat
  as many fish as you can.
  - The fish flee from you (larger fear radius).
  - Each catch removes that fish, makes a blood cloud (instanced particles), flashes the
    screen and shakes it.
  - The screen turns bloodthirsty as the clock runs down: the water and fog go red, a red
    vignette closes in, a CSS color filter heats up, and a heartbeat pulses in the last
    6 seconds.
  - The high score is saved in localStorage.
- **Piloting** (`objects/pilot.js`): drive the shark or manta with a chase camera.
  - Turning is capped (yaw rate), pitch eases toward a target, and you bank into turns.
  - When you let go, the manta blends back onto its spline and the shark returns to its
    patrol.
- **First-person walking** (`objects/explorer.js`): a rideable resident.
  - Ground height is the highest of: sea floor, dome floor, platform, walkway.
  - Dome glass is solid except at the airlock, which opens for you. A funnel guides you
    into the doorway.
  - You also collide with the machinery in the middle of each dome.
- **Commuters and walkways** (`objects/transit.js`): glass walkways connect each dome's
  airlock to its station.
  - Each resident runs a state machine: home, walk to station, wait, board (the tram
    holds its doors), ride, get off at a different station, walk into that dome.
  - This is the rubric's "train stops at a station and people get on and off" example.
- **Domes with moving parts:**
  - Every dome: chasing base lights (one instanced mesh with per-instance colors), a vent
    turbine, and sliding airlock doors.
  - Town hall: rotating observation ring, elevator, hologram.
  - Lab: 3-joint robot arm.
  - Garden: vertical farm wheel whose planters counter-rotate to stay upright.
  - Homes: merry-go-round and windows that switch on and off.
- **Walkable glass corridors** (`objects/corridor.js`): one sweep builder makes the
  dome-to-dome corridors and the ramps from each airlock to its station platform.
  - It has a level deck, a half-ellipse glass arch, ribs, a ceiling light strip, end
    collars and support posts.
  - Each corridor returns its walking path. Domes record an "opening" for each one, so
    the first-person explorer can walk hub to hub and out to every station.
  - The tram track was lowered so the ramps are gentle.
- **Buildings** (`makeBuilding` in `habitats.js`): window grids with sills, doors,
  cornices, gabled roofs with chimneys (homes), and flat-roofed shops with parapets,
  striped awnings and lit signs. Panes are merged per building.
- **Shark tail fix:** the swim wave's phase is accumulated (`phase += frequency × dt`)
  instead of computed as `time × frequency`, so changing speed no longer makes the tail
  jump. Frequency and amplitude are also capped.
- **Shark Frenzy is a chase:** larger fear radius, faster panicked fish and a weaker pull
  back home. The shark has to sprint to catch them.
- **Zoom bar:** changes the camera field of view.
- **Hidden WorldUI rows:** "View Solo Object" and "LookAt (highlighted)" are hidden
  (`SHOW_GRADER_CONTROLS` in `07-06-01.js`). **Turn it back on before submitting**: the
  rubric checks highlighting.

## Latest features (add these to the form and videos)
- **Solid structures** (`objects/colliders.js`): the shark and manta can't swim through
  the facility anymore.
  - Structures are simple shapes: spheres (dome glass), vertical cylinders (beacon, vents,
    corridor and track samples) and oriented boxes (stations, dock, wreck, tram car, the
    rig's boom, stick and bucket).
  - Oriented boxes are stored in the object's own frame and re-read every frame, so moving
    things (the tram, the excavator's arm) stay solid where they are now.
  - Each animal is a few spheres along its body (nose to tail; across the manta's wings).
    Overlaps push the animal out, and the part of its heading that points into the wall is
    removed, so it slides along instead of stopping dead.
- **Excavator stays out of the sand** (`keepAboveSand` in `objects/miningRig.js`): the
  keyframed poses don't know the terrain, so after each pose update, probe points on the
  bucket and stick are checked against `floorHeight`. If any is underground, the boom is
  raised (by about penetration ÷ reach, a few iterations). Only the teeth may bite in a
  little.
- **Openings cut in the dome glass** (`cutOpenings` in `objects/habitats.js`): the
  hemisphere used to cover the corridor and walkway entrances.
  - Each opening is the corridor's arch cross-section pushed out along its direction.
  - Glass triangles on the edge of an opening are split recursively (new points pushed
    back onto the sphere) until small, then dropped if inside. That gives a clean edge
    from a coarse sphere.
  - Rib triangles crossing an opening are dropped, and a metal frame (a tube along the
    exact sphere and arch intersection curve) finishes each opening.
- **Better people** (`objects/people.js`):
  - Jointed bodies: torso, head with hair, arms at the shoulders, thighs at the hips,
    shins at the knees. Standing people now have legs.
  - Walk cycle (`walkPose`): legs and arms swing in opposition and knees bend on the swing.
    Sitting (`setSeated`) uses the same joints.
  - Speed: each part's pieces are merged and colored with vertex colors, every person
    shares one material, and geometries are cached per color combination.
- **Realistic tram and stations** (`objects/tram.js`):
  - Tram: painted livery (canvas texture with lettering and car number), rounded cab ends
    with windshields, destination signs, head and tail lights, corrugated roof with
    equipment, seats and grab poles inside, door windows, flanged wheels.
  - Stations: tiled platforms with a tactile safety edge, a curved corrugated roof on steel
    columns, glass wind screens, wooden benches, a lit name sign and a "next tram" display.
    Furniture stays clear of where the walkway arrives.
- **Textured coral, shark and manta:**
  - Coral: a sponge normal map for pores, plus a canvas polyp texture tinted by each
    instance's color.
  - Shark and manta: a leather normal map for skin grain, plus a mottled canvas color map
    multiplied over their vertex-color countershading. The manta got proper UVs (a
    top-down projection of its planform).
- **Brighter nights** (`objects/environment.js`): the night water is a deep blue instead
  of near-black, the moonlight and ambient light stay stronger, and the extra night fog is
  thinner. `NightLights` adds warm point lights over each hub, the dock and the mining
  rig that fade in with `reef.night`. They stay switched on at intensity 0 during the day,
  because adding or removing lights would recompile every shader.
- **Fish skin shader** (`fishSkin` in `objects/fishSchool.js`): a TSL color node paints
  each fish from its un-bent local position: countershading (dark back, pale belly), a
  scalloped scale pattern, dark stripes on about a third of the fish (chosen by the
  per-instance phase), darker fins and tail, and an eye on each side. The body sphere has
  more segments, so the flat shading looks smoother.
- **Performance** (`objects/performance.js`):
  - Adaptive resolution: the frame rate is measured. Below 45 fps the pixel ratio drops;
    after several smooth windows it rises again (up to 2x on high-DPI screens).
  - Nothing is drawn while the canvas is scrolled off screen or the tab is hidden
    (IntersectionObserver).
  - Distance culling: dome interiors are hidden, and their animations paused, when the
    camera is far away, with hysteresis so they don't flicker.
  - Textures are loaded once and shared between uses (`texturePack` caches them).

## The four hubs (`objects/interiors.js`)
- **Café Coral (cafeteria):**
  - Buffet line with a sneeze guard, food pans, heat lamps, trays, plates and a drinks
    station, plus a chef.
  - Six round tables with chairs, pendant lights and a canvas-texture menu board.
  - Diners run a state machine: queue along the buffet (a tray appears), walk the aisles
    to a free chair, eat, then go back in line.
- **Botany Lab:**
  - Exotic plants: glowing bulb plants (curved tube stalks), spiral ferns (tubes along
    spiral curves), lathed pitcher plants, cone succulents and a giant swaying leaf plant.
  - Hydroponic rack, bell jars, grow lights, and a scientist who inspects each bed.
- **Server Hub:**
  - Two rows of racks; their LEDs are one InstancedMesh with per-instance blinking colors.
  - Cable trays, a cooling unit with spinning fans, a turning status ring, and a
    technician.
- **Computer Lab:** desks with monitors scrolling code (texture offset), office chairs,
  typing engineers, server racks, and a curved wall display whose canvas texture is
  redrawn with live graphs.
- **Shells:** geodesic glass (canvas panel texture), concrete bases, themed floors, and a
  doorway frame with sliding glass doors. Residents can use the station doorways, but the
  first-person explorer can't (it stays inside the hubs and corridors). Furniture blocks
  the explorer through per-hub obstacle circles.

## Camera
The orbit camera is replaced by a free camera (`objects/freeCamera.js`): arrow keys or
WASD move, dragging turns the view, E/Q go up and down, Shift is faster, and the scroll
wheel moves forward and back.
- The framework wasn't edited. Its orbit and fly controls are switched off from our code,
  and the WorldUI menu shows "Free Camera". Follow, Drive and LookAt still work.
- Forming a shape glides the camera to face it squarely ("📷 View shape" does it again).
- "Send the shark" frames the chase from the side of the school.

## Earlier workbooks used (good for the video)

| WB | Used for |
|---|---|
| 1 | Delta-time animation, the jellyfish 3-color throb, bubbles that spawn, rise and pop (like the fireworks) |
| 2 | Boids (cheese becomes food, poop becomes the shark), capped turning, hierarchies, crab legs and claws |
| 3 | Cardinal splines plus arc-length tables (sub, tram, turtle, manta, shark), equal arc-length stroke resampling, track with rails and ties |
| 4 | `lookAt` tracking (beacon follows the sub), spotlights, `CanvasTexture` signs |
| 5 | `GrObject`, hand-built `BufferGeometry` (sea floor, wreck hull, manta), normal maps (rocks, coral, shark, manta, tram), bump map (coral), environment map (glass), day/night glow windows, 4-DOF mining rig |
| 6 | Instancing (fish, coral, rocks, ties, bubbles, snow), merged static geometry (people parts, station pieces) |
| 7 | Skinning, morphing, tubes and sweeps (walkway tubes, rails, eel) |

---

## Video outlines (1–2 minutes each, your own voice)

**Video 1: theme and tour.** Start on the overview and say what Coralhaven is, then:
1. Draw a shape and let the school form it.
2. Send the shark.
3. Ride the submarine into the dock.
4. Switch to night (glowing fish, windows, beacon).
5. Quick looks at the wreck, kelp, crabs and mining rig.

**Video 2: technical.** Pick two:
- **Boids shape-forming:** show the code for resampling, assignment and the seek force.
- **Mesh animation:** jellyfish morph targets vs. skinned turtle or kelp, and why each
  fits.
- **TSL caustics or the fish shader.**

---

## AI statement and attributions (you must fill these in; "none" is not allowed blank)
- **AI:** be accurate. Claude (Anthropic) was used heavily to design the town and write
  the code. Check the course AI policy and describe your own contribution honestly.
- **Texture attribution (required):** eleven CC0 (public-domain) texture sets from
  **ambientCG** (https://ambientcg.com), resized to 512 px in `textures/`:
  - Ground054 (sea floor sand), Rock063 (rocks), Planks037A (shipwreck, station benches)
  - Concrete034 (hub bases, platform sides), DiamondPlate008A (corridor floors, dock),
    MetalPlates004 (submarine hull, tram body)
  - Sponge001 (coral pores), Leather037 (shark and manta skin grain)
  - CorrugatedSteel009 (tram and station roofs), Rubber004 (tram floor), Tiles107
    (station platforms)

  CC0 needs no permission, but the course still requires you to list them.
- **Attributions:**
  - The CS559 framework (course-provided).
  - three.js r180 (MIT), loaded from unpkg, including the `BufferGeometryUtils` add-on.
  - The noise is an implementation of Ken Perlin's published "Improved Noise" algorithm.
  - Code reused from your own earlier workbooks needs no attribution.
- **Assets:** no external models. The only image files are the ambientCG textures above;
  every other texture (signs, livery, polyps, skin mottling, glass panels) is painted in
  code with canvas.
