import { Interactable } from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable";
import { PacingMode, PacingPhase, PacingSnapshot, PacingState } from "./PacingState";
import { RingBuilder } from "./RingBuilder";
import { SurfaceAnchor } from "./SurfaceAnchor";

const DEG_TO_RAD = Math.PI / 180;
const READOUT_DISTANCE_Z_CM = -17.5;
const READOUT_HEIGHT_Y_CM = 4.5;
const READOUT_TILT_DEG = 35.0;
const MODE_PILL_OFFSET_X_CM = 22.5;

/**
 * Main Lens Studio 5.23.2 BaseScriptComponent entry point for BeatSave.
 * Wires world surface anchoring, procedural 26 cm CPR pacing ring,
 * 35-degree angled readout, spatial mode pill, acoustic ticks, and pinch controls.
 */
@component
export class BeatSaveController extends BaseScriptComponent {
  @input
  @hint("Scene Camera used for surface raycasting and floor-plane fallback")
  camera!: Camera;

  @input
  @allowUndefined
  @hint("Optional DeviceTracking component for World tracking mode")
  deviceTracking?: DeviceTracking;

  @input
  @hint("Unlit base material used for procedural ticks and rings")
  baseUnlitMaterial!: Material;

  @input
  @hint("45 ms damped wooden tick audio track (Assets/Audio/wood_tick.wav)")
  woodTickAudio!: AudioTrackAsset;

  @input
  @hint("55 ms accented wooden tick audio track (Assets/Audio/wood_tick_accent.wav)")
  woodTickAccentAudio!: AudioTrackAsset;

  @input
  @hint("420 ms harmonic two-note breath chime (Assets/Audio/breath_chime.wav)")
  breathChimeAudio!: AudioTrackAsset;

  @input
  @allowUndefined
  @hint("Optional pre-placed Text3D for primary beat/countdown readout")
  readoutText?: Text3D;

  @input
  @allowUndefined
  @hint("Optional pre-placed Text3D for cycle/mode sub-label")
  cycleLabelText?: Text3D;

  @input
  @allowUndefined
  @hint("Optional SIK Interactable SceneObject for the 30:2 / HANDS-ONLY spatial pill")
  modePillObject?: SceneObject;

  private anchorRoot!: SceneObject;
  private surfaceAnchor!: SurfaceAnchor;
  private ringBuilder: RingBuilder | null = null;
  private pacing!: PacingState;

  private tickAudioComp: AudioComponent | null = null;
  private accentAudioComp: AudioComponent | null = null;
  private chimeAudioComp: AudioComponent | null = null;

  private primaryTextComp: Text3D | Text | null = null;
  private secondaryTextComp: Text3D | Text | null = null;
  private modePillTextComp: Text3D | Text | null = null;

  private lastPrimaryStr = "";
  private lastSecondaryStr = "";
  private lastPillStr = "";
  private suppressNextGlobalTap = false;

  onAwake(): void {
    this.anchorRoot = global.scene.createSceneObject("BeatSaveWorldAnchor");

    this.pacing = new PacingState({
      onBeat: (_beat, isAccent) => {
        if (isAccent) {
          this.accentAudioComp?.play(1);
        } else {
          this.tickAudioComp?.play(1);
        }
      },
      onBreathStart: () => {
        this.chimeAudioComp?.play(1);
      },
      onCycleComplete: (_completed, _next) => {
        if (this.pacing.getMode() === "30:2") {
          this.chimeAudioComp?.play(1);
        }
      },
      onPhaseChange: (phase: PacingPhase) => {
        print(`[BeatSave] Phase -> ${phase}`);
        if (phase === "PLACING") {
          this.surfaceAnchor?.unlock();
        } else {
          this.surfaceAnchor?.lock();
        }
      },
      onModeChange: (mode: PacingMode) => {
        print(`[BeatSave] Mode -> ${mode}`);
        this.updateModePillLabel(mode);
      },
    });

    this.surfaceAnchor = new SurfaceAnchor(
      this.anchorRoot,
      this.camera || null,
      this.deviceTracking || null
    );

    if (this.baseUnlitMaterial) {
      this.ringBuilder = new RingBuilder(this.anchorRoot, this.baseUnlitMaterial);
      this.ringBuilder.build();
    } else {
      print("BeatSaveController: Assign an Unlit Material to baseUnlitMaterial in the Inspector.");
    }

    this.setupAudioComponents();
    this.setupAngledReadout();
    this.setupModePill();
    this.bindInputs();

    this.createEvent("UpdateEvent").bind(() => {
      this.onUpdate();
    });

    this.refreshReadout(this.pacing.getSnapshot());
    this.updateModePillLabel(this.pacing.getMode());
    print(`[BeatSave] Initialized 110 BPM pacing controller (mode=${this.pacing.getMode()})`);
  }

  onDestroy(): void {
    this.surfaceAnchor?.destroy();
  }

  /**
   * Public helpers for LEAF interaction scenarios and scene verification.
   */
  public getPacingSnapshot(): PacingSnapshot {
    return this.pacing.getSnapshot();
  }

