/**
 * MobileHUD.js
 * Translucent glassmorphism mobile + desktop touch & keyboard HUD.
 * Multi-touch isolated: left joystick / steering never conflicts with right camera look or pedals.
 */
export class MobileHUD {
  constructor({
    onEnterExitCar,
    onCycleCamera,
    onOpenGarage,
    onOpenPlateEditor,
    onHorn,
    onToggleMute,
    onLookDelta,
  }) {
    this.callbacks = {
      onEnterExitCar,
      onCycleCamera,
      onOpenGarage,
      onOpenPlateEditor,
      onHorn,
      onToggleMute,
      onLookDelta,
    };

    this.mode = 'walk'; // 'walk' | 'drive'
    this.sprintToggled = false;
    this.muted = false;

    // Virtual Joystick State
    this.joyPointerId = null;
    this.joyVec = { x: 0, y: 0 };

    // Camera Drag Look State
    this.lookPointerId = null;
    this.lookLast = { x: 0, y: 0 };

    // Touch Pedals / Steering State
    this.touchInput = {
      left: false,
      right: false,
      gas: false,
      brake: false,
      handbrake: false,
      sprint: false,
    };

    // Keyboard State
    this.keys = new Set();

    this._buildDOM();
    this._bindEvents();
  }

  _buildDOM() {
    this.root = document.createElement('div');
    this.root.className = 'hud-layer';
    this.root.innerHTML = `
      <!-- Top Bar: Compact Radar + Location + Utility Actions -->
      <div class="hud-top-bar">
        <div class="hud-radar-group glass-pill">
          <canvas class="radar-canvas" width="84" height="84" aria-label="Mini xarita"></canvas>
          <div class="radar-meta">
            <div class="radar-district">Toshkent Markazi</div>
            <div class="radar-coords tabular-nums" data-slot="coords">0m · 0m</div>
          </div>
        </div>

        <div class="hud-top-actions">
          <button type="button" class="hud-action-pill" data-action="camera" title="Kamerani almashtirish">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
            <span data-slot="cam-label">Orqa kamera</span>
          </button>
          <button type="button" class="hud-action-pill" data-action="garage" title="Garaj">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>
            <span>Garaj</span>
          </button>
          <button type="button" class="hud-action-pill" data-action="plate" title="Davlat raqami">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h2v4H6zM11 10h7M11 14h5"/></svg>
            <span>Raqam</span>
          </button>
          <button type="button" class="hud-icon-btn" data-action="mute" aria-label="Ovoz">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-slot="sound-icon"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          </button>
        </div>
      </div>

      <!-- Transparent Right-Half Camera Swipe Zone -->
      <div class="camera-look-zone" data-slot="look-zone"></div>

      <!-- WALKING CONTROLS (Piyoda rejimi) -->
      <div class="controls-walk" data-slot="walk-controls">
        <div class="joystick-zone" data-slot="joystick-base">
          <div class="joystick-ring">
            <div class="joystick-knob" data-slot="joystick-knob"></div>
          </div>
        </div>

        <div class="walk-right-cluster">
          <button type="button" class="hud-cta-enter is-hidden" data-action="enter-car">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            <span>Minish</span>
          </button>
          <button type="button" class="touch-circle-btn" data-action="sprint">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/></svg>
            <span>Yugurish</span>
          </button>
        </div>
      </div>

      <!-- DRIVING CONTROLS (Haydash rejimi) -->
      <div class="controls-drive is-hidden" data-slot="drive-controls">
        <!-- Left Steering Pads -->
        <div class="drive-steer-cluster">
          <button type="button" class="steer-pad" data-hold="left" aria-label="Chapga">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button type="button" class="steer-pad" data-hold="right" aria-label="O‘ngga">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>

        <!-- Bottom Center Compact Speedometer + Exit Button -->
        <div class="drive-center-hud">
          <div class="speedo-pill glass-pill">
            <div class="speedo-main">
              <span class="speedo-value tabular-nums" data-slot="speed-kmh">0</span>
              <span class="speedo-unit">km/s</span>
            </div>
            <div class="speedo-sub">
              <span data-slot="car-name">Chevrolet Cobalt</span>
              <span class="dot-sep">·</span>
              <span class="tabular-nums" data-slot="car-plate">01 A 777 AA</span>
            </div>
          </div>
          <div class="drive-quick-row">
            <button type="button" class="hud-mini-btn" data-action="horn">Signal</button>
            <button type="button" class="hud-mini-btn hud-exit-btn" data-action="exit-car">Tushish</button>
          </div>
        </div>

        <!-- Right Translucent Pedals: Drift + Brake + Gas -->
        <div class="drive-pedals-cluster">
          <button type="button" class="pedal-btn pedal-drift" data-hold="handbrake">
            <span>DRIFT</span>
          </button>
          <button type="button" class="pedal-btn pedal-brake" data-hold="brake">
            <span>TORMOZ</span>
          </button>
          <button type="button" class="pedal-btn pedal-gas" data-hold="gas">
            <span>GAZ</span>
          </button>
        </div>
      </div>
    `;

    this.radarCanvas = this.root.querySelector('.radar-canvas');
    this.coordsEl = this.root.querySelector('[data-slot="coords"]');
    this.camLabelEl = this.root.querySelector('[data-slot="cam-label"]');
    this.walkControls = this.root.querySelector('[data-slot="walk-controls"]');
    this.driveControls = this.root.querySelector('[data-slot="drive-controls"]');
    this.enterCarBtn = this.root.querySelector('[data-action="enter-car"]');
    this.sprintBtn = this.root.querySelector('[data-action="sprint"]');
    this.joyBase = this.root.querySelector('[data-slot="joystick-base"]');
    this.joyKnob = this.root.querySelector('[data-slot="joystick-knob"]');
    this.lookZone = this.root.querySelector('[data-slot="look-zone"]');
    this.speedEl = this.root.querySelector('[data-slot="speed-kmh"]');
    this.carNameEl = this.root.querySelector('[data-slot="car-name"]');
    this.carPlateEl = this.root.querySelector('[data-slot="car-plate"]');

    document.body.appendChild(this.root);
  }

