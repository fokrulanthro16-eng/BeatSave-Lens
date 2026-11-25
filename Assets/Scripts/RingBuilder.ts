import { BEATS_PER_CYCLE, PacingSnapshot } from "./PacingState";

/**
 * Strict hardware-inspired 4-color palette (hex -> linear/sRGB normalized vec4).
 */
export const BEATSAVE_COLORS = {
  MATTE_OBSIDIAN_HEX: "#141413",
  WARM_OFF_WHITE_HEX: "#F4F3EE",
  SIGNAL_CORAL_HEX: "#E63946",
  MUTED_SLATE_HEX: "#6E6D68",
} as const;

export const RING_DIMENSIONS_CM = {
  OUTER_DIAMETER_CM: 26.0,
  OUTER_RADIUS_CM: 13.0,
  OUTER_INNER_RADIUS_CM: 12.15,
  HAIRLINE_OUTER_CM: 13.18,
  PULSE_DIAMETER_CM: 19.0,
  PULSE_OUTER_RADIUS_CM: 9.5,
  PULSE_INNER_RADIUS_CM: 9.0,
  CLEAR_HAND_ZONE_CM: 16.0,
  TICK_INNER_RADIUS_CM: 10.65,
  TICK_OUTER_RADIUS_CM: 11.85,
  TICK_WIDTH_CM: 0.34,
} as const;

enum TickVisualState {
  INACTIVE = 0,
  LIT = 1,
  ACCENT = 2,
}

/**
 * Procedurally builds the 26 cm Matte Obsidian outer ring, Muted Slate hairline rim,
 * 30 radial tick marks (12 deg spacing), and 19 cm Signal Coral pulsing ring via MeshBuilder.
 * Zero memory allocations happen inside update().
 */
export class RingBuilder {
  private readonly rootObject: SceneObject;
  private readonly baseMaterial: Material;

  private pulseRingTransform: Transform | null = null;
  private pulseRingPass: Pass | null = null;
  private readonly tickPasses: Pass[] = [];
  private readonly tickStates: TickVisualState[] = [];

  // Pre-allocated colors and scale vector to eliminate per-frame GC pressure
  private readonly colorObsidian = new vec4(20 / 255, 20 / 255, 19 / 255, 1.0);
  private readonly colorOffWhite = new vec4(244 / 255, 243 / 255, 238 / 255, 1.0);
  private readonly colorCoral = new vec4(230 / 255, 57 / 255, 70 / 255, 1.0);
  private readonly colorSlate = new vec4(110 / 255, 109 / 255, 104 / 255, 1.0);
  private readonly pulseScaleVec = new vec3(1.0, 1.0, 1.0);

  private isBuilt = false;

  constructor(parentObject: SceneObject, baseUnlitMaterial: Material) {
    this.rootObject = global.scene.createSceneObject("BeatSaveRingRig");
    this.rootObject.setParent(parentObject);
    this.baseMaterial = baseUnlitMaterial;
  }

  public build(): void {
    if (this.isBuilt) {
      return;
    }

    // 1. 26 cm Outer Base Track (Matte Obsidian #141413)
    this.createRingMeshObject(
      "OuterBaseTrack_26cm",
      RING_DIMENSIONS_CM.OUTER_INNER_RADIUS_CM,
      RING_DIMENSIONS_CM.OUTER_RADIUS_CM,
      0.0,
      72,
      this.colorObsidian
    );

    // 2. Crisp perimeter rim (Muted Slate #6E6D68) so the 26 cm boundary reads cleanly on additive optics
    this.createRingMeshObject(
      "OuterPerimeterHairline",
      RING_DIMENSIONS_CM.OUTER_RADIUS_CM,
      RING_DIMENSIONS_CM.HAIRLINE_OUTER_CM,
      0.02,
      72,
      this.colorSlate
    );

    // 3. 19 cm Inner Rhythm Pulse Ring (Signal Coral #E63946)
    const pulseObj = this.createRingMeshObject(
      "InnerPulseRing_19cm",
      RING_DIMENSIONS_CM.PULSE_INNER_RADIUS_CM,
      RING_DIMENSIONS_CM.PULSE_OUTER_RADIUS_CM,
      0.05,
      64,
      this.colorCoral
    );
    this.pulseRingTransform = pulseObj.getTransform();
    const pulseVisual = pulseObj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual | null;
    this.pulseRingPass = pulseVisual ? pulseVisual.mainPass : null;

    // 4. 30 Procedural Radial Tick Marks (every 12 degrees) sharing one RenderMesh
    const sharedTickMesh = this.buildTickMesh(
      RING_DIMENSIONS_CM.TICK_INNER_RADIUS_CM,
      RING_DIMENSIONS_CM.TICK_OUTER_RADIUS_CM,
      RING_DIMENSIONS_CM.TICK_WIDTH_CM
    );

    const degToRad = Math.PI / 180;
    for (let i = 0; i < BEATS_PER_CYCLE; i++) {
      const tickObj = global.scene.createSceneObject(`RadialTick_${i + 1}`);
      tickObj.setParent(this.rootObject);

      const angleRad = -i * 12 * degToRad;
      const t = tickObj.getTransform();
      t.setLocalPosition(new vec3(0, 0.04, 0));
      t.setLocalRotation(quat.fromEulerAngles(0, angleRad, 0));

      const visual = tickObj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
      visual.mesh = sharedTickMesh;
      const mat = this.baseMaterial.clone();
      mat.mainPass.twoSided = true;
      mat.mainPass.baseColor = this.colorSlate;
      visual.mainMaterial = mat;

      const pass = visual.mainPass;
      pass.twoSided = true;
      pass.baseColor = this.colorSlate;

      this.tickPasses.push(pass);
      this.tickStates.push(TickVisualState.INACTIVE);
    }

    this.isBuilt = true;
  }

