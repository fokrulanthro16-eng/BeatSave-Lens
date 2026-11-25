import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BEAT_INTERVAL_SEC,
  BEATS_PER_CYCLE,
  BPM,
  BREATH_PAUSE_SEC,
  HOLD_RESET_SEC,
  PacingState,
} from "../Assets/Scripts/PacingState";

describe("PacingState — 110 BPM CPR rhythm engine", () => {
  it("uses exact 110 BPM interval (60 / 110 s) with zero cumulative drift across 5 cycles (150 beats)", () => {
    assert.equal(BPM, 110);
    assert.ok(Math.abs(BEAT_INTERVAL_SEC - 60 / 110) < 1e-15);

    const beatTimestamps: Array<{ cycle: number; beat: number; time: number }> = [];
    let simTime = 0;

    const engine = new PacingState({
      onBeat: (beat, _isAccent, cycle) => {
        beatTimestamps.push({ cycle, beat, time: simTime });
      },
    });

    // Test HANDS_ONLY across 150 beats (5 full 30-beat laps) at 60 Hz frame steps
    engine.setMode("HANDS_ONLY");
    engine.lockAndStart();

    const dt = 1 / 60;
    const expected150Duration = 150 * BEAT_INTERVAL_SEC;
    while (beatTimestamps.length < 150) {
      simTime += dt;
      engine.update(dt);
    }

    assert.equal(beatTimestamps.length, 150);
    const last = beatTimestamps[149];
    assert.equal(last.cycle, 5);
    assert.equal(last.beat, 30);

    // Beat 150 fires at 149 * BEAT_INTERVAL_SEC; error must remain strictly under 1 frame step (no drift)
    const expectedBeat150Time = 149 * BEAT_INTERVAL_SEC;
    assert.ok(
      Math.abs(last.time - expectedBeat150Time) <= dt + 1e-9,
      `Expected Beat 150 near ${expectedBeat150Time}s, got ${last.time}s`
    );

    // Also verify zero cumulative drift in 30:2 mode across 5 full cycles (150 beats + 4 breath pauses)
    const beatTimes302: Array<{ cycle: number; beat: number; time: number }> = [];
    let time302 = 0;
    const engine302 = new PacingState({
      onBeat: (beat, _isAccent, cycle) => {
        beatTimes302.push({ cycle, beat, time: time302 });
      },
    });
    engine302.lockAndStart();

    while (beatTimes302.length < 150) {
      time302 += dt;
      engine302.update(dt);
    }

    const cycleLen302 = BEATS_PER_CYCLE * BEAT_INTERVAL_SEC + BREATH_PAUSE_SEC;
    const expected302Last = 4 * cycleLen302 + 29 * BEAT_INTERVAL_SEC;
    const actual302Last = beatTimes302[149].time;
    assert.ok(
      Math.abs(actual302Last - expected302Last) <= dt + 1e-9,
      `Expected 30:2 Beat 150 near ${expected302Last}s, got ${actual302Last}s (total window ~${expected150Duration}s)`
    );
  });

  it("triggers accent ONLY on beats 28, 29, 30 in 30:2 mode and never in HANDS_ONLY", () => {
    const events302: Array<{ beat: number; isAccent: boolean }> = [];
    const engine302 = new PacingState({
      onBeat: (beat, isAccent) => events302.push({ beat, isAccent }),
    });

    engine302.lockAndStart();
    const dt = 0.01;
    while (events302.length < 30) {
      engine302.update(dt);
    }

    assert.equal(events302.length, 30);
    for (const ev of events302) {
      const expected = ev.beat >= 28 && ev.beat <= 30;
      assert.equal(ev.isAccent, expected, `Beat ${ev.beat} accent mismatch`);
    }

    const eventsHandsOnly: Array<{ beat: number; isAccent: boolean }> = [];
    const engineHands = new PacingState({
      onBeat: (beat, isAccent) => eventsHandsOnly.push({ beat, isAccent }),
    });
    engineHands.setMode("HANDS_ONLY");
    engineHands.lockAndStart();
    while (eventsHandsOnly.length < 30) {
      engineHands.update(dt);
    }
    assert.ok(eventsHandsOnly.every((ev) => ev.isAccent === false));
  });

  it("transitions Beat 30 -> 5.0s BREATH_PAUSE -> Cycle 2 Beat 1 cleanly in 30:2 mode", () => {
    const phases: string[] = [];
    const breathStarts: number[] = [];
    const cycleCompletes: Array<{ completed: number; next: number }> = [];
    const beats: Array<{ cycle: number; beat: number }> = [];

    const engine = new PacingState({
      onPhaseChange: (p) => phases.push(p),
      onBreathStart: (c) => breathStarts.push(c),
      onCycleComplete: (completed, next) => cycleCompletes.push({ completed, next }),
      onBeat: (beat, _accent, cycle) => beats.push({ cycle, beat }),
    });

    assert.equal(engine.getPhase(), "PLACING");
    engine.lockAndStart();
    assert.equal(engine.getPhase(), "COMPRESSIONS");
    assert.deepEqual(beats[0], { cycle: 1, beat: 1 });

    // Advance exactly 29.5 beats -> still in COMPRESSIONS on Beat 30
    engine.update(29.5 * BEAT_INTERVAL_SEC);
    assert.equal(engine.getPhase(), "COMPRESSIONS");
    assert.equal(engine.getSnapshot().beatInCycle, 30);
    assert.equal(breathStarts.length, 0);

    // Advance remaining 0.5 beat -> enters BREATH_PAUSE
    engine.update(0.5 * BEAT_INTERVAL_SEC);
    assert.equal(engine.getPhase(), "BREATH_PAUSE");
    assert.deepEqual(breathStarts, [1]);

    // Mid-breath at 2.5s
    engine.update(2.5);
    const midBreath = engine.getSnapshot();
    assert.equal(midBreath.phase, "BREATH_PAUSE");
    assert.ok(Math.abs(midBreath.breathProgress - 0.5) < 1e-9);
    assert.ok(Math.abs(midBreath.breathRemainingSec - 2.5) < 1e-9);

    // Complete remaining 2.5s -> Cycle 2 Beat 1 begins immediately
    engine.update(2.5);
    assert.equal(engine.getPhase(), "COMPRESSIONS");
    assert.deepEqual(cycleCompletes, [{ completed: 1, next: 2 }]);
    assert.deepEqual(beats[beats.length - 1], { cycle: 2, beat: 1 });
    assert.deepEqual(phases, ["COMPRESSIONS", "BREATH_PAUSE", "COMPRESSIONS"]);
  });

  it("runs continuously without breath pauses in HANDS_ONLY mode", () => {
    let breathEvents = 0;
    const cycleCompletes: number[] = [];
    const engine = new PacingState({
      onBreathStart: () => {
        breathEvents += 1;
      },
      onCycleComplete: (completed) => {
        cycleCompletes.push(completed);
      },
    });

    engine.setMode("HANDS_ONLY");
    engine.lockAndStart();

    // Advance 95 beats worth of time
    const step = 0.05;
    const totalSteps = Math.ceil((95 * BEAT_INTERVAL_SEC) / step);
    for (let i = 0; i < totalSteps; i++) {
      const snap = engine.update(step);
      assert.equal(snap.phase, "COMPRESSIONS");
    }

    assert.equal(breathEvents, 0);
    assert.deepEqual(cycleCompletes, [1, 2, 3]);
    assert.equal(engine.getSnapshot().cycle, 4);
  });

  it("supports single-pinch pause/resume and 1.2s hold-to-reset back to PLACING", () => {
    const engine = new PacingState();
    assert.equal(engine.getPhase(), "PLACING");

    // 1. First pinch locks and starts Beat 1 immediately
    engine.beginPinch();
    assert.equal(engine.getPhase(), "COMPRESSIONS");
    assert.equal(engine.getSnapshot().beatInCycle, 1);
    engine.endPinch();
    assert.equal(engine.getPhase(), "COMPRESSIONS");

    // Advance 2 beats
    engine.update(2.0 * BEAT_INTERVAL_SEC);
    assert.equal(engine.getSnapshot().beatInCycle, 3);

    // 2. Short pinch while running (< 1.2s) pauses
    engine.beginPinch();
    engine.update(0.2);
    engine.endPinch();
    assert.equal(engine.getPhase(), "PAUSED");

    const pausedBeats = engine.getSnapshot().totalBeats;
    engine.update(2.0); // Time passes while paused; beat count must freeze
    assert.equal(engine.getSnapshot().totalBeats, pausedBeats);

    // 3. Another short pinch resumes
    engine.beginPinch();
    engine.update(0.15);
    engine.endPinch();
    assert.equal(engine.getPhase(), "COMPRESSIONS");

    // 4. Holding pinch for >= 1.2s unlocks and resets to PLACING
    engine.beginPinch();
    engine.update(HOLD_RESET_SEC - 0.1);
    assert.equal(engine.getPhase(), "COMPRESSIONS");
    engine.update(0.15);
    assert.equal(engine.getPhase(), "PLACING");
    assert.equal(engine.getSnapshot().beatInCycle, 0);
    assert.equal(engine.getSnapshot().cycle, 1);
    engine.endPinch();
    assert.equal(engine.getPhase(), "PLACING");
  });

  it("produces a smooth damped spring pulseScale in [0, 1] peaking at beat onset", () => {
    const engine = new PacingState();
    engine.lockAndStart();

    const onset = engine.getSnapshot().pulseScale;
    assert.equal(onset, 1);

    const mid = engine.update(BEAT_INTERVAL_SEC * 0.25).pulseScale;
    const late = engine.update(BEAT_INTERVAL_SEC * 0.5).pulseScale;
    assert.ok(mid > late && late >= 0 && mid < 1);
  });
});
