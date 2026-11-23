import { CARS_CONFIG, PAINT_PRESETS } from '../config/cars.js';

export class GarageModal {
  constructor({ onSelectCar, onSelectPaint, onClose }) {
    this.onSelectCar = onSelectCar;
    this.onSelectPaint = onSelectPaint;
    this.onClose = onClose;

    this.el = document.createElement('div');
    this.el.className = 'modal-backdrop is-hidden';
    this.el.innerHTML = `
      <div class="glass-modal" role="dialog" aria-modal="true" aria-label="Garaj">
        <div class="modal-header">
          <div>
            <h2 class="modal-title">Shahar Garaji</h2>
            <p class="modal-subtitle">Mashinani tanlang yoki kuzov rangini o‘zgartiring</p>
          </div>
          <button type="button" class="icon-close-btn" data-action="close" aria-label="Yopish">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="section-label">Avtomobillar ro‘yxati</div>
          <div class="garage-car-grid" data-slot="cars"></div>

          <div class="section-label" style="margin-top: 16px;">Kuzov rangi</div>
          <div class="paint-swatch-row" data-slot="paints"></div>
        </div>
      </div>
    `;

    this.carsContainer = this.el.querySelector('[data-slot="cars"]');
    this.paintsContainer = this.el.querySelector('[data-slot="paints"]');

    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide();
    });
    this.el.querySelector('[data-action="close"]').addEventListener('click', () => this.hide());

    document.body.appendChild(this.el);
  }

  open(activeVehicleId, currentPaintHex) {
    this._renderCars(activeVehicleId);
    this._renderPaints(currentPaintHex);
    this.el.classList.remove('is-hidden');
  }

  hide() {
    this.el.classList.add('is-hidden');
    this.onClose?.();
  }

  _renderCars(activeId) {
    this.carsContainer.innerHTML = '';
    for (const car of CARS_CONFIG) {
      const isSelected = car.id === activeId;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `garage-car-card${isSelected ? ' is-active' : ''}`;
      card.innerHTML = `
        <div class="car-card-top">
          <span class="car-card-name">${car.name}</span>
          <span class="car-card-speed tabular-nums">${car.maxSpeedKmh} km/s</span>
        </div>
        <div class="car-card-sub">${car.subtitle}</div>
        <div class="car-card-meta tabular-nums">Raqam: ${car.defaultPlate} · Tezlanish: ${car.acceleration}</div>
      `;
      card.addEventListener('click', () => {
        this.onSelectCar?.(car.id);
        this.hide();
      });
      this.carsContainer.appendChild(card);
    }
  }

  _renderPaints(activeHex) {
    this.paintsContainer.innerHTML = '';
    for (const p of PAINT_PRESETS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = (p.hex || null) === (activeHex || null);
      btn.className = `paint-swatch${isActive ? ' is-active' : ''}`;
      btn.title = p.name;
      btn.setAttribute('aria-label', p.name);
      if (p.hex) {
        btn.style.backgroundColor = p.hex;
      } else {
        btn.style.background = 'linear-gradient(135deg, #e2e8f0 0%, #475569 100%)';
      }
      btn.innerHTML = `<span class="paint-label">${p.name}</span>`;
      btn.addEventListener('click', () => {
        this.onSelectPaint?.(p.hex);
        this._renderPaints(p.hex);
      });
      this.paintsContainer.appendChild(btn);
    }
  }
}
