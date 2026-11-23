/**
 * SoundEngine.js
 * Zero-asset procedural WebAudio synthesizer for engine RPM, drift tire screech,
 * car door chime, horn, and footsteps. Safe for Android WebView & browser autoplay policies.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.unlocked = false;

    this._engineOsc1 = null;
    this._engineOsc2 = null;
    this._engineGain = null;
    this._engineFilter = null;

    this._screechSource = null;
    this._screechGain = null;
    this._screechFilter = null;

    this._stepCooldown = 0;
  }

  unlock() {
    if (this.unlocked && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.unlocked = true;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    this._setupEngineNodes();
    this._setupScreechNodes();
  }

  _setupEngineNodes() {
    if (!this.ctx) return;
    const ctx = this.ctx;

    this._engineOsc1 = ctx.createOscillator();
    this._engineOsc1.type = 'sawtooth';
    this._engineOsc1.frequency.value = 54;

    this._engineOsc2 = ctx.createOscillator();
    this._engineOsc2.type = 'triangle';
    this._engineOsc2.frequency.value = 108;

    this._engineFilter = ctx.createBiquadFilter();
    this._engineFilter.type = 'lowpass';
    this._engineFilter.frequency.value = 260;
    this._engineFilter.Q.value = 2.2;

    this._engineGain = ctx.createGain();
    this._engineGain.gain.value = 0.0;

    this._engineOsc1.connect(this._engineFilter);
    this._engineOsc2.connect(this._engineFilter);
    this._engineFilter.connect(this._engineGain);
    this._engineGain.connect(ctx.destination);

    this._engineOsc1.start();
    this._engineOsc2.start();
  }

  _setupScreechNodes() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 1.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this._screechSource = ctx.createBufferSource();
    this._screechSource.buffer = buffer;
    this._screechSource.loop = true;

    this._screechFilter = ctx.createBiquadFilter();
    this._screechFilter.type = 'bandpass';
    this._screechFilter.frequency.value = 1450;
    this._screechFilter.Q.value = 5.5;

    this._screechGain = ctx.createGain();
    this._screechGain.gain.value = 0.0;

    this._screechSource.connect(this._screechFilter);
    this._screechFilter.connect(this._screechGain);
    this._screechGain.connect(ctx.destination);
    this._screechSource.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted && this.ctx) {
      if (this._engineGain) this._engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      if (this._screechGain) this._screechGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }

  updateDriving(isDriving, speedNorm, throttle, slipAmount) {
    if (!this.ctx || !this._engineGain) return;
    const now = this.ctx.currentTime;

    if (!isDriving || this.muted) {
      this._engineGain.gain.setTargetAtTime(0, now, 0.08);
      if (this._screechGain) this._screechGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const rpmFreq = 46 + speedNorm * 115 + Math.abs(throttle) * 24;
    this._engineOsc1.frequency.setTargetAtTime(rpmFreq, now, 0.06);
    this._engineOsc2.frequency.setTargetAtTime(rpmFreq * 2.01, now, 0.06);
    this._engineFilter.frequency.setTargetAtTime(220 + speedNorm * 680 + Math.abs(throttle) * 180, now, 0.06);
    this._engineGain.gain.setTargetAtTime(0.055 + speedNorm * 0.045, now, 0.08);

    if (this._screechGain) {
      const targetScreech = slipAmount > 0.2 ? Math.min(0.075, (slipAmount - 0.2) * 0.11) : 0;
      this._screechGain.gain.setTargetAtTime(targetScreech, now, 0.05);
    }
  }

  updateFootstep(dt, speed, isRunning) {
    if (!this.ctx || this.muted || speed < 0.4) {
      this._stepCooldown = 0.08;
      return;
    }
    this._stepCooldown -= dt;
    if (this._stepCooldown <= 0) {
      this._stepCooldown = isRunning ? 0.29 : 0.44;
      this._playStepTick(isRunning);
    }
  }

  _playStepTick(isRunning) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isRunning ? 135 : 105, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.06);
    gain.gain.setValueAtTime(isRunning ? 0.06 : 0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playDoorToggle(entering) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(entering ? 150 : 190, now);
    osc.frequency.exponentialRampToValueAtTime(entering ? 68 : 85, now + 0.11);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  playHorn() {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    for (const freq of [392, 493.88]) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.setValueAtTime(0.06, now + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    }
  }

  destroy() {
    try { this._engineOsc1?.stop(); } catch {}
    try { this._engineOsc2?.stop(); } catch {}
    try { this._screechSource?.stop(); } catch {}
    try { this.ctx?.close(); } catch {}
  }
}