  public triggerPrimaryPinch(): void {
    if (this.pacing.getPhase() === "PLACING") {
      this.pacing.lockAndStart();
    } else {
      this.pacing.togglePause();
    }
    this.refreshReadout(this.pacing.getSnapshot());
  }

  public triggerModeToggle(): void {
    this.pacing.toggleMode();
    this.refreshReadout(this.pacing.getSnapshot());
  }

  public triggerResetToPlacing(): void {
    this.pacing.resetToPlacing();
    this.refreshReadout(this.pacing.getSnapshot());
  }

  private onUpdate(): void {
    const dt = getDeltaTime();
    this.surfaceAnchor.update(dt);
    const snapshot = this.pacing.update(dt);
    this.ringBuilder?.update(snapshot);
    this.refreshReadout(snapshot);
  }

  private setupAudioComponents(): void {
    if (this.woodTickAudio) {
      this.tickAudioComp = this.createAudioChild("Audio_WoodTick", this.woodTickAudio);
    }
    if (this.woodTickAccentAudio) {
      this.accentAudioComp = this.createAudioChild("Audio_WoodTickAccent", this.woodTickAccentAudio);
    }
    if (this.breathChimeAudio) {
      this.chimeAudioComp = this.createAudioChild("Audio_BreathChime", this.breathChimeAudio);
    }
  }

  private createAudioChild(name: string, track: AudioTrackAsset): AudioComponent {
    const obj = global.scene.createSceneObject(name);
    obj.setParent(this.anchorRoot);
    const comp = obj.createComponent("Component.AudioComponent") as AudioComponent;
    comp.audioTrack = track;
    comp.volume = 1.0;
    return comp;
  }

  private setupAngledReadout(): void {
    const readoutRoot = global.scene.createSceneObject("AngledReadoutPanel");
    readoutRoot.setParent(this.anchorRoot);
    const t = readoutRoot.getTransform();
    t.setLocalPosition(new vec3(0, READOUT_HEIGHT_Y_CM, READOUT_DISTANCE_Z_CM));
    // Tilt +Z face upward 35 degrees toward the kneeling rescuer
    t.setLocalRotation(quat.fromEulerAngles(-READOUT_TILT_DEG * DEG_TO_RAD, 0, 0));

    if (this.readoutText) {
      this.readoutText.getSceneObject().setParent(readoutRoot);
      this.primaryTextComp = this.readoutText;
    } else {
      const primaryObj = global.scene.createSceneObject("PrimaryReadoutText");
      primaryObj.setParent(readoutRoot);
      primaryObj.getTransform().setLocalPosition(new vec3(0, 1.8, 0));
      const textComp = primaryObj.createComponent("Component.Text") as Text;
      textComp.size = 135;
      textComp.depthTest = true;
      textComp.textFill.color = new vec4(244 / 255, 243 / 255, 238 / 255, 1.0);
      this.primaryTextComp = textComp;
    }

    if (this.cycleLabelText) {
      this.cycleLabelText.getSceneObject().setParent(readoutRoot);
      this.secondaryTextComp = this.cycleLabelText;
    } else {
      const secObj = global.scene.createSceneObject("CycleLabelText");
      secObj.setParent(readoutRoot);
      secObj.getTransform().setLocalPosition(new vec3(0, -1.9, 0));
      const textComp = secObj.createComponent("Component.Text") as Text;
      textComp.size = 82;
      textComp.depthTest = true;
      textComp.textFill.color = new vec4(244 / 255, 243 / 255, 238 / 255, 1.0);
      this.secondaryTextComp = textComp;
    }
  }

  private setupModePill(): void {
    const pillRoot = this.modePillObject || global.scene.createSceneObject("ModeTogglePill");
    pillRoot.setParent(this.anchorRoot);
    const t = pillRoot.getTransform();
    t.setLocalPosition(new vec3(MODE_PILL_OFFSET_X_CM, READOUT_HEIGHT_Y_CM - 0.6, READOUT_DISTANCE_Z_CM));
    t.setLocalRotation(quat.fromEulerAngles(-READOUT_TILT_DEG * DEG_TO_RAD, 0, 0));

    if (this.baseUnlitMaterial && !pillRoot.getComponent("Component.RenderMeshVisual")) {
      this.createPillBacking(pillRoot, this.baseUnlitMaterial);
    }

    let labelComp = pillRoot.getComponent("Component.Text") as Text | null;
    if (!labelComp) {
      const labelObj = global.scene.createSceneObject("ModePillLabel");
      labelObj.setParent(pillRoot);
      labelObj.getTransform().setLocalPosition(new vec3(0, 0, 0.08));
      labelComp = labelObj.createComponent("Component.Text") as Text;
      labelComp.size = 60;
      labelComp.depthTest = true;
      labelComp.textFill.color = new vec4(244 / 255, 243 / 255, 238 / 255, 1.0);
    }
    this.modePillTextComp = labelComp;

    try {
      const interactable = pillRoot.getComponent(Interactable.getTypeName()) as Interactable | null;
      if (interactable) {
        interactable.onTriggerStart.add(() => {
          this.suppressNextGlobalTap = true;
          this.triggerModeToggle();
        });
      }
    } catch (_err) {
      // SIK Interactable optional when running keyboard/tap fallback in Preview.
    }
  }

