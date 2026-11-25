export type PacingPhase = "PLACING" | "COMPRESSIONS" | "BREATH_PAUSE" | "PAUSED";
export type PacingMode = "30:2" | "HANDS_ONLY";

export const BPM = 110;
export const BEAT_INTERVAL_SEC = 60 / BPM;
export const BEATS_PER_CYCLE = 30;
export const ACCENT_START_BEAT = 28;
export const BREATH_PAUSE_SEC = 5.0;
export const HOLD_RESET_SEC = 1.2;

export interface PacingCallbacks {
  onBeat?: (beatInCycle: number, isAccent: boolean, cycle: number) => void;
  onBreathStart?: (cycle: number) => void;
  onCycleComplete?: (completedCycle: number, nextCycle: number) => void;
  onPhaseChange?: (phase: PacingPhase) => void;
  onModeChange?: (mode: PacingMode) => void;
}

export interface PacingSnapshot {
  phase: PacingPhase;
  mode: PacingMode;
  cycle: number;
  beatInCycle: number;
  totalBeats: number;
  pulseScale: number;
  breathProgress: number;
  breathRemainingSec: number;
  isAccentBeat: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Pure TypeScript 110 BPM CPR pacing state machine with drift-free delta accumulation.
 * Zero Lens Studio globals so it can be unit-tested directly under Node.js.
 */
export class PacingState {
  private phase: PacingPhase = "PLACING";
  private pausedFromPhase: "COMPRESSIONS" | "BREATH_PAUSE" = "COMPRESSIONS";
  private mode: PacingMode = "30:2";

  private cycle = 1;
  private beatInCycle = 0;
  private totalBeats = 0;

  private cycleElapsedSec = 0;
  private breathElapsedSec = 0;

  private isPinchHeld = false;
  private pinchHoldSec = 0;
  private holdResetTriggered = false;
  private ignoreHoldUntilRelease = false;

  private readonly callbacks: PacingCallbacks;

  constructor(callbacks: PacingCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public getPhase(): PacingPhase {
    return this.phase;
  }

  public getMode(): PacingMode {
    return this.mode;
  }

  public setMode(mode: PacingMode): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    if (mode === "HANDS_ONLY" && this.phase === "BREATH_PAUSE") {
      this.enterNextCycleFromBreath(0);
    } else if (mode === "HANDS_ONLY" && this.phase === "PAUSED" && this.pausedFromPhase === "BREATH_PAUSE") {
      this.pausedFromPhase = "COMPRESSIONS";
      this.cycle += 1;
      this.beatInCycle = 1;
      this.cycleElapsedSec = 0;
      this.breathElapsedSec = 0;
    }
    this.callbacks.onModeChange?.(this.mode);
  }

  public toggleMode(): PacingMode {
    this.setMode(this.mode === "30:2" ? "HANDS_ONLY" : "30:2");
    return this.mode;
  }

  /**
   * Locks placement and immediately fires Beat 1 for 1-pinch time-to-action.
   */
  public lockAndStart(): void {
    this.cycle = 1;
    this.beatInCycle = 0;
    this.totalBeats = 0;
    this.cycleElapsedSec = 0;
    this.breathElapsedSec = 0;
    this.setPhase("COMPRESSIONS");
    this.emitBeat(1);
  }

  public pause(): void {
    if (this.phase === "COMPRESSIONS" || this.phase === "BREATH_PAUSE") {
      this.pausedFromPhase = this.phase;
      this.setPhase("PAUSED");
    }
  }

  public resume(): void {
    if (this.phase === "PAUSED") {
      this.setPhase(this.pausedFromPhase);
    }
  }

  public togglePause(): void {
    if (this.phase === "PAUSED") {
      this.resume();
    } else if (this.phase === "COMPRESSIONS" || this.phase === "BREATH_PAUSE") {
      this.pause();
    }
  }

  public resetToPlacing(): void {
    this.cycle = 1;
    this.beatInCycle = 0;
    this.totalBeats = 0;
    this.cycleElapsedSec = 0;
    this.breathElapsedSec = 0;
    this.pausedFromPhase = "COMPRESSIONS";
    this.setPhase("PLACING");
  }

  public beginPinch(): void {
    this.isPinchHeld = true;
    this.pinchHoldSec = 0;
    this.holdResetTriggered = false;

    if (this.phase === "PLACING") {
      this.ignoreHoldUntilRelease = true;
      this.lockAndStart();
    } else {
      this.ignoreHoldUntilRelease = false;
    }
  }

  public endPinch(): void {
    if (!this.isPinchHeld) {
      return;
    }
    this.isPinchHeld = false;

    if (this.ignoreHoldUntilRelease || this.holdResetTriggered) {
      this.ignoreHoldUntilRelease = false;
      this.holdResetTriggered = false;
      return;
    }

    this.togglePause();
  }