  _bindEvents() {
    // Top bar & action buttons
    this.root.querySelector('[data-action="camera"]').addEventListener('click', () => {
      const m = this.callbacks.onCycleCamera?.();
      if (m) this.camLabelEl.textContent = m.label;
    });
    this.root.querySelector('[data-action="garage"]').addEventListener('click', () => this.callbacks.onOpenGarage?.());
    this.root.querySelector('[data-action="plate"]').addEventListener('click', () => this.callbacks.onOpenPlateEditor?.());
    this.root.querySelector('[data-action="enter-car"]').addEventListener('click', () => this.callbacks.onEnterExitCar?.());
    this.root.querySelector('[data-action="exit-car"]').addEventListener('click', () => this.callbacks.onEnterExitCar?.());
    this.root.querySelector('[data-action="horn"]').addEventListener('click', () => this.callbacks.onHorn?.());
    this.root.querySelector('[data-action="mute"]').addEventListener('click', () => {
      this.muted = !this.muted;
      this.root.querySelector('[data-action="mute"]').classList.toggle('is-muted', this.muted);
      this.callbacks.onToggleMute?.(this.muted);
    });

    // Sprint button (tap toggles OR hold works cleanly)
    this.sprintBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.sprintToggled = !this.sprintToggled;
      this.sprintBtn.classList.toggle('is-active', this.sprintToggled);
    });

    // Multi-touch hold buttons (steer left/right, gas, brake, handbrake)
    this.root.querySelectorAll('[data-hold]').forEach((btn) => {
      const key = btn.dataset.hold;
      const setHold = (active) => {
        this.touchInput[key] = active;
        btn.classList.toggle('is-pressed', active);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        setHold(true);
      });
      btn.addEventListener('pointerup', () => setHold(false));
      btn.addEventListener('pointercancel', () => setHold(false));
      btn.addEventListener('lostpointercapture', () => setHold(false));
    });

    // Virtual Joystick multi-touch
    const maxRadius = 46;
    const updateJoy = (clientX, clientY) => {
      const rect = this.joyBase.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }
      this.joyKnob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      this.joyVec.x = dx / maxRadius;
      this.joyVec.y = -dy / maxRadius; // Up on screen = +1 forward
    };
    const resetJoy = () => {
      this.joyPointerId = null;
      this.joyVec.x = 0;
      this.joyVec.y = 0;
      this.joyKnob.style.transform = 'translate3d(0, 0, 0)';
    };

    this.joyBase.addEventListener('pointerdown', (e) => {
      if (this.joyPointerId !== null) return;
      e.preventDefault();
      this.joyPointerId = e.pointerId;
      this.joyBase.setPointerCapture?.(e.pointerId);
      updateJoy(e.clientX, e.clientY);
    });
    this.joyBase.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyPointerId) return;
      updateJoy(e.clientX, e.clientY);
    });
    this.joyBase.addEventListener('pointerup', (e) => {
      if (e.pointerId === this.joyPointerId) resetJoy();
    });
    this.joyBase.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.joyPointerId) resetJoy();
    });

    // 360° Touch/Mouse Camera Look Drag Zone
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookPointerId !== null) return;
      this.lookPointerId = e.pointerId;
      this.lookLast.x = e.clientX;
      this.lookLast.y = e.clientY;
      this.lookZone.setPointerCapture?.(e.pointerId);
    });
    this.lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookPointerId) return;
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast.x = e.clientX;
      this.lookLast.y = e.clientY;
      this.callbacks.onLookDelta?.(dx, dy);
    });
    const endLook = (e) => {
      if (e.pointerId === this.lookPointerId) this.lookPointerId = null;
    };
    this.lookZone.addEventListener('pointerup', endLook);
    this.lookZone.addEventListener('pointercancel', endLook);

    // Desktop Keyboard Fallback + Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const code = e.code;
      this.keys.add(code);
      if (code === 'KeyF' || code === 'KeyE') this.callbacks.onEnterExitCar?.();
      if (code === 'KeyC') {
        const m = this.callbacks.onCycleCamera?.();
        if (m) this.camLabelEl.textContent = m.label;
      }
      if (code === 'KeyG') this.callbacks.onOpenGarage?.();
      if (code === 'KeyP') this.callbacks.onOpenPlateEditor?.();
      if (code === 'KeyH') this.callbacks.onHorn?.();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
  }

  setMode(mode, vehicle = null) {
    this.mode = mode;
    const driving = mode === 'drive';
    this.walkControls.classList.toggle('is-hidden', driving);
    this.driveControls.classList.toggle('is-hidden', !driving);
    if (driving && vehicle) {
      this.carNameEl.textContent = vehicle.config.name;
      this.carPlateEl.textContent = vehicle.plateText;
    }
    // Reset touch holds on mode transition
    for (const k of Object.keys(this.touchInput)) this.touchInput[k] = false;
    this.joyVec.x = 0;
    this.joyVec.y = 0;
    this.joyKnob.style.transform = 'translate3d(0, 0, 0)';
  }

  getWalkInput() {
    let moveX = this.joyVec.x;
    let moveY = this.joyVec.y;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveY += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveY -= 1;

    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    const sprint = this.sprintToggled || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    return { moveX, moveY, sprint };
  }

  getDriveInput() {
    let throttle = 0;
    if (this.touchInput.gas || this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle += 1;
    if (this.touchInput.brake || this.keys.has('KeyS') || this.keys.has('ArrowDown')) throttle -= 1;

    let steer = 0;
    if (this.touchInput.left || this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer -= 1;
    if (this.touchInput.right || this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer += 1;

    const handbrake = this.touchInput.handbrake || this.keys.has('Space');
    return { throttle, steer, handbrake };
  }

  updateTelemetry(playerPos, cameraYawDeg, nearVehicle, activeVehicle, allVehicles) {
    this.coordsEl.textContent = `${Math.round(playerPos.x)}m · ${Math.round(playerPos.z)}m`;

    if (this.mode === 'walk') {
      this.enterCarBtn.classList.toggle('is-hidden', !nearVehicle);
    } else if (activeVehicle) {
      this.speedEl.textContent = String(Math.round(activeVehicle.getSpeedKmh()));
      this.carPlateEl.textContent = activeVehicle.plateText;
    }

    this._drawRadar(playerPos, cameraYawDeg, allVehicles, activeVehicle);
  }

  _drawRadar(playerPos, cameraYawDeg, vehicles, activeVehicle) {
    const ctx = this.radarCanvas.getContext('2d');
    const size = 84;
    const half = size * 0.5;
    const scale = 0.24; // ~170m radar radius

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = 'rgba(11, 16, 26, 0.85)';
    ctx.fillRect(0, 0, size, size);

    // Rotate map relative to camera yaw
    ctx.translate(half, half);
    ctx.rotate((cameraYawDeg * Math.PI) / 180);

    // Road grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 2;
    for (const rc of [-120, -60, 0, 60, 120]) {
      const rx = (rc - playerPos.x) * scale;
      const rz = (rc - playerPos.z) * scale;
      ctx.beginPath();
      ctx.moveTo(rx, -120);
      ctx.lineTo(rx, 120);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-120, rz);
      ctx.lineTo(120, rz);
      ctx.stroke();
    }

    // Tashkent TV Tower marker at (0,0)
    const tx = -playerPos.x * scale;
    const tz = -playerPos.z * scale;
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(tx, tz, 4, 0, Math.PI * 2);
    ctx.fill();

    // Vehicle blips
    for (const v of vehicles) {
      if (!v.ready || v === activeVehicle) continue;
      const vp = v.root.getPosition();
      const vx = (vp.x - playerPos.x) * scale;
      const vz = (vp.z - playerPos.z) * scale;
      ctx.fillStyle = '#FBBF24';
      ctx.fillRect(vx - 2.2, vz - 2.2, 4.4, 4.4);
    }

    ctx.restore();

    // Player center triangle
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(half, half - 5);
    ctx.lineTo(half - 4, half + 4);
    ctx.lineTo(half + 4, half + 4);
    ctx.closePath();
    ctx.fill();
  }
}
