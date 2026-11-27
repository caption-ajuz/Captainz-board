/**
 * Captnz Board — Offline Interactive Periodic Table Modal
 * Renders all 118 elements in an 18-column grid, instant local search,
 * detail inspection (Atomic Number, Mass, Electron Config), and one-tap "Place on Board".
 */

import { ELEMENT_CATEGORIES, PERIODIC_ELEMENTS } from '../data/periodicTable.js';
import { t } from '../i18n/translations.js';

export class PeriodicTableModal {
  constructor({ onPlaceElement }) {
    this.backdrop = document.getElementById('periodic-modal-backdrop');
    this.gridEl = document.getElementById('periodic-grid');
    this.searchEl = document.getElementById('periodic-search');
    this.detailEl = document.getElementById('periodic-detail');
    this.btnClose = document.getElementById('btn-close-periodic');
    this.btnPlace = document.getElementById('btn-place-element');
    this.onPlaceElement = onPlaceElement;

    this.selectedElement = PERIODIC_ELEMENTS[5]; // Default Carbon (C)
    this._built = false;

    this.btnClose?.addEventListener('click', () => this.close());
    this.backdrop?.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });

    this.searchEl?.addEventListener('input', () => this._filterGrid());
    this.btnPlace?.addEventListener('click', () => {
      if (!this.selectedElement) return;
      this.onPlaceElement?.(this.selectedElement);
      this.close();
    });
  }

  isOpen() {
    return Boolean(this.backdrop && !this.backdrop.classList.contains('hidden'));
  }

  open() {
    if (!this.backdrop) return;
    if (!this._built) {
      this._buildGrid();
      this._built = true;
    }
    this._renderDetail(this.selectedElement);
    this.backdrop.inert = false;
    this.backdrop.setAttribute('aria-hidden', 'false');
    this.backdrop.classList.remove('hidden');
    if (this.searchEl) {
      this.searchEl.value = '';
      this._filterGrid();
      setTimeout(() => this.searchEl.focus({ preventScroll: true }), 40);
    }
  }

  close() {
    if (!this.backdrop) return;
    if (this.backdrop.contains(document.activeElement)) {
      document.activeElement?.blur?.();
    }
    this.backdrop.classList.add('hidden');
    this.backdrop.setAttribute('aria-hidden', 'true');
    this.backdrop.inert = true;
  }

  _buildGrid() {
    if (!this.gridEl) return;
    const frag = document.createDocumentFragment();
    this._cells = [];

    for (const el of PERIODIC_ELEMENTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pt-cell';
      btn.style.gridColumn = String(el.col);
      btn.style.gridRow = String(el.row);
      const catColor = ELEMENT_CATEGORIES[el.category]?.color || '#3b82f6';
      btn.style.setProperty('--pt-cat', catColor);
      btn.dataset.num = String(el.number);
      btn.title = `${el.number} ${el.name} (${el.symbol})`;

      btn.innerHTML = `
        <span class="pt-num">${el.number}</span>
        <span class="pt-sym">${el.symbol}</span>
        <span class="pt-name">${el.name}</span>
      `;
      btn.addEventListener('click', () => {
        this.selectedElement = el;
        this._renderDetail(el);
      });

      this._cells.push({ el, btn });
      frag.appendChild(btn);
    }

    this.gridEl.innerHTML = '';
    this.gridEl.appendChild(frag);
  }

  _filterGrid() {
    const q = (this.searchEl?.value || '').trim().toLowerCase();
    for (const { el, btn } of this._cells || []) {
      const match =
        !q ||
        el.name.toLowerCase().includes(q) ||
        el.symbol.toLowerCase().includes(q) ||
        String(el.number) === q;
      btn.classList.toggle('dimmed', !match);
    }
  }

  _renderDetail(el) {
    if (!this.detailEl || !el) return;
    for (const item of this._cells || []) {
      item.btn.classList.toggle('active', item.el.number === el.number);
    }
    const cat = ELEMENT_CATEGORIES[el.category] || { label: el.category, color: '#3b82f6' };
    this.detailEl.innerHTML = `
      <div class="pt-detail-badge" style="--pt-cat:${cat.color}">
        <span class="pt-detail-num">${el.number}</span>
        <span class="pt-detail-sym">${el.symbol}</span>
      </div>
      <div class="pt-detail-meta">
        <div class="pt-detail-title">${el.name} <span class="pt-detail-cat" style="color:${cat.color}">${cat.label}</span></div>
        <div class="pt-detail-stats">
          <span><strong>${t('atomicNumber')}:</strong> ${el.number}</span>
          <span><strong>${t('atomicMass')}:</strong> ${el.mass} u</span>
          <span><strong>${t('electronConfig')}:</strong> <code>${el.config}</code></span>
        </div>
      </div>
    `;
  }
}