  public update(snapshot: PacingSnapshot): void {
    if (!this.isBuilt) {
      return;
    }

    // Update inner 19 cm Signal Coral pulse ring smoothly inside [0.86..1.0] (never intrudes on 16 cm hand zone)
    if (this.pulseRingTransform) {
      const targetScale =
        snapshot.phase === "BREATH_PAUSE"
          ? 0.86 + 0.06 * Math.sin(snapshot.breathProgress * Math.PI)
          : 0.86 + 0.14 * snapshot.pulseScale;
      this.pulseScaleVec.x = targetScale;
      this.pulseScaleVec.y = 1.0;
      this.pulseScaleVec.z = targetScale;
      this.pulseRingTransform.setLocalScale(this.pulseScaleVec);
    }

    if (this.pulseRingPass) {
      this.pulseRingPass.baseColor =
        snapshot.phase === "PAUSED" ? this.colorSlate : this.colorCoral;
    }

    // Update 30 radial tick marks with zero allocations and dirty-state guarding
    if (snapshot.phase === "PLACING") {
      for (let i = 0; i < BEATS_PER_CYCLE; i++) {
        this.setTickState(i, TickVisualState.INACTIVE);
      }
      return;
    }

    if (snapshot.phase === "BREATH_PAUSE") {
      const remainingTicks = Math.max(
        0,
        Math.ceil((1.0 - snapshot.breathProgress) * BEATS_PER_CYCLE)
      );
      for (let i = 0; i < BEATS_PER_CYCLE; i++) {
        this.setTickState(i, i < remainingTicks ? TickVisualState.ACCENT : TickVisualState.INACTIVE);
      }
      return;
    }

    const activeCount = snapshot.beatInCycle;
    const is30to2 = snapshot.mode === "30:2";
    for (let i = 0; i < BEATS_PER_CYCLE; i++) {
      const beatNumber = i + 1;
      if (beatNumber <= activeCount) {
        const isWarnTick = is30to2 && beatNumber >= 28;
        this.setTickState(i, isWarnTick ? TickVisualState.ACCENT : TickVisualState.LIT);
      } else {
        this.setTickState(i, TickVisualState.INACTIVE);
      }
    }
  }

  private setTickState(index: number, nextState: TickVisualState): void {
    if (this.tickStates[index] === nextState) {
      return;
    }
    this.tickStates[index] = nextState;
    const pass = this.tickPasses[index];
    if (nextState === TickVisualState.ACCENT) {
      pass.baseColor = this.colorCoral;
    } else if (nextState === TickVisualState.LIT) {
      pass.baseColor = this.colorOffWhite;
    } else {
      pass.baseColor = this.colorSlate;
    }
  }

  private createRingMeshObject(
    name: string,
    innerRadius: number,
    outerRadius: number,
    yOffset: number,
    segments: number,
    color: vec4
  ): SceneObject {
    const obj = global.scene.createSceneObject(name);
    obj.setParent(this.rootObject);
    obj.getTransform().setLocalPosition(new vec3(0, yOffset, 0));

    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual;
    visual.mesh = this.buildAnnulusMesh(innerRadius, outerRadius, segments);
    const mat = this.baseMaterial.clone();
    mat.mainPass.twoSided = true;
    mat.mainPass.baseColor = color;
    visual.mainMaterial = mat;
    visual.mainPass.twoSided = true;
    visual.mainPass.baseColor = color;

    return obj;
  }

  private buildAnnulusMesh(innerRadius: number, outerRadius: number, segments: number): RenderMesh {
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;

    const vertices: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      const theta = u * Math.PI * 2.0;
      const sinT = Math.sin(theta);
      const cosT = -Math.cos(theta); // 0 rad starts at 12 o'clock (-Z)

      // Inner vertex
      vertices.push(innerRadius * sinT, 0, innerRadius * cosT, 0, 1, 0, u, 0);
      // Outer vertex
      vertices.push(outerRadius * sinT, 0, outerRadius * cosT, 0, 1, 0, u, 1);
    }

    for (let i = 0; i < segments; i++) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
    }

    builder.appendVerticesInterleaved(vertices);
    builder.appendIndices(indices);
    if (builder.isValid()) {
      const mesh = builder.getMesh();
      builder.updateMesh();
      return mesh;
    }
    print("BeatSave RingBuilder: Invalid annulus MeshBuilder data.");
    return builder.getMesh();
  }

  private buildTickMesh(innerRadius: number, outerRadius: number, width: number): RenderMesh {
    const builder = new MeshBuilder([
      { name: "position", components: 3 },
      { name: "normal", components: 3 },
      { name: "texture0", components: 2 },
    ]);
    builder.topology = MeshTopology.Triangles;
    builder.indexType = MeshIndexType.UInt16;

    const hw = width * 0.5;
    // Aligned along -Z (12 o'clock) in local XZ plane
    builder.appendVerticesInterleaved([
      -hw, 0, -outerRadius, 0, 1, 0, 0, 1,
      -hw, 0, -innerRadius, 0, 1, 0, 0, 0,
      hw, 0, -innerRadius, 0, 1, 0, 1, 0,
      hw, 0, -outerRadius, 0, 1, 0, 1, 1,
    ]);
    builder.appendIndices([0, 1, 2, 2, 3, 0]);

    if (builder.isValid()) {
      const mesh = builder.getMesh();
      builder.updateMesh();
      return mesh;
    }
    print("BeatSave RingBuilder: Invalid tick MeshBuilder data.");
    return builder.getMesh();
  }
}
