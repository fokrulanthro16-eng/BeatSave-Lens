# BeatSave — Devpost Submission Draft

**Demo Video:** https://youtu.be/SLdakCRsrS8

> **Disclaimer:** BeatSave is a hands-free rhythm and counting aid only. It is not a medical diagnostic device and does not measure compression depth, chest recoil, pulse, heart rate, or breathing.

## Inspiration
During CPR, keeping a steady rate between 100 and 120 compressions per minute while counting to 30 under stress is difficult. Phone metronome apps help with tempo, but they force a rescuer to hold a screen, prop a phone awkwardly on the floor, or unlock it with wet or gloved hands. Locking a high-contrast pacing ring directly onto the floor around the rescuer's hands on Snap Spectacles keeps both rhythm and cycle count right in their downward line of sight while leaving both hands completely free.

## What it does
BeatSave locks a 26 cm pacing ring onto any flat surface (floor, mat, cushion, or training manikin) with a single pinch:

- **110 BPM CPR Rhythm (`logic proven`):** Exact `60 / 110` second (`0.5455 s`) interval centered inside the AHA 100-120 BPM guideline, paired with a smooth damped-spring inner pulse ring (19 cm diameter).
- **Hand-Clear Ergonomics (`logic proven`):** Leaves a 16 cm unobstructed center zone for stacked hands and tilts the readout (`01 / 30` + `CYCLE 1`) 35° upward just beyond the top edge of the ring so arms never obscure the digits.
- **Two AHA Pacing Modes (`logic proven`):**
  - `30:2` (Default): 30 compressions (beats 28-30 accented in Signal Coral `#E63946` and raised wooden pitch) followed by a `5.0 s` `2 BREATHS` window, then automatically advances to the next cycle.
  - `HANDS-ONLY`: Continuous 110 BPM pacing with a 30-beat visual lap counter.
- **Acoustic Cueing (`logic proven`):** Three synthesized wooden metronome and harmonic chime `.wav` clips signal standard beats (1-27), pre-breath warnings (28-30), and breath window transitions without harsh square-wave beeps.
- **Zero-Clutter Controls (`logic proven`, `feel unproven on physical SPECS`):** Single pinch locks and starts Beat 1; short pinch pauses or resumes; holding pinch for `1.2 s` unlocks the ring to reposition it; a spatial pill beside the readout toggles `30:2` vs `HANDS-ONLY`.

## How we built it
BeatSave was built natively in TypeScript inside **Lens Studio 5.23.2** using the Spectacles Base Template (`SpectaclesInteractionKit` 0.18.0) and Snap's spatial design workflow (`devpost/design-brief.md` via `plan-lens`):

- `PacingState.ts`: Pure TypeScript state machine with zero engine globals so timing intervals, breath transitions, pause/resume, and `1.2 s` hold-to-reset are unit-tested across multi-cycle runs with zero cumulative drift.
- `RingBuilder.ts`: Procedural geometry generation via Lens Studio's `MeshBuilder` (`RenderMeshVisual` + cloned `Material` passes) creating the 26 cm Matte Obsidian (`#141413`) track, Muted Slate (`#6E6D68`) perimeter hairline, 30 radial ticks spaced every 12°, and 19 cm Signal Coral (`#E63946`) pulse ring with zero per-frame memory allocations.
- `SurfaceAnchor.ts`: Uses `WorldQueryModule` raycasts and `DeviceTracking` to ease the ring flush to physical surfaces, with a floor-plane projection fallback for Lens Studio Preview.
- `BeatSaveController.ts`: Connects `GestureModule` pinches, `SpectaclesInteractionKit` `Interactable` pill triggers, `AudioComponent` playback, and the 35° angled readout, plus `TapEvent` and keyboard shortcuts (`Space`, `M`, `R`) for Desktop Preview.
- `tools/generate_audio.py`: Offline generator producing `wood_tick.wav`, `wood_tick_accent.wav`, and `breath_chime.wav` (44.1 kHz, 16-bit mono PCM).

## Challenges we ran into
- **Hand occlusion in the center:** Placing the beat counter in the middle gets covered by stacked wrists over ~16 cm, so all 30 ticks sit on the 26 cm perimeter and the readout sits 17.5 cm beyond the far rim, tilted 35° toward the rescuer.
- **Geometry winding & Preview camera framing:** Our initial upward-facing annulus triangles used back-face winding and placed the floor fallback 45° below the default level Preview camera (outside its 63.54° vertical FOV). Reversing the triangle winding, enabling two-sided rendering on `BeatSaveUnlit.mat`, and tuning the preview fallback depth brought every ring, tick, readout, and pill element into clear view.
- **Additive waveguide contrast:** On transparent Spectacles optics, pure dark colors dim rapidly. Pairing Warm Off-White (`#F4F3EE`) and Signal Coral (`#E63946`) with a crisp Muted Slate (`#6E6D68`) perimeter hairline and pill backing keeps controls legible without neon glow.
- **Tooling compatibility on Lens Studio 5.23.2:** `Leaf` 4.0.0 targets Lens Studio 5.25+, `Leaf` 3.0.0 returns HTTP 404 on package download, and `[ChatTool] LEAF Plugin` 5.23.0 throws `InternalError: Panel can not be null`. We stayed strictly on verified 5.23.2 packages (`SIK 0.18.0`), verified TypeScript compilation and runtime logs in Preview, and backed every pacing transition with automated unit tests.

## Accomplishments that we're proud of
- **Zero fake sensing claims:** BeatSave does one job honestly—world-locked visual and acoustic CPR pacing—without claiming chest depth, pulse, or breath detection.
- **Zero per-frame allocations in the ring loop:** All 30 radial ticks, ring geometry, vectors, and colors are pre-allocated on initialization with dirty-state material updates.
- **Verified multi-cycle timing:** Automated Node tests confirm zero cumulative timing drift across 150 beats (5 full cycles) in both `30:2` and `HANDS-ONLY` modes.

## What we learned
- Designing for AR glasses means anchoring instruments where the rescuer already looks—down at the floor around their hands—rather than putting panels at eye level.
- Acoustic pitch cues on beats 28, 29, and 30 let a rescuer prepare for the 5-second breath pause without reading text mid-compression.

## What's next
- User comfort, ergonomics, and hand-tracking evaluation on physical Snap Spectacles hardware during multi-minute manikin sessions.
- Tuning audio gain and surface-contrast visibility across bright indoor and outdoor training environments.
