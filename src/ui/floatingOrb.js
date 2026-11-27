/**
 * Captnz Board — Nested Draggable Floating Circle Toolbox (Orb) Controller
 * Organizes Pens | Kits (Geometry & Chemistry) | Smart (Explicit ON/OFF Toggles)
 */

import { makeDraggable } from './draggable.js';
import { t } from '../i18n/translations.js';
import {
  CHEMISTRY_ARROW_STENCILS,
  CHEMISTRY_ORGANIC_STENCILS,
  LAB_APPARATUS_STENCILS,
} from '../kits/chemistryStencils.js';

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
  constructor({
    onToolChange,
    onColorChange,
    onSizeChange,
    onStreamlineChange,
    onNibAngleChange,
    onDashStyleChange,
    onUndo,
    onRedo,
    onResetZoom,
    onTouchLockToggle,
    onGeometryToggle,
    onPlaceAxes,
    onPlaceChemStencil,
    onOpenPeriodicTable,
    onSmartToggleChange,
    onAddStickyNote,
  }) {
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
    this.streamlineSlider = document.getElementById('streamline-slider');
    this.streamlineVal = document.getElementById('streamline-val');
    this.nibAngleRow = document.getElementById('nib-angle-row');
    this.nibAngleSlider = document.getElementById('nib-angle-slider');
    this.nibAngleVal = document.getElementById('nib-angle-val');
    this.dashStyleRow = document.getElementById('dash-style-row');
    this.customColor = document.getElementById('custom-color-input');
    this.chemGrid = document.getElementById('chem-stencil-grid');

    this.onPlaceChemStencil = onPlaceChemStencil;

    this.isOpen = false;
    this.currentTool = 'calligraphy';
    this.currentColor = '#111827';
    this.touchLocked = false;
    this.activeTab = 'pens';
    this.activeKit = 'geometry';
    this.activeChemGroup = 'organic';

    // Smart toggles persisted in localStorage
    this.smartState = {
      quickShape: localStorage.getItem('captnz_smart_quickshape') !== 'false',
      smartInk: localStorage.getItem('captnz_smart_ink') === 'true',
      stickyGrid: localStorage.getItem('captnz_smart_sticky_grid') === 'true',
    };

    makeDraggable(this.dock, {
      storageKey: 'toolbox_orb',
      handleSelector: '#btn-orb-toggle',
      snapToEdge: true,
      edgeMargin: 16,
      onDragEnd: (rect) => this._alignPanelSide(rect),
    });

    this.btnToggle.addEventListener('click', () => this.toggle());

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

    // Top Segmented Tabs (Pens | Kits | Smart)
    this.panel.querySelectorAll('.orb-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tab));
    });

    // Nested Kits Sub-tabs (Geometry | Chemistry)
    this.panel.querySelectorAll('.kit-subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.setKitSubtab(btn.dataset.kit));
    });

    // Chemistry Group Sub-tabs (Rings & Bonds | Arrows | Lab Gear)
    this.panel.querySelectorAll('.chem-subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeChemGroup = btn.dataset.chem;
        this.panel.querySelectorAll('.chem-subtab-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.chem === this.activeChemGroup);
        });
        this._renderChemGrid();
      });
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

    // StreamLine stabilization slider (0-100%)
    const savedStreamline = Number(localStorage.getItem('captnz_streamline') ?? 35);
    this.setStreamline(savedStreamline);
    onStreamlineChange?.(savedStreamline);
    this.streamlineSlider?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      this.setStreamline(val);
      localStorage.setItem('captnz_streamline', String(val));
      onStreamlineChange?.(val);
    });

    // Calligraphy Nib Angle slider (30-45°)
    const savedNib = Number(localStorage.getItem('captnz_nib_angle') ?? 38);
    this.setNibAngle(savedNib);
    onNibAngleChange?.(savedNib);
    this.nibAngleSlider?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      this.setNibAngle(val);
      localStorage.setItem('captnz_nib_angle', String(val));
      onNibAngleChange?.(val);
    });

    // Dashed / Dotted pattern toggle
    this.panel.querySelectorAll('[data-dash]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const style = btn.dataset.dash;
        this.panel.querySelectorAll('[data-dash]').forEach((b) => {
          b.classList.toggle('active', b.dataset.dash === style);
        });
        onDashStyleChange?.(style);
      });
    });

    // Geometry Kit actions
    this.panel.querySelectorAll('[data-geo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const active = onGeometryToggle?.(btn.dataset.geo);
        btn.classList.toggle('active', Boolean(active));
      });
    });
    document.getElementById('btn-place-axes')?.addEventListener('click', () => {
      onPlaceAxes?.();
      this.close();
    });
    document.getElementById('btn-open-periodic')?.addEventListener('click', () => {
      this.close();
      onOpenPeriodicTable?.();
    });

    // Smart Tab ON/OFF switches
    this._bindSmartSwitch('toggle-quickshape', 'quickShape', 'captnz_smart_quickshape', onSmartToggleChange);
    this._bindSmartSwitch('toggle-smart-ink', 'smartInk', 'captnz_smart_ink', onSmartToggleChange);
    this._bindSmartSwitch('toggle-sticky-grid', 'stickyGrid', 'captnz_smart_sticky_grid', onSmartToggleChange);
    this._syncSmartUI();
    onSmartToggleChange?.({ ...this.smartState });

    // Sticky note quick-drop color buttons
    this.panel.querySelectorAll('.sticky-color-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        onAddStickyNote?.(btn.dataset.noteColor || '#fef08a');
        this.close();
      });
    });

    // Footer actions
    document.getElementById('btn-undo').addEventListener('click', () => onUndo?.());
    document.getElementById('btn-redo').addEventListener('click', () => onRedo?.());
    this.btnResetZoom.addEventListener('click', () => onResetZoom?.());

    this.btnTouchLock?.addEventListener('click', () => {
      this.setTouchLocked(!this.touchLocked);
      onTouchLockToggle?.(this.touchLocked);
    });

    this._renderChemGrid();
    this.setTool(this.currentTool);
    this.setColor(this.currentColor);
    this.setSize(4);
    this.setZoom(1);
    this.setTouchLocked(false);
  }

  _bindSmartSwitch(btnId, stateKey, storageKey, onSmartToggleChange) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      this.smartState[stateKey] = !this.smartState[stateKey];
      localStorage.setItem(storageKey, String(this.smartState[stateKey]));
      this._syncSmartUI();
      onSmartToggleChange?.({ ...this.smartState });
    });
  }

  _syncSmartUI() {
    const apply = (id, on) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('active', Boolean(on));
      el.setAttribute('aria-checked', String(Boolean(on)));
    };
    apply('toggle-quickshape', this.smartState.quickShape);
    apply('toggle-smart-ink', this.smartState.smartInk);
    apply('toggle-sticky-grid', this.smartState.stickyGrid);

    document.getElementById('smart-ink-status')?.classList.toggle('hidden', !this.smartState.smartInk);
    document.getElementById('sticky-tray')?.classList.toggle('hidden', !this.smartState.stickyGrid);
  }

  setSmartInkLast(label) {
    const el = document.getElementById('smart-ink-last');
    if (el) el.textContent = label || '—';
  }

  setGeometryToolState(toolName, active) {
    const btn = this.panel.querySelector(`[data-geo="${toolName}"]`);
    btn?.classList.toggle('active', Boolean(active));
  }

  setTab(tab) {
    this.activeTab = tab;
    this.panel.querySelectorAll('.orb-tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    this.panel.querySelectorAll('.orb-tab-pane').forEach((pane) => {
      pane.classList.toggle('hidden', pane.dataset.pane !== tab);
    });
    if (this.isOpen) this._alignPanelSide();
  }

  setKitSubtab(kit) {
    this.activeKit = kit;
    this.panel.querySelectorAll('.kit-subtab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.kit === kit);
    });
    this.panel.querySelectorAll('.kit-subpane').forEach((pane) => {
      pane.classList.toggle('hidden', pane.dataset.kitPane !== kit);
    });
    if (this.isOpen) this._alignPanelSide();
  }

  _renderChemGrid() {
    if (!this.chemGrid) return;
    const list =
      this.activeChemGroup === 'arrows'
        ? CHEMISTRY_ARROW_STENCILS
        : this.activeChemGroup === 'lab'
          ? LAB_APPARATUS_STENCILS
          : CHEMISTRY_ORGANIC_STENCILS;

    this.chemGrid.innerHTML = '';
    for (const item of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chem-stencil-btn';
      btn.title = item.label;
      btn.innerHTML = `
        <span class="chem-preview">${item.build('currentColor')}</span>
        <span class="chem-lbl">${item.label}</span>
      `;
      btn.addEventListener('click', () => {
        this.onPlaceChemStencil?.(item);
        this.close();
      });
      this.chemGrid.appendChild(btn);
    }
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

    const margin = 14;
    const orbCenterY = targetRect ? targetRect.top + targetRect.height / 2 : btnRect.top + btnRect.height / 2;
    const panelHeight = this.panel.offsetHeight || 440;
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
      this.panel.querySelector('.tool-btn[data-tool="calligraphy"]');
    const iconHtml = activeBtn?.querySelector('.tool-ico')?.innerHTML;
    if (iconHtml) {
      this.activeIcon.innerHTML = iconHtml;
    }
    this.panel.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    this.nibAngleRow?.classList.toggle('hidden', tool !== 'calligraphy');
    this.dashStyleRow?.classList.toggle('hidden', tool !== 'dashed');
    if (this.isOpen) this._alignPanelSide();
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

  setStreamline(pct) {
    if (this.streamlineSlider) this.streamlineSlider.value = String(pct);
    if (this.streamlineVal) this.streamlineVal.textContent = `${pct}%`;
  }

  setNibAngle(deg) {
    if (this.nibAngleSlider) this.nibAngleSlider.value = String(deg);
    if (this.nibAngleVal) this.nibAngleVal.textContent = `${deg}°`;
  }

  setZoom(scale = 1) {
    this.setZoomDisplay({ mode: 'fit-page', isPortrait: false, scale });
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

  setZoomDisplay({ mode = 'fit-page', isPortrait = false, scale = 1 } = {}) {
    if (!this.btnResetZoom) return;
    const pct = `${Math.round(scale * 100)}%`;
    this.btnResetZoom.classList.toggle('is-zoomed', Math.abs(scale - 1) > 0.02);
    if (isPortrait) {
      const nextKey = mode === 'fit-width' ? 'fitPage' : 'fitWidth';
      const nextLabel = t(nextKey);
      this.btnResetZoom.setAttribute('data-i18n', nextKey);
      this.btnResetZoom.textContent = nextLabel;
      this.btnResetZoom.title = `${nextLabel} (${pct}, Ctrl+0)`;
    } else {
      this.btnResetZoom.removeAttribute('data-i18n');
      this.btnResetZoom.textContent = Math.abs(scale - 1) < 0.03 ? '100%' : pct;
      this.btnResetZoom.title = `${t('fitPage')} (${pct}, Ctrl+0)`;
    }
  }
}
