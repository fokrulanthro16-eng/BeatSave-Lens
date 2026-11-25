const FLOOR_FALLBACK_DROP_CM = 22.0;
const FLOOR_FALLBACK_FORWARD_CM = 105.0;
const RAY_LENGTH_CM = 400.0;
const SMOOTH_SPEED = 14.0;

/**
 * Anchors the BeatSave instrument onto a physical flat surface (floor, cushion, or manikin)
 * using Spectacles WorldQueryModule hit-testing, with a smooth floor-plane fallback in Preview.
 */
export class SurfaceAnchor {
  private readonly anchorRoot: SceneObject;
  private readonly camera: Camera | null;
  private readonly deviceTracking: DeviceTracking | null;

  private hitTestSession: HitTestSession | null = null;
  private isLocked = false;
  private hasTarget = false;

  private currentPos = new vec3(0, -FLOOR_FALLBACK_DROP_CM, -FLOOR_FALLBACK_FORWARD_CM);
  private targetPos = new vec3(0, -FLOOR_FALLBACK_DROP_CM, -FLOOR_FALLBACK_FORWARD_CM);
  private currentRot = quat.quatIdentity();
  private targetRot = quat.quatIdentity();

  constructor(
    anchorRoot: SceneObject,
    camera: Camera | null,
    deviceTracking: DeviceTracking | null
  ) {
    this.anchorRoot = anchorRoot;
    this.camera = camera;
    this.deviceTracking = deviceTracking;
    this.initTracking();
  }

  public getIsLocked(): boolean {
    return this.isLocked;
  }

  public lock(): void {
    this.isLocked = true;
    this.stopHitTest();
  }

  public unlock(): void {
    this.isLocked = false;
    this.startHitTest();
  }

  public update(dt: number): void {
    if (this.isLocked) {
      return;
    }

    const camTransform = this.camera ? this.camera.getSceneObject().getTransform() : null;
    if (camTransform) {
      if (this.hitTestSession) {
        const rayStart = camTransform.getWorldPosition();
        // Lens Studio camera looks along -Z (opposite of Transform.forward)
        const lookDir = camTransform.forward.uniformScale(-1.0);
        const rayEnd = rayStart.add(lookDir.uniformScale(RAY_LENGTH_CM));

        this.hitTestSession.hitTest(rayStart, rayEnd, (result) => {
          if (result) {
            this.applyHitTarget(result.position, result.normal, camTransform);
          } else {
            this.applyFloorFallback(camTransform);
          }
        });
      } else {
        this.applyFloorFallback(camTransform);
      }
    }

    const alpha = 1.0 - Math.exp(-SMOOTH_SPEED * (dt > 0 ? dt : 0.016));
    this.currentPos = vec3.lerp(this.currentPos, this.targetPos, alpha);
    this.currentRot = quat.slerp(this.currentRot, this.targetRot, alpha);

    const rootTransform = this.anchorRoot.getTransform();
    rootTransform.setWorldPosition(this.currentPos);
    rootTransform.setWorldRotation(this.currentRot);
  }

  public destroy(): void {
    this.stopHitTest();
  }

  private initTracking(): void {
    if (this.deviceTracking) {
      this.deviceTracking.requestDeviceTrackingMode(DeviceTrackingMode.World);
    }

    try {
      const worldQuery = require("LensStudio:WorldQueryModule");
      if (worldQuery) {
        this.hitTestSession = worldQuery.createHitTestSession();
        this.startHitTest();
      }
    } catch (_err) {
      // WorldQueryModule is unavailable in non-Spectacles desktop previews; floor fallback handles it cleanly.
      this.hitTestSession = null;
    }
  }

  private startHitTest(): void {
    if (this.hitTestSession) {
      try {
        this.hitTestSession.start();
      } catch (_err) {
        this.hitTestSession = null;
      }
    }
  }

  private stopHitTest(): void {
    if (this.hitTestSession) {
      try {
        this.hitTestSession.stop();
      } catch (_err) {
        // Ignore teardown errors
      }
    }
  }

  private applyHitTarget(position: vec3, normal: vec3, camTransform: Transform): void {
    const up = normal.normalize();
    // Keep ring oriented cleanly toward the kneeling rescuer while staying flush to the surface normal
    const toCamera = camTransform.getWorldPosition().sub(position);
    const projected = toCamera.sub(up.uniformScale(toCamera.dot(up)));
    const forward = projected.length > 0.001 ? projected.normalize() : vec3.forward();

    this.targetPos = position;
    this.targetRot = quat.lookAt(forward, up);

    if (!this.hasTarget) {
      this.currentPos = this.targetPos;
      this.currentRot = this.targetRot;
      this.hasTarget = true;
    }
  }

  private applyFloorFallback(camTransform: Transform): void {
    const camPos = camTransform.getWorldPosition();
    const lookDir = camTransform.forward.uniformScale(-1.0);
    const flatLook = new vec3(lookDir.x, 0, lookDir.z);
    const flatDir = flatLook.length > 0.001 ? flatLook.normalize() : new vec3(0, 0, -1);

    const floorPos = new vec3(
      camPos.x + flatDir.x * FLOOR_FALLBACK_FORWARD_CM,
      camPos.y - FLOOR_FALLBACK_DROP_CM,
      camPos.z + flatDir.z * FLOOR_FALLBACK_FORWARD_CM
    );
    this.applyHitTarget(floorPos, vec3.up(), camTransform);
  }
}
