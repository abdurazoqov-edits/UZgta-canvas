import * as pc from 'playcanvas';
import { LicensePlateSystem } from './LicensePlate.js';

const _v1 = new pc.Vec3();
const _v2 = new pc.Vec3();
const _bbox = new pc.BoundingBox();

function findNodeByNames(root, candidates) {
  const all = [];
  const collect = (node) => {
    all.push(node);
    const ch = node.children || [];
    for (let i = 0; i < ch.length; i++) collect(ch[i]);
  };
  collect(root);

  for (const cand of candidates) {
    const lc = cand.toLowerCase();
    const exact = all.find((n) => (n.name || '').toLowerCase() === lc);
    if (exact) return exact;
  }
  for (const cand of candidates) {
    const lc = cand.toLowerCase();
    const partial = all.find((n) => (n.name || '').toLowerCase().includes(lc));
    if (partial) return partial;
  }
  return null;
}

function getNodeLocalBoundsRelativeTo(node, targetRoot) {
  const renders = node.findComponents ? node.findComponents('render') : [];
  const box = new pc.BoundingBox();
  let init = false;
  for (let i = 0; i < renders.length; i++) {
    const mis = renders[i].meshInstances;
    for (let j = 0; j < mis.length; j++) {
      if (!mis[j].aabb) continue;
      if (!init) {
        box.copy(mis[j].aabb);
        init = true;
      } else {
        box.add(mis[j].aabb);
      }
    }
  }
  if (!init) return null;
  const invRoot = targetRoot.getWorldTransform().clone().invert();
  const centerLocal = invRoot.transformPoint(box.center);
  return { worldBox: box, centerLocal };
}

export class VehicleController {
  constructor(app, modelLoader, config) {
    this.app = app;
    this.modelLoader = modelLoader;
    this.config = config;

    this.root = new pc.Entity(`Vehicle_${config.id}`);
    this.bodyTiltPivot = new pc.Entity('BodyTiltPivot');
    this.root.addChild(this.bodyTiltPivot);

    this.modelData = null;
    this.wheels = { fl: null, fr: null, rl: null, rr: null };
    this.wheelRadius = 0.34;
    this.wheelSpinAngle = 0;
    this.steerAngle = 0;

    // Driving physics state
    this.speed = 0; // m/s signed (positive = forward)
    this.velocity = new pc.Vec3();
    this.yaw = config.spawnYaw || 0;
    this.isDrifting = false;
    this.slipAmount = 0;
    this.rollAngle = 0;
    this.pitchAngle = 0;

    // Plate & paint state
    this.plateSystem = new LicensePlateSystem(app);
    this.plateText = this._loadSavedPlate();
    this.plateOffsets = this._loadSavedOffsets();
    this.plateSet = null;
    this.frontAnchor = null;
    this.rearAnchor = null;

    this.paintMaterials = [];
    this.originalPaintColors = [];
    this.currentColorHex = null;

    this.collisionRadius = 2.05;
    this.ready = false;
  }

  _storageKey(suffix) {
    return `tashkent_car_${this.config.id}_${suffix}`;
  }

  _loadSavedPlate() {
    try {
      const v = localStorage.getItem(this._storageKey('plate'));
      if (v) return v;
    } catch {}
    return this.config.defaultPlate || '01 A 777 AA';
  }