  public update(rawDeltaSec: number): PacingSnapshot {
    const dt = rawDeltaSec > 0 ? rawDeltaSec : 0;

    if (this.isPinchHeld && !this.ignoreHoldUntilRelease && !this.holdResetTriggered) {
      this.pinchHoldSec += dt;
      if (this.phase !== "PLACING" && this.pinchHoldSec >= HOLD_RESET_SEC) {
        this.holdResetTriggered = true;
        this.ignoreHoldUntilRelease = true;
        this.resetToPlacing();
        return this.getSnapshot();
      }
    }

    if (this.phase === "COMPRESSIONS") {
      this.advanceCompressions(dt);
    } else if (this.phase === "BREATH_PAUSE") {
      this.advanceBreathPause(dt);
    }

    return this.getSnapshot();
  }

  public getSnapshot(): PacingSnapshot {
    let pulseScale = 0;
    let breathProgress = 0;
    let breathRemainingSec = 0;

    if (this.phase === "COMPRESSIONS" && this.beatInCycle > 0) {
      const beatStartSec = (this.beatInCycle - 1) * BEAT_INTERVAL_SEC;
      const beatPhase = clamp((this.cycleElapsedSec - beatStartSec) / BEAT_INTERVAL_SEC, 0, 1);
      // Natural damped-spring curve starting at 1.0 on the beat and settling smoothly to 0.0
      pulseScale = clamp(Math.exp(-4.8 * beatPhase) * (1 - beatPhase * beatPhase), 0, 1);
    } else if (this.phase === "BREATH_PAUSE") {
      breathProgress = clamp(this.breathElapsedSec / BREATH_PAUSE_SEC, 0, 1);
      breathRemainingSec = Math.max(0, BREATH_PAUSE_SEC - this.breathElapsedSec);
    } else if (this.phase === "PAUSED" && this.pausedFromPhase === "BREATH_PAUSE") {
      breathProgress = clamp(this.breathElapsedSec / BREATH_PAUSE_SEC, 0, 1);
      breathRemainingSec = Math.max(0, BREATH_PAUSE_SEC - this.breathElapsedSec);
    }

    return {
      phase: this.phase,
      mode: this.mode,
      cycle: this.cycle,
      beatInCycle: this.beatInCycle,
      totalBeats: this.totalBeats,
      pulseScale,
      breathProgress,
      breathRemainingSec,
      isAccentBeat: this.isAccentBeat(this.beatInCycle),
    };
  }

  private advanceCompressions(dt: number): void {
    this.cycleElapsedSec += dt;
    const cycleCompressionDuration = BEATS_PER_CYCLE * BEAT_INTERVAL_SEC;

    while (this.phase === "COMPRESSIONS") {
      const nextBeatIndex = this.beatInCycle + 1;
      const nextBeatTime = (nextBeatIndex - 1) * BEAT_INTERVAL_SEC;

      if (nextBeatIndex <= BEATS_PER_CYCLE) {
        if (this.cycleElapsedSec + 1e-12 >= nextBeatTime) {
          this.emitBeat(nextBeatIndex);
          continue;
        }
        break;
      }

      if (this.cycleElapsedSec + 1e-12 >= cycleCompressionDuration) {
        const overshoot = Math.max(0, this.cycleElapsedSec - cycleCompressionDuration);
        if (this.mode === "30:2") {
          this.breathElapsedSec = overshoot;
          this.setPhase("BREATH_PAUSE");
          this.callbacks.onBreathStart?.(this.cycle);
          if (this.breathElapsedSec + 1e-12 >= BREATH_PAUSE_SEC) {
            this.advanceBreathPause(0);
          }
          break;
        } else {
          const completed = this.cycle;
          this.cycle += 1;
          this.cycleElapsedSec = overshoot;
          this.beatInCycle = 0;
          this.callbacks.onCycleComplete?.(completed, this.cycle);
          this.emitBeat(1);
          continue;
        }
      }

      break;
    }
  }

  private advanceBreathPause(dt: number): void {
    this.breathElapsedSec += dt;
    if (this.breathElapsedSec + 1e-12 >= BREATH_PAUSE_SEC) {
      const overshoot = Math.max(0, this.breathElapsedSec - BREATH_PAUSE_SEC);
      this.enterNextCycleFromBreath(overshoot);
      if (overshoot > 0) {
        this.advanceCompressions(0);
      }
    }
  }

  private enterNextCycleFromBreath(overshootSec: number): void {
    const completed = this.cycle;
    this.cycle += 1;
    this.breathElapsedSec = 0;
    this.cycleElapsedSec = overshootSec;
    this.beatInCycle = 0;
    this.setPhase("COMPRESSIONS");
    this.callbacks.onCycleComplete?.(completed, this.cycle);
    this.emitBeat(1);
  }

  private emitBeat(beatIndex: number): void {
    this.beatInCycle = beatIndex;
    this.totalBeats += 1;
    this.callbacks.onBeat?.(beatIndex, this.isAccentBeat(beatIndex), this.cycle);
  }

  private isAccentBeat(beatIndex: number): boolean {
    return this.mode === "30:2" && beatIndex >= ACCENT_START_BEAT && beatIndex <= BEATS_PER_CYCLE;
  }

  private setPhase(nextPhase: PacingPhase): void {
    if (this.phase !== nextPhase) {
      this.phase = nextPhase;
      this.callbacks.onPhaseChange?.(nextPhase);
    }
  }
}