  private createPillBacking(pillRoot: SceneObject, baseMaterial: Material): void {
    const plateObj = global.scene.createSceneObject("ModePillBacking");
    plateObj.setParent(pillRoot);
    const hw = 9.0;
    const hh = 1.75;
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;
    builder.appendVerticesInterleaved([
      -hw, -hh, 0, 0, 0, 1, 0, 0,
      hw, -hh, 0, 0, 0, 1, 1, 0,
      hw, hh, 0, 0, 0, 1, 1, 1,
      -hw, hh, 0, 0, 0, 1, 0, 1,
    ]);
    builder.appendIndices([0, 1, 2, 2, 3, 0]);
    if (!builder.isValid()) {
      return;
    }
    const mesh = builder.getMesh();
    builder.updateMesh();

    const visual = plateObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = mesh;
    const mat = baseMaterial.clone();
    mat.mainPass.twoSided = true;
    // Muted Slate subtle pill backing so the spatial control stays clear on additive optics
    mat.mainPass.baseColor = new vec4(110 / 255, 109 / 255, 104 / 255, 1.0);
    visual.mainMaterial = mat;
    visual.mainPass.twoSided = true;
    visual.mainPass.baseColor = new vec4(110 / 255, 109 / 255, 104 / 255, 1.0);
  }

  private bindInputs(): void {
    // 1. Native Spectacles hand pinch gestures (Left and Right hands)
    try {
      const gestureModule = require("LensStudio:GestureModule");
      if (gestureModule) {
        const hands = [GestureModule.HandType.Right, GestureModule.HandType.Left];
        for (const hand of hands) {
          gestureModule.getPinchDownEvent(hand).add(() => {
            if (this.suppressNextGlobalTap) {
              this.suppressNextGlobalTap = false;
              return;
            }
            this.pacing.beginPinch();
          });
          gestureModule.getPinchUpEvent(hand).add(() => {
            this.pacing.endPinch();
          });
        }
      }
    } catch (_err) {
      // GestureModule unavailable in non-hand preview; TapEvent and KeyPressEvent handle testing.
    }

    // 2. Lens Studio Preview tap fallback
    const tapEvent = this.createEvent("TapEvent");
    tapEvent.bind(() => {
      if (this.suppressNextGlobalTap) {
        this.suppressNextGlobalTap = false;
        return;
      }
      this.triggerPrimaryPinch();
    });

    // 3. Lens Studio Preview keyboard shortcuts (Space: lock/pause, M: mode toggle, R: unlock/reset)
    const keyEvent = this.createEvent("KeyPressEvent");
    keyEvent.bind((eventData: KeyPressEvent) => {
      if (eventData.key === Keys.Space) {
        this.triggerPrimaryPinch();
      } else if (eventData.key === Keys.M) {
        this.triggerModeToggle();
      } else if (eventData.key === Keys.R) {
        this.triggerResetToPlacing();
      }
    });
  }

  private refreshReadout(snapshot: PacingSnapshot): void {
    let primary = "";
    let secondary = "";

    if (snapshot.phase === "PLACING") {
      primary = "PINCH TO LOCK";
      secondary = snapshot.mode === "30:2" ? "110 BPM  ·  30:2" : "110 BPM  ·  HANDS-ONLY";
    } else if (snapshot.phase === "BREATH_PAUSE") {
      primary = "2 BREATHS";
      secondary = `${snapshot.breathRemainingSec.toFixed(1)}s`;
    } else if (snapshot.phase === "PAUSED") {
      primary = "PAUSED";
      secondary = "PINCH TO RESUME";
    } else {
      const beatStr = snapshot.beatInCycle < 10 ? `0${snapshot.beatInCycle}` : `${snapshot.beatInCycle}`;
      primary = `${beatStr} / 30`;
      secondary =
        snapshot.mode === "30:2"
          ? `CYCLE ${snapshot.cycle}`
          : `HANDS-ONLY  ·  LAP ${snapshot.cycle}`;
    }

    if (this.primaryTextComp && primary !== this.lastPrimaryStr) {
      this.primaryTextComp.text = primary;
      this.lastPrimaryStr = primary;
    }
    if (this.secondaryTextComp && secondary !== this.lastSecondaryStr) {
      this.secondaryTextComp.text = secondary;
      this.lastSecondaryStr = secondary;
    }
  }

  private updateModePillLabel(mode: PacingMode): void {
    const label = mode === "30:2" ? "MODE: 30:2" : "MODE: HANDS-ONLY";
    if (this.modePillTextComp && label !== this.lastPillStr) {
      this.modePillTextComp.text = label;
      this.lastPillStr = label;
    }
  }
}
