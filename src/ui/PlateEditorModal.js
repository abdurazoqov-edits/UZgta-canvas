import { drawUzPlateToCanvas, parseUzPlateText } from '../vehicles/LicensePlate.js';

export class PlateEditorModal {
  constructor({ onPlateChange, onOffsetChange, onResetOffsets, onClose }) {
    this.onPlateChange = onPlateChange;
    this.onOffsetChange = onOffsetChange;
    this.onResetOffsets = onResetOffsets;
    this.onClose = onClose;

    this.activeTarget = 'front';
    this.vehicle = null;

    this.el = document.createElement('div');
    this.el.className = 'modal-backdrop is-hidden';
    this.el.innerHTML = `
      <div class="glass-modal plate-modal" role="dialog" aria-modal="true" aria-label="Davlat raqamini tahrirlash">
        <div class="modal-header">
          <div>
            <h2 class="modal-title">O‘zbekiston Davlat Raqami</h2>
            <p class="modal-subtitle">Tiniq HiDPI raqam matni va mashinadagi joylashuvini sozlang</p>
          </div>
          <button type="button" class="icon-close-btn" data-action="close" aria-label="Yopish">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="plate-preview-wrap">
            <canvas class="plate-preview-canvas" width="1024" height="256"></canvas>
          </div>

          <div class="plate-input-row">
            <div class="field-group" style="width: 92px;">
              <label for="plate-region">Hudud</label>
              <input id="plate-region" type="text" maxlength="2" inputmode="numeric" value="01" />
            </div>
            <div class="field-group" style="flex: 1;">
              <label for="plate-number">Raqam va harflar</label>
              <input id="plate-number" type="text" maxlength="10" value="A 777 AA" placeholder="A 777 AA" />
            </div>
            <button type="button" class="btn-primary-glass" data-action="apply-plate">Saqlash</button>
          </div>

          <div class="preset-plates-row">
            <button type="button" class="preset-plate-btn" data-plate="01 A 777 AA">01 A 777 AA</button>
            <button type="button" class="preset-plate-btn" data-plate="01 Z 001 ZZ">01 Z 001 ZZ</button>
            <button type="button" class="preset-plate-btn" data-plate="01 777 AAA">01 777 AAA</button>
            <button type="button" class="preset-plate-btn" data-plate="30 U 555 UZ">30 U 555 UZ</button>
          </div>

          <div class="divider-line"></div>

          <div class="offset-header-row">
            <div class="segmented-tabs">
              <button type="button" class="seg-tab is-active" data-target="front">Old raqam</button>
              <button type="button" class="seg-tab" data-target="rear">Orqa raqam</button>
            </div>
            <button type="button" class="btn-ghost-sm" data-action="reset-offsets">Asl holatga</button>
          </div>

          <div class="sliders-grid">
            <label class="slider-row">
              <span>Chap / O‘ng (X)</span>
              <input type="range" min="-0.6" max="0.6" step="0.01" data-axis="x" value="0" />
              <span class="slider-val tabular-nums" data-val="x">0.00</span>
            </label>
            <label class="slider-row">
              <span>Yuqori / Past (Y)</span>
              <input type="range" min="-0.4" max="0.4" step="0.01" data-axis="y" value="0" />
              <span class="slider-val tabular-nums" data-val="y">0.00</span>
            </label>
            <label class="slider-row">
              <span>Old / Orqa (Z)</span>
              <input type="range" min="-0.5" max="0.5" step="0.01" data-axis="z" value="0" />
              <span class="slider-val tabular-nums" data-val="z">0.00</span>
            </label>
            <label class="slider-row">
              <span>Masshtab</span>
              <input type="range" min="0.7" max="1.45" step="0.02" data-axis="scale" value="1" />
              <span class="slider-val tabular-nums" data-val="scale">1.00</span>
            </label>
          </div>
        </div>
      </div>
    `;

    this.previewCanvas = this.el.querySelector('.plate-preview-canvas');
    this.regionInput = this.el.querySelector('#plate-region');
    this.numberInput = this.el.querySelector('#plate-number');

    this._bindEvents();
    document.body.appendChild(this.el);
  }

  _bindEvents() {
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide();
    });
    this.el.querySelector('[data-action="close"]').addEventListener('click', () => this.hide());

    const updatePreview = () => {
      const full = `${this.regionInput.value} ${this.numberInput.value}`;
      drawUzPlateToCanvas(this.previewCanvas, full);
    };

    this.regionInput.addEventListener('input', updatePreview);
    this.numberInput.addEventListener('input', updatePreview);

    this.el.querySelector('[data-action="apply-plate"]').addEventListener('click', () => {
      const parsed = parseUzPlateText(`${this.regionInput.value} ${this.numberInput.value}`);
      this.regionInput.value = parsed.region;
      this.numberInput.value = parsed.main;
      drawUzPlateToCanvas(this.previewCanvas, parsed.full);
      this.onPlateChange?.(parsed.full);
    });

    this.el.querySelectorAll('.preset-plate-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parsed = parseUzPlateText(btn.dataset.plate);
        this.regionInput.value = parsed.region;
        this.numberInput.value = parsed.main;
        drawUzPlateToCanvas(this.previewCanvas, parsed.full);
        this.onPlateChange?.(parsed.full);
      });
    });

    this.el.querySelectorAll('.seg-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.activeTarget = tab.dataset.target;
        this.el.querySelectorAll('.seg-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
        this._syncSliders();
      });
    });

    this.el.querySelectorAll('input[data-axis]').forEach((slider) => {
      slider.addEventListener('input', () => {
        const axis = slider.dataset.axis;
        const val = parseFloat(slider.value);
        this.el.querySelector(`[data-val="${axis}"]`).textContent = val.toFixed(2);
        this.onOffsetChange?.(this.activeTarget, axis, val);
      });
    });

    this.el.querySelector('[data-action="reset-offsets"]').addEventListener('click', () => {
      this.onResetOffsets?.();
      this._syncSliders();
    });
  }

  _syncSliders() {
    if (!this.vehicle) return;
    const off = this.vehicle.plateOffsets[this.activeTarget];
    for (const axis of ['x', 'y', 'z', 'scale']) {
      const slider = this.el.querySelector(`input[data-axis="${axis}"]`);
      const label = this.el.querySelector(`[data-val="${axis}"]`);
      const val = off[axis] ?? (axis === 'scale' ? 1 : 0);
      slider.value = String(val);
      label.textContent = val.toFixed(2);
    }
  }

  open(vehicle) {
    this.vehicle = vehicle;
    const parsed = parseUzPlateText(vehicle.plateText);
    this.regionInput.value = parsed.region;
    this.numberInput.value = parsed.main;
    drawUzPlateToCanvas(this.previewCanvas, parsed.full);
    this._syncSliders();
    this.el.classList.remove('is-hidden');
  }

  hide() {
    this.el.classList.add('is-hidden');
    this.onClose?.();
  }
}
