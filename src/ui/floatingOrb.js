/**
 * Captnz Board — Draggable Floating Circle Toolbox (Orb) Controller
 */

import { makeDraggable } from './draggable.js';
import { t } from '../i18n/translations.js';

const HAND_ICON_PATHS = `
  <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
  <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
  <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
  <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
`;

const LOCK_ICON_PATHS = `
  <rect x="4" y="11" width="16" height="10" rx="2" />
  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
`;

export class FloatingOrb {
  constructor({ onToolChange, onColorChange, onSizeChange, onUndo, onRedo, onResetZoom, onTouchLockToggle }) {
    this.dock = document.getElementById('toolbox-orb-dock');
    this.btnToggle = document.getElementById('btn-orb-toggle');
    this.panel = document.getElementById('orb-panel');
    this.ring = document.getElementById('orb-color-ring');
    this.activeIcon = document.getElementById('orb-active-icon');
    this.sizeBadge = document.getElementById('orb-size-badge');
    this.lockBadge = document.getElementById('orb-lock-badge');
    this.btnTouchLock = document.getElementById('btn-touch-lock');
    this.touchLockIcon = document.getElementById('touch-lock-icon');
    this.btnResetZoom = document.getElementById('btn-reset-zoom');
    this.slider = document.getElementById('stroke-size-slider');
    this.sizeVal = document.getElementById('stroke-size-val');
    this.sizeDot = document.getElementById('size-preview-dot');
    this.customColor = document.getElementById('custom-color-input');

    this.isOpen = false;
    this.currentTool = 'fountain';
    this.currentColor = '#111827';
    this.touchLocked = false;

    // Make Orb draggable and magnetically snap to the nearest left/right screen edge
    makeDraggable(this.dock, {
      storageKey: 'toolbox_orb',
      handleSelector: '#btn-orb-toggle',
      snapToEdge: true,
      edgeMargin: 16,
      onDragEnd: (rect) => this._alignPanelSide(rect),
    });

    this.btnToggle.addEventListener('click', () => this.toggle());

    // Auto-collapse expanded toolbox as soon as user starts drawing on the canvas
    const boardViewport = document.getElementById('board-viewport');
    boardViewport?.addEventListener(
      'pointerdown',
      (e) => {
        if (this.isOpen && !this.dock.contains(e.target)) {
          this.close();
        }
      },
      { capture: true }
    );

    window.addEventListener('resize', () => {
      if (this.isOpen) this._alignPanelSide();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    // Tool selection
    this.panel.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        this.setTool(tool);
        onToolChange?.(tool);
      });
    });

    // Quick color swatches
    this.panel.querySelectorAll('.color-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        this.setColor(color);
        onColorChange?.(color);
      });
    });

    // Custom color picker
    this.customColor.addEventListener('input', (e) => {
      this.setColor(e.target.value);
      onColorChange?.(e.target.value);
    });

    // Stroke thickness slider
    this.slider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      this.setSize(val);
      onSizeChange?.(val);
    });

    document.getElementById('btn-undo').addEventListener('click', () => onUndo?.());
    document.getElementById('btn-redo').addEventListener('click', () => onRedo?.());
    this.btnResetZoom.addEventListener('click', () => onResetZoom?.());

    this.btnTouchLock?.addEventListener('click', () => {
      this.setTouchLocked(!this.touchLocked);
      onTouchLockToggle?.(this.touchLocked);
    });

    this.setTool(this.currentTool);
    this.setColor(this.currentColor);
    this.setSize(4);
    this.setZoom(1);
    this.setTouchLocked(false);
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.panel.classList.toggle('hidden', !this.isOpen);
    this.btnToggle.setAttribute('aria-expanded', String(this.isOpen));
    if (this.isOpen) this._alignPanelSide();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.classList.add('hidden');
    this.btnToggle.setAttribute('aria-expanded', 'false');
  }

  _alignPanelSide(targetRect = null) {
    const btnRect = this.btnToggle.getBoundingClientRect();
    const orbCenterX = targetRect ? targetRect.left + targetRect.width / 2 : btnRect.left + btnRect.width / 2;
    const openRight = targetRect?.side
      ? targetRect.side === 'left'
      : orbCenterX < window.innerWidth * 0.5;
    this.panel.classList.toggle('open-right', openRight);

    if (!this.isOpen) return;

    // Keep expanded panel vertically clamped inside the viewport regardless of orb dock height
    const margin = 14;
    const orbCenterY = targetRect ? targetRect.top + targetRect.height / 2 : btnRect.top + btnRect.height / 2;
    const panelHeight = this.panel.offsetHeight || 420;
    const halfPanel = panelHeight / 2;
    let shiftY = 0;

    if (orbCenterY - halfPanel < margin) {
      shiftY = margin - (orbCenterY - halfPanel);
    } else if (orbCenterY + halfPanel > window.innerHeight - margin) {
      shiftY = window.innerHeight - margin - (orbCenterY + halfPanel);
    }

    this.panel.style.setProperty('--panel-shift-y', `${Math.round(shiftY)}px`);
  }

  setTool(tool) {
    this.currentTool = tool;
    const activeBtn =
      this.panel.querySelector(`.tool-btn[data-tool="${tool}"]`) ||
      this.panel.querySelector('.tool-btn[data-tool="fountain"]');
    const iconHtml = activeBtn?.querySelector('.tool-ico')?.innerHTML;
    if (iconHtml) {
      this.activeIcon.innerHTML = iconHtml;
    }
    this.panel.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  setColor(color) {
    this.currentColor = color;
    this.ring.style.borderColor = color;
    this.sizeDot.style.background = color;
    this.panel.querySelectorAll('.color-swatch').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.color.toLowerCase() === color.toLowerCase());
    });
  }

  setSize(size) {
    this.slider.value = String(size);
    this.sizeVal.textContent = String(size);
    if (this.sizeBadge) this.sizeBadge.textContent = String(size);
    const dotPx = Math.max(4, Math.min(24, size));
    this.sizeDot.style.width = `${dotPx}px`;
    this.sizeDot.style.height = `${dotPx}px`;
  }

  setZoom(scale = 1) {
    if (!this.btnResetZoom) return;
    const pct = Math.round(scale * 100);
    this.btnResetZoom.textContent = `${pct}%`;
    this.btnResetZoom.classList.toggle('is-zoomed', Math.abs(scale - 1) > 0.01);
  }

  setTouchLocked(locked) {
    this.touchLocked = Boolean(locked);
    this.btnToggle?.classList.toggle('touch-locked', this.touchLocked);
    if (this.touchLockIcon) {
      this.touchLockIcon.innerHTML = this.touchLocked ? LOCK_ICON_PATHS : HAND_ICON_PATHS;
    }
    if (this.btnTouchLock) {
      this.btnTouchLock.classList.toggle('active', this.touchLocked);
      this.btnTouchLock.setAttribute('aria-pressed', String(this.touchLocked));
      const labelEl = this.btnTouchLock.querySelector('[data-i18n]');
      if (labelEl) {
        const key = this.touchLocked ? 'touchLockOn' : 'touchLockOff';
        labelEl.setAttribute('data-i18n', key);
        labelEl.textContent = t(key);
      }
    }
    this.lockBadge?.classList.toggle('hidden', !this.touchLocked);
  }
}
