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

**To submit:** copy `07-06-01.html`, `07-06-01.js` and the `objects/` folder into the
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
| 5 | `GrObject`, hand-built `BufferGeometry` (sea floor, wreck hull, manta), normal map (rocks), bump map (coral), environment map (glass), day/night glow windows, 4-DOF mining rig |
| 6 | Instancing (fish, coral, rocks, ties, bubbles, snow), merged static geometry |
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
- **Attributions:**
  - The CS559 framework (course-provided).
  - three.js r180 (MIT), loaded from unpkg, including the `BufferGeometryUtils` add-on.
  - The noise is an implementation of Ken Perlin's published "Improved Noise" algorithm.
  - Code reused from your own earlier workbooks needs no attribution.
- **Assets:** no external models or image files. All textures are painted in code.
