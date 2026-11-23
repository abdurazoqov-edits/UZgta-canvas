import * as pc from 'playcanvas';

export const CAMERA_MODES = [
  { id: 'chase', label: 'Orqa kamera' },
  { id: 'orbit', label: 'Erkin 360°' },
  { id: 'hood', label: 'Kapot / Salon' },
];

export class CameraController {
  constructor(cameraEntity) {
    this.cameraEntity = cameraEntity;
    this.modeIndex = 0; // 0: Chase, 1: Free Orbit 360, 2: Hood/FP

    this.yaw = 0;
    this.pitch = 16;
    this.currentPos = new pc.Vec3(0, 6, 52);
    this.lookTarget = new pc.Vec3(0, 1.5, 44);
    this.fov = 58;

    this._userOrbitCooldown = 0;
    this._scratchTarget = new pc.Vec3();
    this._scratchDesiredPos = new pc.Vec3();
  }

  cycleMode() {
    this.modeIndex = (this.modeIndex + 1) % CAMERA_MODES.length;
    return CAMERA_MODES[this.modeIndex];
  }

  getCurrentMode() {
    return CAMERA_MODES[this.modeIndex];
  }

  addLookDelta(dx, dy) {
    this.yaw -= dx * 0.28;
    this.pitch = Math.max(-6, Math.min(68, this.pitch + dy * 0.22));
    this._userOrbitCooldown = 2.2;
  }

  snapToTarget(targetEntity, yawDeg = 0) {
    const pos = targetEntity.getPosition();
    this.yaw = yawDeg;
    this.pitch = 16;
    const rad = (this.yaw * Math.PI) / 180;
    this.currentPos.set(pos.x + Math.sin(rad) * 7.5, pos.y + 3.2, pos.z + Math.cos(rad) * 7.5);
    this.lookTarget.set(pos.x, pos.y + 1.35, pos.z);
    this.cameraEntity.setPosition(this.currentPos);
    this.cameraEntity.lookAt(this.lookTarget);
  }

  update(dt, targetEntity, isDriving, vehicle = null) {
    if (!targetEntity) return;
    if (this._userOrbitCooldown > 0) {
      this._userOrbitCooldown -= dt;
    }

    const pos = targetEntity.getPosition();
    const mode = CAMERA_MODES[this.modeIndex].id;

    // 1. Hood / Cockpit Camera
    if (mode === 'hood') {
      if (isDriving && vehicle) {
        const fwd = targetEntity.forward;
        const up = targetEntity.up;
        this._scratchDesiredPos.set(
          pos.x + fwd.x * 0.45 + up.x * 1.32,
          pos.y + 1.32,
          pos.z + fwd.z * 0.45 + up.z * 1.32
        );
        this._scratchTarget.set(
          this._scratchDesiredPos.x + fwd.x * 18,
          this._scratchDesiredPos.y - 0.55,
          this._scratchDesiredPos.z + fwd.z * 18
        );
        this.currentPos.lerp(this.currentPos, this._scratchDesiredPos, Math.min(1, dt * 22));
        this.lookTarget.lerp(this.lookTarget, this._scratchTarget, Math.min(1, dt * 22));
        this.cameraEntity.setPosition(this.currentPos);
        this.cameraEntity.lookAt(this.lookTarget);
      } else {
        // First-person street view when walking
        const fwd = targetEntity.forward;
        this._scratchDesiredPos.set(pos.x + fwd.x * 0.25, pos.y + 1.62, pos.z + fwd.z * 0.25);
        const yawRad = (this.yaw * Math.PI) / 180;
        const pitchRad = (this.pitch * Math.PI) / 180;
        this._scratchTarget.set(
          this._scratchDesiredPos.x - Math.sin(yawRad) * Math.cos(pitchRad) * 14,
          this._scratchDesiredPos.y - Math.sin(pitchRad) * 14,
          this._scratchDesiredPos.z - Math.cos(yawRad) * Math.cos(pitchRad) * 14
        );
        this.currentPos.copy(this._scratchDesiredPos);
        this.cameraEntity.setPosition(this.currentPos);
        this.cameraEntity.lookAt(this._scratchTarget);
      }
      this.fov += (64 - this.fov) * Math.min(1, dt * 6);
      this.cameraEntity.camera.fov = this.fov;
      return;
    }

    // 2. Auto-align behind vehicle in Chase Cam when driving & not dragging orbit
    if (mode === 'chase' && isDriving && vehicle && this._userOrbitCooldown <= 0) {
      const targetYaw = vehicle.yaw;
      const speedRatio = Math.min(1, Math.abs(vehicle.speed) / 12);
      const diff = ((targetYaw - this.yaw + 540) % 360) - 180;
      this.yaw += diff * Math.min(1, dt * (2.2 + speedRatio * 3.8));
      this.pitch += (14.5 - this.pitch) * Math.min(1, dt * 3.2);
    }

    const distance = isDriving ? 7.4 : 4.6;
    const heightOffset = isDriving ? 1.45 : 1.45;
    const yawRad = (this.yaw * Math.PI) / 180;
    const pitchRad = (this.pitch * Math.PI) / 180;

    const horizDist = Math.cos(pitchRad) * distance;
    const vertDist = Math.sin(pitchRad) * distance;

    this._scratchDesiredPos.set(
      pos.x + Math.sin(yawRad) * horizDist,
      Math.max(0.75, pos.y + heightOffset + vertDist),
      pos.z + Math.cos(yawRad) * horizDist
    );

    this._scratchTarget.set(pos.x, pos.y + (isDriving ? 1.15 : 1.32), pos.z);

    const posLerp = Math.min(1, dt * (isDriving ? 11.5 : 14));
    this.currentPos.lerp(this.currentPos, this._scratchDesiredPos, posLerp);
    this.lookTarget.lerp(this.lookTarget, this._scratchTarget, Math.min(1, dt * 16));

    this.cameraEntity.setPosition(this.currentPos);
    this.cameraEntity.lookAt(this.lookTarget);

    // Dynamic speed FOV widening
    const targetFov = isDriving && vehicle ? 58 + Math.min(11, vehicle.getSpeedKmh() * 0.065) : 56;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 6);
    this.cameraEntity.camera.fov = this.fov;
  }
}
