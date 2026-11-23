import './styles.css';
import * as pc from 'playcanvas';
import { CARS_CONFIG } from './config/cars.js';
import { GameEngine } from './core/Engine.js';
import { ModelLoader } from './core/ModelLoader.js';
import { SoundEngine } from './core/SoundEngine.js';
import { TashkentCity } from './world/TashkentCity.js';
import { VehicleController } from './vehicles/VehicleController.js';
import { CharacterController } from './character/CharacterController.js';
import { CameraController } from './camera/CameraController.js';
import { MobileHUD } from './ui/MobileHUD.js';
import { GarageModal } from './ui/GarageModal.js';
import { PlateEditorModal } from './ui/PlateEditorModal.js';

function setBootProgress(pct, text) {
  const fill = document.getElementById('boot-bar-fill');
  const status = document.getElementById('boot-status');
  if (fill) fill.style.width = `${pct}%`;
  if (status) status.textContent = text;
}

function hideBootLoader() {
  const loader = document.getElementById('boot-loader');
  if (!loader) return;
  loader.classList.add('is-done');
  setTimeout(() => loader.remove(), 340);
}

async function bootstrap() {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;

  setBootProgress(18, 'PlayCanvas HDR dvigateli ishga tushirilmoqda...');
  const engine = new GameEngine(canvas);
  const modelLoader = new ModelLoader(engine.app);
  const sound = new SoundEngine();

  // Unlock WebAudio on first touch/click anywhere
  const unlockAudio = () => sound.unlock();
  window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true, passive: true });

  setBootProgress(38, 'Toshkent shahri va teleminora qurilmoqda...');
  const city = new TashkentCity(engine.app, modelLoader);
  await city.build();

  setBootProgress(62, 'Avtomobillar va davlat raqamlari yuklanmoqda...');
  const vehicles = [];
  for (const cfg of CARS_CONFIG) {
    try {
      const car = new VehicleController(engine.app, modelLoader, cfg);
      await car.init();
      vehicles.push(car);
    } catch (err) {
      console.warn(`[Main] Could not load vehicle ${cfg.id} (${cfg.modelUrl}):`, err);
    }
  }

  setBootProgress(82, 'Bosh qahramon va animatsiyalar tayyorlanmoqda...');
  const character = new CharacterController(engine.app, modelLoader);
  await character.init([0, 0, 38]);

  const cameraCtrl = new CameraController(engine.cameraEntity);
  cameraCtrl.snapToTarget(character.root, 180);

  let activeVehicle = null;
  let lastDrivenVehicle = vehicles[0] || null;
  let modalOpen = false;

  const garageModal = new GarageModal({
    onSelectCar: (carId) => {
      const targetCar = vehicles.find((v) => v.config.id === carId);
      if (!targetCar) return;

      // If currently driving another car, step out cleanly or swap position in front of player
      if (activeVehicle && activeVehicle !== targetCar) {
        const curPos = activeVehicle.root.getPosition().clone();
        const curYaw = activeVehicle.yaw;
        activeVehicle.speed = 0;
        activeVehicle.velocity.set(0, 0, 0);

        // Move selected car to player's current driving spot
        targetCar.root.setPosition(curPos.x, 0, curPos.z);
        targetCar.yaw = curYaw;
        targetCar.root.setEulerAngles(0, curYaw, 0);
        targetCar.speed = 0;
        targetCar.velocity.set(0, 0, 0);

        // Relocate old car safely to its spawn lot
        const sp = activeVehicle.config.spawnPos || [15, 0, 25];
        activeVehicle.root.setPosition(sp[0], 0, sp[2]);
        activeVehicle.yaw = activeVehicle.config.spawnYaw || 0;
        activeVehicle.root.setEulerAngles(0, activeVehicle.yaw, 0);

        activeVehicle = targetCar;
        lastDrivenVehicle = targetCar;
        hud.setMode('drive', activeVehicle);
      } else if (!activeVehicle) {
        // Summon selected car right beside the player & enter it
        const pPos = character.root.getPosition();
        const rad = (character.yaw * Math.PI) / 180;
        const spawnX = pPos.x - Math.sin(rad) * 3.5;
        const spawnZ = pPos.z - Math.cos(rad) * 3.5;
        targetCar.root.setPosition(spawnX, 0, spawnZ);
        targetCar.yaw = character.yaw;
        targetCar.root.setEulerAngles(0, targetCar.yaw, 0);
        targetCar.speed = 0;
        targetCar.velocity.set(0, 0, 0);

        enterVehicle(targetCar);
      }
    },
    onSelectPaint: (hex) => {
      const target = activeVehicle || lastDrivenVehicle || vehicles[0];
      target?.setPaintColor(hex);
    },
    onClose: () => {
      modalOpen = false;
    },
  });

  const plateModal = new PlateEditorModal({
    onPlateChange: (text) => {
      const target = activeVehicle || lastDrivenVehicle || vehicles[0];
      target?.setPlateText(text);
    },
    onOffsetChange: (which, axis, val) => {
      const target = activeVehicle || lastDrivenVehicle || vehicles[0];
      target?.setPlateOffset(which, axis, val);
    },
    onResetOffsets: () => {
      const target = activeVehicle || lastDrivenVehicle || vehicles[0];
      target?.resetPlateOffsets();
    },
    onClose: () => {
      modalOpen = false;
    },
  });

  function enterVehicle(car) {
    if (!car || !car.ready) return;
    activeVehicle = car;
    lastDrivenVehicle = car;
    character.setInVehicle(true);
    sound.playDoorToggle(true);
    hud.setMode('drive', car);
  }

  function exitVehicle() {
    if (!activeVehicle) return;
    const exitPos = activeVehicle.getExitPosition(city.colliders);
    const exitYaw = activeVehicle.yaw;
    activeVehicle.speed *= 0.25;
    character.setInVehicle(false, exitPos, exitYaw);
    activeVehicle = null;
    sound.playDoorToggle(false);
    hud.setMode('walk');
  }

  const hud = new MobileHUD({
    onEnterExitCar: () => {
      if (activeVehicle) {
        exitVehicle();
      } else if (character.nearestVehicle) {
        enterVehicle(character.nearestVehicle);
      }
    },
    onCycleCamera: () => cameraCtrl.cycleMode(),
    onOpenGarage: () => {
      const target = activeVehicle || lastDrivenVehicle || vehicles[0];
      if (!target) return;
      modalOpen = true;
      garageModal.open(target.config.id, target.currentColorHex);
    },
    onOpenPlateEditor: () => {
      const target = activeVehicle || lastDrivenVehicle || vehicles[0];
      if (!target) return;
      modalOpen = true;
      plateModal.open(target);
    },
    onHorn: () => sound.playHorn(),
    onToggleMute: (muted) => sound.setMuted(muted),
    onLookDelta: (dx, dy) => {
      if (!modalOpen) cameraCtrl.addLookDelta(dx, dy);
    },
  });

  setBootProgress(100, 'Tayyor!');
  hideBootLoader();

  // Main 60 FPS PlayCanvas Game Loop
  const _shadowFocus = new pc.Vec3();
  engine.app.on('update', (dtRaw) => {
    const dt = Math.min(dtRaw, 0.05); // Clamp frame spikes cleanly
    engine.updatePerformanceGovernor(dt);
    city.update(dt);

    const isDriving = !!activeVehicle;
    const emptyInput = { moveX: 0, moveY: 0, sprint: false, throttle: 0, steer: 0, handbrake: false };

    if (isDriving) {
      const driveInput = modalOpen ? emptyInput : hud.getDriveInput();
      activeVehicle.update(dt, driveInput, city.colliders, vehicles);
      sound.updateDriving(
        true,
        Math.min(1, activeVehicle.getSpeedKmh() / (activeVehicle.config.maxSpeedKmh || 180)),
        driveInput.throttle,
        activeVehicle.slipAmount
      );
      cameraCtrl.update(dt, activeVehicle.root, true, activeVehicle);
    } else {
      const walkInput = modalOpen ? emptyInput : hud.getWalkInput();
      character.update(dt, walkInput, cameraCtrl.yaw, city.colliders, vehicles);
      sound.updateDriving(false, 0, 0, 0);
      sound.updateFootstep(dt, character.speed, walkInput.sprint);
      cameraCtrl.update(dt, character.root, false, null);
    }

    // Gentle coast-down for unoccupied vehicles
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (v !== activeVehicle && Math.abs(v.speed) > 0.05) {
        v.update(dt, emptyInput, city.colliders, vehicles);
      }
    }

    // Keep directional sun shadow frustum centered near player (texel-snapped to prevent shadow shimmer)
    const focusEntity = isDriving ? activeVehicle.root : character.root;
    const fp = focusEntity.getPosition();
    _shadowFocus.set(Math.round(fp.x * 2) * 0.5, 0, Math.round(fp.z * 2) * 0.5);
    engine.sunLight.setPosition(_shadowFocus.x + 35, 65, _shadowFocus.z + 35);

    hud.updateTelemetry(fp, cameraCtrl.yaw, character.nearestVehicle, activeVehicle, vehicles);
  });

  window.addEventListener('beforeunload', () => {
    city.destroy();
    for (const v of vehicles) v.destroy();
    modelLoader.disposeAll();
    sound.destroy();
    engine.destroy();
  });
}

bootstrap().catch((err) => {
  console.error('[TashkentStreetDrive] Fatal init error:', err);
  setBootProgress(100, 'Yuklashda xatolik yuz berdi. Sahifani yangilang.');
});
