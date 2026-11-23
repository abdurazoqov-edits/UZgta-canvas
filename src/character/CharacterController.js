import * as pc from 'playcanvas';

function findBone(root, patterns) {
  const nodes = [];
  const walk = (n) => {
    nodes.push(n);
    const ch = n.children || [];
    for (let i = 0; i < ch.length; i++) walk(ch[i]);
  };
  walk(root);

  for (const pat of patterns) {
    const lc = pat.toLowerCase();
    const exact = nodes.find((n) => (n.name || '').toLowerCase() === lc);
    if (exact) return exact;
  }
  for (const pat of patterns) {
    const lc = pat.toLowerCase();
    const partial = nodes.find((n) => (n.name || '').toLowerCase().includes(lc));
    if (partial) return partial;
  }
  return null;
}

export class CharacterController {
  constructor(app, modelLoader) {
    this.app = app;
    this.modelLoader = modelLoader;

    this.root = new pc.Entity('PlayerCharacter');
    this.modelData = null;
    this.ready = false;
    this.inVehicle = false;

    this.yaw = 180; // Facing North (-Z toward Tashkent TV Tower)
    this.speed = 0;
    this.walkSpeed = 4.2;
    this.runSpeed = 8.4;
    this.collisionRadius = 0.42;

    // Animation mode
    this.hasEmbeddedAnims = false;
    this.animState = 'Idle';
    this._phase = 0;
    this.bones = {};
    this.restRot = {};
    this.restPos = {};

    this.nearestVehicle = null;
    this.nearestVehicleDist = Infinity;
  }

  async init(spawnPos = [0, 0, 44]) {
    this.modelData = await this.modelLoader.instantiateGrounded('./models/character.glb', {
      castShadows: true,
      receiveShadows: true,
      targetHeight: 1.78,
      yawOffsetDeg: 0,
    });

    this.root.addChild(this.modelData.root);
    this.root.setPosition(spawnPos[0], 0, spawnPos[2]);
    this.root.setEulerAngles(0, this.yaw, 0);
    this.app.root.addChild(this.root);

    this._setupAnimations();
    this._cacheSkeletonBones();

    this.ready = true;
    return this;
  }

  _setupAnimations() {
    const animAssets = this.modelData.containerAsset.resource.animations || [];
    if (animAssets.length === 0) {
      this.hasEmbeddedAnims = false;
      return;
    }

    const matchClip = (regex) => animAssets.find((a) => regex.test((a.name || a.resource?.name || '').toLowerCase()));
    const idleClip = matchClip(/idle|stand|breath/) || animAssets[0];
    const walkClip = matchClip(/walk|strut/) || null;
    const runClip = matchClip(/run|sprint|jog/) || walkClip || null;

    if (!idleClip || (!walkClip && !runClip)) {
      this.hasEmbeddedAnims = false;
      return;
    }

    const entity = this.modelData.modelEntity;
    entity.addComponent('anim', {
      activate: true,
      speed: 1.0,
    });

    entity.anim.assignAnimation('Idle', idleClip.resource, 1.0, true);
    if (walkClip) entity.anim.assignAnimation('Walk', walkClip.resource, 1.0, true);
    if (runClip) entity.anim.assignAnimation('Run', runClip.resource, 1.0, true);

    this.hasEmbeddedAnims = true;
    this.animState = 'Idle';
    entity.anim.baseLayer.play('Idle');
  }

  _cacheSkeletonBones() {
    const m = this.modelData.modelEntity;
    const boneDefs = {
      hips: ['Hips', 'mixamorig:Hips', 'pelvis', 'root_hips'],
      spine: ['Spine', 'mixamorig:Spine', 'spine_01'],
      chest: ['Chest', 'Spine2', 'mixamorig:Spine2', 'upper_chest'],
      head: ['Head', 'mixamorig:Head'],
      leftUpperArm: ['LeftUpperArm', 'LeftArm', 'mixamorig:LeftArm', 'upper_arm.L', 'arm_l'],
      leftForeArm: ['LeftForeArm', 'mixamorig:LeftForeArm', 'forearm.L'],
      rightUpperArm: ['RightUpperArm', 'RightArm', 'mixamorig:RightArm', 'upper_arm.R', 'arm_r'],
      rightForeArm: ['RightForeArm', 'mixamorig:RightForeArm', 'forearm.R'],
      leftThigh: ['LeftThigh', 'LeftUpLeg', 'mixamorig:LeftUpLeg', 'thigh.L', 'leg_l'],
      leftShin: ['LeftShin', 'LeftLeg', 'mixamorig:LeftLeg', 'shin.L'],
      rightThigh: ['RightThigh', 'RightUpLeg', 'mixamorig:RightUpLeg', 'thigh.R', 'leg_r'],
      rightShin: ['RightShin', 'RightLeg', 'mixamorig:RightLeg', 'shin.R'],
    };

    for (const [key, patterns] of Object.entries(boneDefs)) {
      const bone = findBone(m, patterns);
      if (bone) {
        this.bones[key] = bone;
        this.restRot[key] = bone.getLocalEulerAngles().clone();
        this.restPos[key] = bone.getLocalPosition().clone();
      }
    }
  }

  setInVehicle(inside, exitPosition = null, exitYaw = null) {
    this.inVehicle = inside;
    this.root.enabled = !inside;
    if (!inside && exitPosition) {
      this.root.setPosition(exitPosition.x, 0, exitPosition.z);
      if (exitYaw !== null) {
        this.yaw = exitYaw;
        this.root.setEulerAngles(0, this.yaw, 0);
      }
      this.speed = 0;
      this._setAnimState('Idle', 0);
    }
  }

  _setAnimState(nextState, speedRatio) {
    if (this.hasEmbeddedAnims && this.modelData?.modelEntity?.anim) {
      const anim = this.modelData.modelEntity.anim;
      if (this.animState !== nextState) {
        this.animState = nextState;
        anim.baseLayer.transition(nextState, 0.16);
      }
      if (nextState === 'Walk') {
        anim.speed = Math.max(0.7, Math.min(1.45, speedRatio * 1.15));
      } else if (nextState === 'Run') {
        anim.speed = Math.max(0.85, Math.min(1.35, speedRatio * 1.1));
      } else {
        anim.speed = 1.0;
      }
    }
  }

  _applyProceduralLimbGait(dt, moveSpeed, isRunning) {
    const b = this.bones;
    if (!b.leftThigh && !b.leftUpperArm) return;

    if (moveSpeed < 0.18) {
      this._phase += dt * 2.2;
      const breath = Math.sin(this._phase) * 1.6;
      const setIdle = (key, dx = 0, dy = 0, dz = 0) => {
        if (!b[key] || !this.restRot[key]) return;
        const r = this.restRot[key];
        const cur = b[key].getLocalEulerAngles();
        const k = Math.min(1, dt * 10);
        b[key].setLocalEulerAngles(
          cur.x + (r.x + dx - cur.x) * k,
          cur.y + (r.y + dy - cur.y) * k,
          cur.z + (r.z + dz - cur.z) * k
        );
      };
      setIdle('chest', breath, 0, 0);
      setIdle('spine', breath * 0.4, 0, 0);
      setIdle('leftUpperArm', breath * 0.8, 0, 0);
      setIdle('rightUpperArm', -breath * 0.8, 0, 0);
      setIdle('leftForeArm', 6, 0, 0);
      setIdle('rightForeArm', 6, 0, 0);
      setIdle('leftThigh', 0, 0, 0);
      setIdle('rightThigh', 0, 0, 0);
      setIdle('leftShin', 0, 0, 0);
      setIdle('rightShin', 0, 0, 0);
      if (b.hips && this.restPos.hips) {
        b.hips.setLocalPosition(this.restPos.hips);
      }
      return;
    }

    const strideFreq = isRunning ? 11.5 : 7.8;
    const amp = isRunning ? 52 : 34;
    this._phase += dt * strideFreq;

    const s = Math.sin(this._phase);
    const c = Math.cos(this._phase);
    const bob = Math.abs(c) * (isRunning ? 0.055 : 0.025);

    const rotBone = (key, dx, dy = 0, dz = 0) => {
      if (!b[key] || !this.restRot[key]) return;
      const r = this.restRot[key];
      b[key].setLocalEulerAngles(r.x + dx, r.y + dy, r.z + dz);
    };

    if (b.hips && this.restPos.hips) {
      const hp = this.restPos.hips;
      b.hips.setLocalPosition(hp.x, hp.y + bob, hp.z);
    }

    // Opposite arm & leg swing
    rotBone('leftThigh', s * amp);
    rotBone('rightThigh', -s * amp);
    rotBone('leftShin', -Math.max(0, -c) * (isRunning ? 58 : 34) - 6);
    rotBone('rightShin', -Math.max(0, c) * (isRunning ? 58 : 34) - 6);

    rotBone('leftUpperArm', -s * amp * 0.85);
    rotBone('rightUpperArm', s * amp * 0.85);
    rotBone('leftForeArm', isRunning ? 48 : 20);
    rotBone('rightForeArm', isRunning ? 48 : 20);

    rotBone('spine', isRunning ? 10 : 3, s * 4, 0);
  }

  update(dt, input, cameraYawDeg, colliders, vehicles) {
    if (!this.ready) return;

    if (this.inVehicle) {
      this.nearestVehicle = null;
      this.nearestVehicleDist = Infinity;
      return;
    }

    const moveX = input.moveX || 0;
    const moveY = input.moveY || 0; // +1 forward
    const mag = Math.min(1, Math.hypot(moveX, moveY));
    const isRunning = !!input.sprint && mag > 0.15;

    const targetSpeed = mag > 0.08 ? (isRunning ? this.runSpeed : this.walkSpeed) * mag : 0;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 12);

    if (mag > 0.08) {
      // Camera-relative world movement direction
      const camRad = (cameraYawDeg * Math.PI) / 180;
      // Camera forward is (-sin(yaw), -cos(yaw)), Camera right is (cos(yaw), -sin(yaw))
      const fwdX = -Math.sin(camRad);
      const fwdZ = -Math.cos(camRad);
      const rightX = Math.cos(camRad);
      const rightZ = -Math.sin(camRad);

      const dirX = fwdX * moveY + rightX * moveX;
      const dirZ = fwdZ * moveY + rightZ * moveX;
      const dLen = Math.hypot(dirX, dirZ) || 1;
      const ux = dirX / dLen;
      const uz = dirZ / dLen;

      // Smoothly turn character toward movement direction (character front is -Z)
      const desiredYaw = Math.atan2(-ux, -uz) * (180 / Math.PI);
      let diff = ((desiredYaw - this.yaw + 540) % 360) - 180;
      this.yaw += diff * Math.min(1, dt * 13);
      this.root.setEulerAngles(0, this.yaw, 0);

      // Move & resolve collisions
      const pos = this.root.getPosition();
      let nx = Math.max(-208, Math.min(208, pos.x + ux * this.speed * dt));
      let nz = Math.max(-208, Math.min(208, pos.z + uz * this.speed * dt));

      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        if (c.type === 'circle') {
          const dx = nx - c.x;
          const dz = nz - c.z;
          const minD = c.r + this.collisionRadius;
          const d2 = dx * dx + dz * dz;
          if (d2 < minD * minD && d2 > 1e-6) {
            const dist = Math.sqrt(d2);
            nx += (dx / dist) * (minD - dist);
            nz += (dz / dist) * (minD - dist);
          }
        } else {
          const cx = Math.max(c.minX, Math.min(nx, c.maxX));
          const cz = Math.max(c.minZ, Math.min(nz, c.maxZ));
          const dx = nx - cx;
          const dz = nz - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 < this.collisionRadius * this.collisionRadius && d2 > 1e-6) {
            const dist = Math.sqrt(d2);
            nx += (dx / dist) * (this.collisionRadius - dist);
            nz += (dz / dist) * (this.collisionRadius - dist);
          }
        }
      }

      // Collide softly with parked cars
      for (let i = 0; i < vehicles.length; i++) {
        const v = vehicles[i];
        if (!v.ready) continue;
        const vp = v.root.getPosition();
        const dx = nx - vp.x;
        const dz = nz - vp.z;
        const minD = v.collisionRadius + this.collisionRadius;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && d2 > 1e-6) {
          const dist = Math.sqrt(d2);
          nx += (dx / dist) * (minD - dist);
          nz += (dz / dist) * (minD - dist);
        }
      }

      this.root.setPosition(nx, 0, nz);
    }

    // Drive Animation (Embedded GLB clips OR procedural skeletal fallback)
    if (this.speed < 0.35) {
      this._setAnimState('Idle', 0);
    } else if (isRunning || this.speed > 5.6) {
      this._setAnimState('Run', this.speed / this.runSpeed);
    } else {
      this._setAnimState('Walk', this.speed / this.walkSpeed);
    }

    if (!this.hasEmbeddedAnims) {
      this._applyProceduralLimbGait(dt, this.speed, isRunning);
    }

    // Find nearest drivable car within 4.5m
    const myPos = this.root.getPosition();
    let bestCar = null;
    let bestDist = 4.5;
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (!v.ready) continue;
      const vp = v.root.getPosition();
      const d = Math.hypot(myPos.x - vp.x, myPos.z - vp.z);
      if (d < bestDist) {
        bestDist = d;
        bestCar = v;
      }
    }
    this.nearestVehicle = bestCar;
    this.nearestVehicleDist = bestDist;
  }
}
