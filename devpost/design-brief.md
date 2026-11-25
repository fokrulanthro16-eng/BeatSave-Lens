---
status: approved
---

# Design brief: BeatSave

## The one spatial moment
Kneeling beside a floor cushion or training manikin wearing Spectacles, the rescuer looks down and pinches once to lock a 26 cm CPR pacing ring flush onto the surface around their hands, following the 110 BPM visual pulse and wooden metronome tick while keeping both hands free.

## Why it belongs on glasses
- Uses: draws in the world, leaves your body free
- Why it's better than the phone or laptop version: A phone has to be held, propped away from the chest, or unlocked with wet or gloved hands. Spectacles lock the pacing ring directly on the floor around the rescuer's hands so eyes stay on the patient.

## Product or overlay
- Type: overlay (anchors to a real flat surface: floor, mat, cushion, or training manikin)
- What the real version would sense: Flat surface position and surface normal via `WorldQueryModule`
- Stand-in for the preview: Uses a horizontal floor-plane projection below the preview camera whenever `WorldQueryModule` returns no hit in Lens Studio Preview.

## Where things live
- Where the user is looking during the main task: Downward ~45 degrees at the chest and hand contact zone roughly 70 to 110 cm away.
- Outer track & 30 radial ticks: Flat on the locked surface, 26 cm outer diameter (leaving an unobstructed ~16 cm inner center so stacked hands never block the count).
- Inner rhythm pulse ring: Flat on the locked surface, 19 cm diameter (contracts and expands smoothly with a damped spring curve outside the 16 cm hand zone).
- Angled readout & cycle label: Positioned 17.5 cm beyond the top edge of the ring, tilted 35 degrees toward the kneeling rescuer (`01 / 30` + `CYCLE 1`, or `2 BREATHS` + `5.0s`), so arms never obscure the digits.
- Spatial mode toggle pill (`30:2` / `HANDS-ONLY`): Positioned 14.5 cm to the right of the angled readout, tilted 35 degrees toward the rescuer.

## Hands and input
- Primary pinch (anywhere): Single pinch while placing locks the ring to the surface and immediately starts Beat 1 (`110 BPM`). Subsequent short pinches pause or resume.
- Hold pinch (`1.2 s`): Unlocks and returns to placement mode so the rescuer can reposition the ring.
- Spatial mode pill pinch: Large target that highlights when aimed at and toggles between `30:2` (30 compressions + `5.0 s` breath window) and `HANDS-ONLY` (continuous 110 BPM pacing with a 30-beat visual lap counter).
- Preview keyboard fallbacks: `Space` (lock / pause / resume), `M` (toggle mode), `R` (unlock and reset).

## When things show
- Before first pinch (`PLACING`): Ring glides along the floor surface under gaze; readout displays `PINCH TO LOCK`.
- During compressions (`COMPRESSIONS`): 30 perimeter ticks illuminate in Warm Off-White (`#F4F3EE`) one beat at a time (`60 / 110 = 0.54545 s`), shifting to Signal Coral (`#E63946`) with a higher-pitched wooden accent on beats 28, 29, and 30 in `30:2` mode before the breath pause.
- During breath pause (`BREATH_PAUSE`): Readout switches to `2 BREATHS` with a `5.0s` countdown while perimeter ticks wind down in Signal Coral and a soft two-note harmonic chime plays on entry and cycle resume.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. Moving the preview camera in `PLACING` state moves the 26 cm ring smoothly along the floor plane without sticking to the user's face.
2. Clicking or pressing `Space` in Interactive Preview locks the ring in world space and starts Beat 1 immediately at 110 BPM (`0.54545 s` per beat) with wooden tick audio.
3. Beats 28, 29, and 30 play the accent wooden tick and illuminate in Signal Coral (`#E63946`) in `30:2` mode, then enter a `5.0 s` `2 BREATHS` countdown chime before starting Cycle 2 automatically.
4. Pinching the spatial mode pill (or pressing `M`) switches between `30:2` and `HANDS-ONLY` continuous 110 BPM pacing without breath pauses.
5. Holding pinch for `1.2 s` (or pressing `R`) unlocks the ring back to `PLACING` mode for repositioning.

## Out of scope
- Compression depth or chest recoil measurement
- Pulse, heart rate, breathing, or vital-sign detection
- Camera-vision body scanning, pose estimation, or medical diagnosis
- External AI services, cloud APIs, or network dependencies
- Medical device certification (BeatSave is a hands-free rhythm and counting aid only, not a medical diagnostic device)

## Risks and open questions
- Feel unproven on physical hardware: comfort over multi-minute CPR cycles and hand-tracking stability while wrists move rapidly over a manikin can only be verified on physical Spectacles.
- Additive display contrast: Matte Obsidian (`#141413`) dims on transparent waveguide optics, so a Muted Slate (`#6E6D68`) perimeter hairline keeps the 26 cm outer boundary legible across bright floors.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources
