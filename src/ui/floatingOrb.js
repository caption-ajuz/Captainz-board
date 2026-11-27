/**
 * Captnz Board — Draggable Floating Circle Toolbox (Orb) Controller
 */

import { makeDraggable } from './draggable.js';
import { t } from '../i18n/translations.js';

const TOOL_ICONS = {
  fountain: '✒️',
  ballpoint: '🖊️',
  calligraphy: '🖋️',
  highlighter: '🖍️',
  pencil: '✏️',
  vanishing: '✨',
  'laser-red': '🔴',
  'laser-blue': '🔵',
  'eraser-stroke': '🧹',
  'eraser-pixel': '🧽',
  lasso: '✂️',
  shape: '⬠',
};

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
    document.getElementById('btn-reset-zoom').addEventListener('click', () => onResetZoom?.());

    this.btnTouchLock?.addEventListener('click', () => {
      this.setTouchLocked(!this.touchLocked);
      onTouchLockToggle?.(this.touchLocked);
    });

    this.setColor(this.currentColor);
    this.setSize(4);
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
    const openRight = targetRect?.side
      ? targetRect.side === 'left'
      : (targetRect?.left ?? this.btnToggle.getBoundingClientRect().left) < window.innerWidth * 0.45;
    this.panel.classList.toggle('open-right', openRight);
  }

  setTool(tool) {
    this.currentTool = tool;
    this.activeIcon.textContent = TOOL_ICONS[tool] || '✒️';
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

  setTouchLocked(locked) {
    this.touchLocked = Boolean(locked);
    this.btnToggle?.classList.toggle('touch-locked', this.touchLocked);
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