  _loadSavedOffsets() {
    const def = {
      front: { x: 0, y: 0, z: 0, scale: this.config.plateFront?.scale ?? 1.0 },
      rear: { x: 0, y: 0, z: 0, scale: this.config.plateRear?.scale ?? 1.0 },
    };
    try {
      const raw = localStorage.getItem(this._storageKey('plate_offsets'));
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          front: { ...def.front, ...(parsed.front || {}) },
          rear: { ...def.rear, ...(parsed.rear || {}) },
        };
      }
    } catch {}
    return def;
  }

  savePlateSettings() {
    try {
      localStorage.setItem(this._storageKey('plate'), this.plateText);
      localStorage.setItem(this._storageKey('plate_offsets'), JSON.stringify(this.plateOffsets));
    } catch {}
  }

  async init() {
    this.modelData = await this.modelLoader.instantiateGrounded(this.config.modelUrl, {
      castShadows: true,
      receiveShadows: true,
      targetLength: this.config.targetLength || 4.55,
      yawOffsetDeg: this.config.yawOffsetDeg || 0,
    });

    this.bodyTiltPivot.addChild(this.modelData.root);

    const pos = this.config.spawnPos || [0, 0, 18];
    this.root.setPosition(pos[0], 0, pos[2]);
    this.root.setEulerAngles(0, this.yaw, 0);
    this.app.root.addChild(this.root);
    this.root.syncHierarchy();

    this._detectPaintMaterials();
    if (this.config.defaultColor) {
      this.setPaintColor(this.config.defaultColor);
    }

    this._detectAndWrapWheels();
    this._attachLicensePlates();

    this.ready = true;
    return this;
  }

  _detectPaintMaterials() {
    const seen = new Set();
    const renders = this.modelData.modelEntity.findComponents('render');
    for (const render of renders) {
      for (const mi of render.meshInstances) {
        const mat = mi.material;
        if (!mat || seen.has(mat)) continue;
        seen.add(mat);
        const name = (mat.name || '').toLowerCase();
        // Identify car body paint materials while sparing glass, tires, chrome, lights
        const isCarPaint =
          name.includes('paint') ||
          name.includes('body') ||
          name.includes('carpaint') ||
          name.includes('chassis') ||
          name.includes('coat');
        const isExcluded =
          name.includes('glass') ||
          name.includes('window') ||
          name.includes('tire') ||
          name.includes('rubber') ||
          name.includes('rim') ||
          name.includes('chrome') ||
          name.includes('headlight') ||
          name.includes('taillight') ||
          name.includes('trim') ||
          name.includes('dark');

        if (isCarPaint && !isExcluded) {
          this.paintMaterials.push(mat);
          this.originalPaintColors.push(mat.diffuse.clone());
        }
      }
    }
  }

  setPaintColor(hex) {
    this.currentColorHex = hex;
    for (let i = 0; i < this.paintMaterials.length; i++) {
      const mat = this.paintMaterials[i];
      if (!hex) {
        mat.diffuse.copy(this.originalPaintColors[i]);
      } else {
        mat.diffuse.fromString(hex);
      }
      mat.update();
    }
  }

  /**
   * Automatically detects the 4 wheels by name (wheel_fl/fr/rl/rr) OR
   * bounding-box corner heuristics, then wraps each in a centered steerPivot -> spinPivot.
   */
  _detectAndWrapWheels() {
    const model = this.modelData.modelEntity;
    const wheelSlots = {
      fl: ['wheel_fl', 'fl_wheel', 'wheel_lf', 'front_left_wheel', 'wheel_front_left', 'tire_fl', 'rim_fl'],
      fr: ['wheel_fr', 'fr_wheel', 'wheel_rf', 'front_right_wheel', 'wheel_front_right', 'tire_fr', 'rim_fr'],
      rl: ['wheel_rl', 'rl_wheel', 'wheel_lr', 'rear_left_wheel', 'wheel_rear_left', 'tire_rl', 'rim_rl'],
      rr: ['wheel_rr', 'rr_wheel', 'wheel_rr', 'rear_right_wheel', 'wheel_rear_right', 'tire_rr', 'rim_rr'],
    };

    const foundNodes = {
      fl: findNodeByNames(model, wheelSlots.fl),
      fr: findNodeByNames(model, wheelSlots.fr),
      rl: findNodeByNames(model, wheelSlots.rl),
      rr: findNodeByNames(model, wheelSlots.rr),
    };

    // Bounding-box spatial fallback for arbitrary third-party GLBs
    if (!foundNodes.fl || !foundNodes.fr || !foundNodes.rl || !foundNodes.rr) {
      const carBounds = this.modelLoader.computeEntityBounds(model);
      const carCenter = carBounds.center;
      const carHalf = carBounds.halfExtents;
      const candidates = [];

      const renders = model.findComponents('render');
      for (const r of renders) {
        const node = r.entity;
        const nName = (node.name || '').toLowerCase();
        if (nName.includes('body') || nName.includes('chassis') || nName.includes('cabin')) continue;

        const info = getNodeLocalBoundsRelativeTo(node, this.root);
        if (!info) continue;
        const ext = info.worldBox.halfExtents;
        const h = ext.y * 2;
        const isWheelSized = h > 0.25 && h < carHalf.y * 1.35;
        const isNamedWheel = /wheel|tire|tyre|rim|koleso|disk/i.test(nName);
        const relX = info.centerLocal.x;
        const relZ = info.centerLocal.z;
        const isCorner =
          Math.abs(relX) > carHalf.x * 0.35 &&
          Math.abs(relZ) > carHalf.z * 0.20 &&
          info.centerLocal.y < carHalf.y * 1.15;

        if ((isNamedWheel || isCorner) && isWheelSized) {
          candidates.push({ node, relX, relZ, radius: ext.y });
        }
      }

      if (candidates.length >= 4) {
        // PlayCanvas vehicle forward is -Z -> front has relZ < 0, rear has relZ > 0
        // Left side is -X, Right side is +X
        const front = candidates.filter((c) => c.relZ < 0).sort((a, b) => a.relX - b.relX);
        const rear = candidates.filter((c) => c.relZ >= 0).sort((a, b) => a.relX - b.relX);
        if (!foundNodes.fl && front[0]) foundNodes.fl = front[0].node;
        if (!foundNodes.fr && front[front.length - 1]) foundNodes.fr = front[front.length - 1].node;
        if (!foundNodes.rl && rear[0]) foundNodes.rl = rear[0].node;
        if (!foundNodes.rr && rear[rear.length - 1]) foundNodes.rr = rear[rear.length - 1].node;
      }
      // Keep carCenter referenced cleanly
      void carCenter;
    }

    let radiusSum = 0;
    let radiusCount = 0;

    for (const key of ['fl', 'fr', 'rl', 'rr']) {
      const node = foundNodes[key];
      if (!node || !node.parent) continue;

      // Measure wheel world bounds to center pivot accurately
      const info = getNodeLocalBoundsRelativeTo(node, node.parent);
      const parentWorld = node.parent.getWorldTransform();
      const invParent = parentWorld.clone().invert();

      let pivotLocalPos = node.getLocalPosition().clone();
      if (info) {
        const wheelWorldCenter = info.worldBox.center;
        pivotLocalPos = invParent.transformPoint(wheelWorldCenter);
        radiusSum += info.worldBox.halfExtents.y;
        radiusCount += 1;
      }

      const steerPivot = new pc.Entity(`WheelSteer_${key}`);
      const spinPivot = new pc.Entity(`WheelSpin_${key}`);
      const oldParent = node.parent;

      steerPivot.setLocalPosition(pivotLocalPos);
      oldParent.addChild(steerPivot);
      steerPivot.addChild(spinPivot);

      // Re-parent node under spinPivot preserving world transform
      const nodeWorldMat = node.getWorldTransform().clone();
      node.parent.removeChild(node);
      spinPivot.addChild(node);
      this.root.syncHierarchy();

      const invSpin = spinPivot.getWorldTransform().clone().invert();
      const localMat = new pc.Mat4().mul2(invSpin, nodeWorldMat);
      const t = new pc.Vec3();
      const r = new pc.Quat();
      const s = new pc.Vec3();
      localMat.getTranslation(t);
      r.setFromMat4(localMat);
      localMat.getScale(s);
      node.setLocalPosition(t);
      node.setLocalRotation(r);
      node.setLocalScale(s);

      this.wheels[key] = { steerPivot, spinPivot, node };
    }

    if (radiusCount > 0) {
      this.wheelRadius = Math.max(0.22, Math.min(0.65, radiusSum / radiusCount));
    }
  }

  _attachLicensePlates() {
    this.plateSet = this.plateSystem.createPlateSet(this.plateText);
    const model = this.modelData.modelEntity;

    const frontNode = findNodeByNames(model, ['plate_front', 'front_plate', 'license_front', 'number_front']);
    const rearNode = findNodeByNames(model, ['plate_rear', 'rear_plate', 'license_rear', 'number_rear']);

    if (frontNode) {
      this.frontAnchor = new pc.Entity('PlateFrontAnchor');
      frontNode.addChild(this.frontAnchor);
    } else {
      this.frontAnchor = new pc.Entity('PlateFrontFallbackAnchor');
      const cfg = this.config.plateFront || { pos: [0, 0.42, -2.25], rotY: 180 };
      this.frontAnchor.setLocalPosition(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      this.frontAnchor.setLocalEulerAngles(0, cfg.rotY ?? 180, 0);
      this.bodyTiltPivot.addChild(this.frontAnchor);
    }

    if (rearNode) {
      this.rearAnchor = new pc.Entity('PlateRearAnchor');
      rearNode.addChild(this.rearAnchor);
    } else {
      this.rearAnchor = new pc.Entity('PlateRearFallbackAnchor');
      const cfg = this.config.plateRear || { pos: [0, 0.56, 2.25], rotY: 0 };
      this.rearAnchor.setLocalPosition(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
      this.rearAnchor.setLocalEulerAngles(0, cfg.rotY ?? 0, 0);
      this.bodyTiltPivot.addChild(this.rearAnchor);
    }

    this.frontAnchor.addChild(this.plateSet.frontHolder);
    this.rearAnchor.addChild(this.plateSet.rearHolder);
    this.applyPlateOffsets();
  }

  applyPlateOffsets() {
    if (!this.plateSet) return;
    const f = this.plateOffsets.front;
    const r = this.plateOffsets.rear;

    // Compensate for pivot scale so plates always stay crisp real-world 52x13cm unless scaled by user
    const sf = f.scale / (this.modelData?.scaleFactor || 1);
    const sr = r.scale / (this.modelData?.scaleFactor || 1);

    this.plateSet.frontHolder.setLocalPosition(f.x, f.y, f.z);
    this.plateSet.frontHolder.setLocalScale(sf, sf, sf);

    this.plateSet.rearHolder.setLocalPosition(r.x, r.y, r.z);
    this.plateSet.rearHolder.setLocalScale(sr, sr, sr);
  }

  setPlateText(newText) {
    this.plateText = newText;
    this.plateSet?.updateText(newText);
    this.savePlateSettings();
  }

  setPlateOffset(which, axis, value) {
    if (!this.plateOffsets[which]) return;
    this.plateOffsets[which][axis] = value;
    this.applyPlateOffsets();
    this.savePlateSettings();
  }

  resetPlateOffsets() {
    this.plateOffsets = {
      front: { x: 0, y: 0, z: 0, scale: this.config.plateFront?.scale ?? 1.0 },
      rear: { x: 0, y: 0, z: 0, scale: this.config.plateRear?.scale ?? 1.0 },
    };
    this.applyPlateOffsets();
    this.savePlateSettings();
  }

  getSpeedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  getExitPosition(colliders) {
    const right = this.root.right;
    const pos = this.root.getPosition();
    // Try driver left side (-right), then passenger right side (+right)
    const candidates = [
      new pc.Vec3(pos.x - right.x * 1.9, 0, pos.z - right.z * 1.9),
      new pc.Vec3(pos.x + right.x * 1.9, 0, pos.z + right.z * 1.9),
      new pc.Vec3(pos.x, 0, pos.z + 3.2),
    ];
    for (const cand of candidates) {
      if (!this._hitsAnyCollider(cand.x, cand.z, 0.45, colliders)) {
        return cand;
      }
    }
    return candidates[0];
  }

  _hitsAnyCollider(x, z, radius, colliders) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.type === 'circle') {
        const dx = x - c.x;
        const dz = z - c.z;
        const minD = c.r + radius;
        if (dx * dx + dz * dz < minD * minD) return true;
      } else {
        const cx = Math.max(c.minX, Math.min(x, c.maxX));
        const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz < radius * radius) return true;
      }
    }
    return false;
  }

  update(dt, input, colliders, otherVehicles = []) {
    if (!this.ready) return;

    const maxFwd = (this.config.maxSpeedKmh || 175) / 3.6;
    const maxRev = (this.config.reverseSpeedKmh || 48) / 3.6;
    const accel = this.config.acceleration || 16;
    const brake = this.config.brakeForce || 30;
    const turnRate = this.config.turnSpeed || 2.4;

    const throttle = input ? (input.throttle || 0) : 0; // -1..1
    const steerInput = input ? (input.steer || 0) : 0;  // -1 (left) .. 1 (right)
    const handbrake = input ? !!input.handbrake : false;

    // 1. Longitudinal Acceleration / Braking / Reverse
    let targetPitch = 0;
    if (throttle > 0.02) {
      if (this.speed < -0.5) {
        this.speed += brake * dt;
        targetPitch = 1.6;
      } else {
        const torqueCurve = 1.0 - 0.35 * Math.min(1, Math.abs(this.speed) / maxFwd);
        this.speed = Math.min(maxFwd, this.speed + throttle * accel * torqueCurve * dt);
        targetPitch = -1.8 * throttle;
      }
    } else if (throttle < -0.02) {
      if (this.speed > 0.8) {
        this.speed -= brake * Math.abs(throttle) * dt;
        targetPitch = 2.2;
      } else {
        this.speed = Math.max(-maxRev, this.speed + throttle * (accel * 0.7) * dt);
        targetPitch = 1.0;
      }
    } else {
      // Natural rolling resistance + aero drag
      const drag = 3.2 + Math.abs(this.speed) * 0.14;
      if (Math.abs(this.speed) <= drag * dt) {
        this.speed = 0;
      } else {
        this.speed -= Math.sign(this.speed) * drag * dt;
      }
    }

    if (handbrake) {
      const hbDecel = 14.0 * dt;
      if (Math.abs(this.speed) <= hbDecel) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * hbDecel;
    }

    // 2. Smooth steering & speed-sensitive yaw
    const targetSteerAngle = -steerInput * 32; // +Y turns left in PlayCanvas
    this.steerAngle += (targetSteerAngle - this.steerAngle) * Math.min(1, dt * 11);

    const absSpeed = Math.abs(this.speed);
    const speedFactor = Math.min(1, absSpeed / 7.5);
    const highSpeedDamp = 1.0 - 0.32 * Math.min(1, absSpeed / maxFwd);
    const dirSign = this.speed >= -0.05 ? 1 : -1;
    const driftBoost = handbrake && absSpeed > 5 ? 1.42 : 1.0;

    if (absSpeed > 0.12) {
      this.yaw += -steerInput * turnRate * speedFactor * highSpeedDamp * driftBoost * dirSign * dt * 60 * 0.0166;
      this.root.setEulerAngles(0, this.yaw, 0);
    }

    // 3. Velocity vector with lateral grip / drift slip
    const fwd = this.root.forward; // -Z in entity local space
    const desiredVx = fwd.x * this.speed;
    const desiredVz = fwd.z * this.speed;

    const lateralGrip = handbrake ? (this.config.driftGrip || 0.38) : 0.88;
    const blend = Math.min(1, dt * (2.5 + lateralGrip * 14.0));
    this.velocity.x += (desiredVx - this.velocity.x) * blend;
    this.velocity.z += (desiredVz - this.velocity.z) * blend;

    const actualSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const crossSlip = Math.abs(this.velocity.x * fwd.z - this.velocity.z * fwd.x);
    this.slipAmount = actualSpeed > 3 ? Math.min(1, crossSlip / Math.max(2, actualSpeed)) : 0;
    this.isDrifting = handbrake && absSpeed > 6;

    // 4. Move & Resolve Collisions (World bounds + Buildings + Other Cars)
    const pos = this.root.getPosition();
    let nx = pos.x + this.velocity.x * dt;
    let nz = pos.z + this.velocity.z * dt;

    // Keep within city limits (-205 .. 205)
    nx = Math.max(-205, Math.min(205, nx));
    nz = Math.max(-205, Math.min(205, nz));

    // Resolve static city colliders
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.type === 'circle') {
        const dx = nx - c.x;
        const dz = nz - c.z;
        const minD = c.r + this.collisionRadius;
        const distSq = dx * dx + dz * dz;
        if (distSq < minD * minD && distSq > 1e-6) {
          const dist = Math.sqrt(distSq);
          const push = minD - dist;
          const ux = dx / dist;
          const uz = dz / dist;
          nx += ux * push;
          nz += uz * push;
          this.speed *= 0.65;
          this.velocity.x *= 0.65;
          this.velocity.z *= 0.65;
        }
      } else {
        const cx = Math.max(c.minX, Math.min(nx, c.maxX));
        const cz = Math.max(c.minZ, Math.min(nz, c.maxZ));
        const dx = nx - cx;
        const dz = nz - cz;
        const distSq = dx * dx + dz * dz;
        if (distSq < this.collisionRadius * this.collisionRadius) {
          const dist = Math.sqrt(distSq);
          if (dist > 1e-4) {
            const push = this.collisionRadius - dist;
            nx += (dx / dist) * push;
            nz += (dz / dist) * push;
          } else {
            nx = pos.x;
            nz = pos.z;
          }
          this.speed *= 0.62;
          this.velocity.x *= 0.62;
          this.velocity.z *= 0.62;
        }
      }
    }

    // Resolve car-to-car bumper collisions
    for (let i = 0; i < otherVehicles.length; i++) {
      const other = otherVehicles[i];
      if (other === this || !other.ready) continue;
      const op = other.root.getPosition();
      const dx = nx - op.x;
      const dz = nz - op.z;
      const minD = this.collisionRadius + other.collisionRadius;
      const distSq = dx * dx + dz * dz;
      if (distSq < minD * minD && distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = (minD - dist) * 0.55;
        nx += (dx / dist) * push;
        nz += (dz / dist) * push;
        this.speed *= 0.65;
      }
    }

    this.root.setPosition(nx, 0, nz);

    // 5. Chassis suspension pitch & roll
    const targetRoll = steerInput * Math.min(1, absSpeed / 18) * 3.4;
    this.rollAngle += (targetRoll - this.rollAngle) * Math.min(1, dt * 8);
    this.pitchAngle += (targetPitch - this.pitchAngle) * Math.min(1, dt * 8);
    this.bodyTiltPivot.setLocalEulerAngles(this.pitchAngle, 0, this.rollAngle);

    // 6. Animate all 4 wheels (forward spin + front wheel steering)
    // Forward is -Z, so rolling forward rotates around local X negatively
    const spinDeltaDeg = -(this.speed * dt / this.wheelRadius) * (180 / Math.PI);
    this.wheelSpinAngle = (this.wheelSpinAngle + spinDeltaDeg) % 360;

    if (this.wheels.fl) {
      this.wheels.fl.steerPivot.setLocalEulerAngles(0, this.steerAngle, 0);
      this.wheels.fl.spinPivot.setLocalEulerAngles(this.wheelSpinAngle, 0, 0);
    }
    if (this.wheels.fr) {
      this.wheels.fr.steerPivot.setLocalEulerAngles(0, this.steerAngle, 0);
      this.wheels.fr.spinPivot.setLocalEulerAngles(this.wheelSpinAngle, 0, 0);
    }
    if (this.wheels.rl) {
      this.wheels.rl.spinPivot.setLocalEulerAngles(this.wheelSpinAngle, 0, 0);
    }
    if (this.wheels.rr) {
      this.wheels.rr.spinPivot.setLocalEulerAngles(this.wheelSpinAngle, 0, 0);
    }

    void _v1;
    void _v2;
    void _bbox;
  }

  destroy() {
    this.plateSet?.destroy();
    this.root.destroy();
  }
}
