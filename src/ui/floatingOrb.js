/**
 * Captnz Board — Nested Draggable Floating Circle Toolbox (Orb) Controller
 * Organizes Pens | Kits (Geometry & Chemistry) | Smart (Toggles & Offline OCR Packs)
 */

import { makeDraggable } from './draggable.js';
import { t } from '../i18n/translations.js';
import {
  CHEMISTRY_ARROW_STENCILS,
  CHEMISTRY_ORGANIC_STENCILS,
  LAB_APPARATUS_STENCILS,
} from '../kits/chemistryStencils.js';
import {
  REACTION_CONDITIONS,
  VSEPR_ORBITAL_STENCILS,
  formatChemistryHtml,
} from '../kits/chemistryKit.js';
import { LANGUAGE_PACKS } from '../smart/smartInkEngine.js';

const PERMANENT_BRUSHES = new Set([
  'technical',
  'calligraphy',
  'chalk',
  'pencil',
  'marker',
  'dashed',
  'highlighter',
]);

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
    onVanishFadeChange,
    onUndo,
    onRedo,
    onResetZoom,
    onTouchLockToggle,
    onGeometryToggle,
    onPlaceAxes,
    onPlaceChemStencil,
    onPlaceChemFormula,
    onPlaceChemCondition,
    onOpenPeriodicTable,
    onSmartToggleChange,
    onAddStickyNote,
    onDownloadOcrPack,
    onRemoveOcrPack,
    getOcrPackStatuses,
  }) {
    this.dock = document.getElementById('toolbox-orb-dock');
    this.btnToggle = document.getElementById('btn-orb-toggle');
    this.panel = document.getElementById('orb-panel');
    this.orbTabsEl = this.panel.querySelector('.orb-tabs');
    this.ring = document.getElementById('orb-color-ring');
    this.activeIcon = document.getElementById('orb-active-icon');
    this.sizeBadge = document.getElementById('orb-size-badge');
    this.lockBadge = document.getElementById('orb-lock-badge');
    this.btnTouchLock = document.getElementById('btn-touch-lock');
    this.touchLockIcon = document.getElementById('touch-lock-icon');
    this.btnResetZoom = document.getElementById('btn-reset-zoom');
    this.zoomReadoutText = document.getElementById('zoom-readout-text');
    this.slider = document.getElementById('stroke-size-slider');
    this.sizeVal = document.getElementById('stroke-size-val');
    this.sizeDot = document.getElementById('size-preview-dot');
    this.streamlineSlider = document.getElementById('streamline-slider');
    this.streamlineVal = document.getElementById('streamline-val');
    this.nibAngleRow = document.getElementById('nib-angle-row');
    this.nibAngleSlider = document.getElementById('nib-angle-slider');
    this.nibAngleVal = document.getElementById('nib-angle-val');
    this.dashStyleRow = document.getElementById('dash-style-row');
    this.vanishFadeRow = document.getElementById('vanish-fade-row');
    this.vanishFadeSlider = document.getElementById('vanish-fade-slider');
    this.vanishFadeVal = document.getElementById('vanish-fade-val');
    this.customColor = document.getElementById('custom-color-input');
    this.customColorWrap = this.customColor?.closest('.color-picker-wrap') || null;
    this.chemGrid = document.getElementById('chem-stencil-grid');
    this.formulaInput = document.getElementById('chem-formula-input');
    this.formulaPreview = document.getElementById('chem-formula-preview');
    this.ocrPacksList = document.getElementById('ocr-packs-list');

    this.onPlaceChemStencil = onPlaceChemStencil;
    this.onPlaceChemCondition = onPlaceChemCondition;
    this.onDownloadOcrPack = onDownloadOcrPack;
    this.onRemoveOcrPack = onRemoveOcrPack;
    this.getOcrPackStatuses = getOcrPackStatuses;

    this.isOpen = false;
    this.currentTool = 'calligraphy';
    this.currentColor = '#111827';
    this.touchLocked = false;
    this.activeTab = 'pens';
    this.activeKit = 'geometry';
    this.activeChemGroup = 'organic';
    this._packProgress = {};

    this.smartState = {
      quickShape: localStorage.getItem('captnz_smart_quickshape') !== 'false',
      vanishSlides: localStorage.getItem('captnz_smart_vanish_slides') === 'true',
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

    // Chemistry Group Sub-tabs (Rings | Arrows | VSEPR | Lab)
    this.panel.querySelectorAll('.chem-subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeChemGroup = btn.dataset.chem;
        this.panel.querySelectorAll('.chem-subtab-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.chem === this.activeChemGroup);
        });
        this._renderChemGrid();
      });
    });

    // Quick Chemistry Formula bar & Reaction Conditions
    this._initChemistryClassroomControls(onPlaceChemFormula);

    // Tool selection with PowerPoint-style toggle-off for permanent pens -> fallback to Vanishing Pen
    this.panel.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const clicked = btn.dataset.tool;
        const nextTool =
          clicked === this.currentTool && PERMANENT_BRUSHES.has(clicked) ? 'vanishing' : clicked;
        this.setTool(nextTool);
        onToolChange?.(nextTool);
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

    // Vanishing Fade Time slider & quick pills (1s-15s, default 4s)
    const savedVanishSec = Number(localStorage.getItem('captnz_vanish_sec') ?? 4);
    this.setVanishFade(savedVanishSec);
    onVanishFadeChange?.(savedVanishSec);
    this.vanishFadeSlider?.addEventListener('input', (e) => {
      const sec = Number(e.target.value);
      this.setVanishFade(sec);
      localStorage.setItem('captnz_vanish_sec', String(sec));
      onVanishFadeChange?.(sec);
    });
    this.panel.querySelectorAll('[data-vanish-sec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = Number(btn.dataset.vanishSec);
        this.setVanishFade(sec);
        localStorage.setItem('captnz_vanish_sec', String(sec));
        onVanishFadeChange?.(sec);
      });
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
    this._bindSmartSwitch('toggle-vanish-slides', 'vanishSlides', 'captnz_smart_vanish_slides', onSmartToggleChange);
    this._bindSmartSwitch('toggle-smart-ink', 'smartInk', 'captnz_smart_ink', onSmartToggleChange);
    this._bindSmartSwitch('toggle-sticky-grid', 'stickyGrid', 'captnz_smart_sticky_grid', onSmartToggleChange);
    [
      ['btn-quickshape-help', 'quickshape-hint'],
      ['btn-vanish-slides-help', 'vanish-slides-hint'],
      ['btn-smart-ink-help', 'smart-ink-hint'],
      ['btn-sticky-grid-help', 'sticky-grid-hint'],
    ].forEach(([btnId, hintId]) => {
      document.getElementById(btnId)?.addEventListener('click', (e) => {
        e.stopPropagation();
        const hintEl = document.getElementById(hintId);
        if (hintEl) {
          hintEl.classList.toggle('hidden');
          if (this.isOpen) this._alignPanelSide();
        }
      });
    });
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
    this.refreshOcrPacksUI();
    this.setTool(this.currentTool);
    this.setColor(this.currentColor);
    this.setSize(4);
    this.setZoom(1);
    this.setTouchLocked(false);
  }

  _initChemistryClassroomControls(onPlaceChemFormula) {
    if (this.formulaInput && this.formulaPreview) {
      const updatePreview = () => {
        const val = this.formulaInput.value.trim() || 'H2SO4';
        this.formulaPreview.innerHTML = formatChemistryHtml(val);
      };
      this.formulaInput.addEventListener('input', updatePreview);
      this.formulaInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = this.formulaInput.value.trim() || 'H2SO4';
          onPlaceChemFormula?.(val);
          this.close();
        }
      });
      document.getElementById('btn-place-formula')?.addEventListener('click', () => {
        const val = this.formulaInput.value.trim() || 'H2SO4';
        onPlaceChemFormula?.(val);
        this.close();
      });
    }

    const condRow = document.getElementById('chem-conditions-row');
    if (condRow) {
      condRow.innerHTML = '';
      for (const cond of REACTION_CONDITIONS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chem-cond-pill';
        btn.textContent = cond.label;
        btn.title = `Place condition: ${cond.label}`;
        btn.addEventListener('click', () => {
          this.onPlaceChemCondition?.(cond);
          this.close();
        });
        condRow.appendChild(btn);
      }
    }
  }

  async refreshOcrPacksUI() {
    if (!this.ocrPacksList || !this.getOcrPackStatuses) return;
    const statuses = await this.getOcrPackStatuses();
    this.ocrPacksList.innerHTML = '';

    for (const pack of LANGUAGE_PACKS) {
      const st = statuses[pack.code] || { installed: false };
      const prog = this._packProgress[pack.code];
      const cleanSize = pack.sizeHint.replace(/^~/, '');

      const row = document.createElement('div');
      row.className = 'ocr-pack-row';

      const label = document.createElement('span');
      label.className = 'ocr-pack-name';
      label.textContent =
        typeof prog === 'number'
          ? `${pack.name} • ${prog}%`
          : `${pack.name} • ${cleanSize}`;
      label.title = `${pack.name} (${pack.native})`;

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = `ocr-pack-btn${st.installed ? ' ready' : ''}`;
      actionBtn.disabled = typeof prog === 'number';
      if (typeof prog === 'number') {
        actionBtn.textContent = `${prog}%`;
      } else if (st.installed) {
        actionBtn.textContent = t('packReady');
        actionBtn.title = `${t('removePack')} ${pack.name}`;
      } else {
        actionBtn.textContent = t('downloadPack');
        actionBtn.title = `${t('downloadPack')} ${pack.name} (${cleanSize})`;
      }

      actionBtn.addEventListener('click', async () => {
        if (st.installed) {
          await this.onRemoveOcrPack?.(pack.code);
          this.refreshOcrPacksUI();
        } else {
          this._packProgress[pack.code] = 0;
          this.refreshOcrPacksUI();
          try {
            await this.onDownloadOcrPack?.(pack.code, (pct) => {
              this._packProgress[pack.code] = pct;
              label.textContent = `${pack.name} • ${pct}%`;
              actionBtn.textContent = `${pct}%`;
            });
          } finally {
            delete this._packProgress[pack.code];
            this.refreshOcrPacksUI();
          }
        }
      });

      row.appendChild(label);
      row.appendChild(actionBtn);
      this.ocrPacksList.appendChild(row);
    }
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
    apply('toggle-vanish-slides', this.smartState.vanishSlides);
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
    const tabOrder = { pens: 0, kits: 1, smart: 2 };
    this.orbTabsEl?.style.setProperty('--orb-tab-index', String(tabOrder[tab] ?? 0));
    this.panel.querySelectorAll('.orb-tab-btn').forEach((btn) => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    this.panel.querySelectorAll('.orb-tab-pane').forEach((pane) => {
      pane.classList.toggle('hidden', pane.dataset.pane !== tab);
    });
    if (tab === 'smart') this.refreshOcrPacksUI();
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
    let list = CHEMISTRY_ORGANIC_STENCILS;
    if (this.activeChemGroup === 'arrows') list = CHEMISTRY_ARROW_STENCILS;
    else if (this.activeChemGroup === 'vsepr') list = VSEPR_ORBITAL_STENCILS;
    else if (this.activeChemGroup === 'lab') list = LAB_APPARATUS_STENCILS;

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
    this.vanishFadeRow?.classList.toggle('hidden', tool !== 'vanishing');
    if (this.isOpen) this._alignPanelSide();
  }

  setColor(color) {
    this.currentColor = color;
    this.ring.style.borderColor = color;
    this.sizeDot.style.background = color;
    let matchedPreset = false;
    this.panel.querySelectorAll('.color-swatch').forEach((btn) => {
      const isMatch = btn.dataset.color.toLowerCase() === color.toLowerCase();
      if (isMatch) matchedPreset = true;
      btn.classList.toggle('active', isMatch);
    });
    if (this.customColorWrap) {
      this.customColorWrap.classList.toggle('active', !matchedPreset);
      if (!matchedPreset) {
        this.customColorWrap.style.setProperty('--custom-swatch', color);
      } else {
        this.customColorWrap.style.removeProperty('--custom-swatch');
      }
    }
  }

  setSize(size) {
    this.slider.value = String(size);
    this.sizeVal.textContent = `${size}px`;
    if (this.sizeBadge) this.sizeBadge.textContent = String(size);
    const dotPx = Math.max(4, Math.min(20, Math.round(size * 0.52) + 3));
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

  setVanishFade(sec) {
    if (this.vanishFadeSlider) this.vanishFadeSlider.value = String(sec);
    if (this.vanishFadeVal) this.vanishFadeVal.textContent = `${sec}s`;
    this.panel.querySelectorAll('[data-vanish-sec]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.vanishSec) === sec);
    });
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
      const key = this.touchLocked ? 'touchLockOn' : 'touchLockOff';
      const label = t(key);
      this.btnTouchLock.classList.toggle('active', this.touchLocked);
      this.btnTouchLock.setAttribute('aria-pressed', String(this.touchLocked));
      this.btnTouchLock.setAttribute('aria-label', label);
      this.btnTouchLock.title = label;
    }
    this.lockBadge?.classList.toggle('hidden', !this.touchLocked);
  }

  setZoomDisplay({ mode = 'fit-page', isPortrait = false, scale = 1 } = {}) {
    if (!this.btnResetZoom) return;
    const pct = `${Math.round(scale * 100)}%`;
    const targetEl = this.zoomReadoutText || this.btnResetZoom;
    this.btnResetZoom.classList.toggle('is-zoomed', Math.abs(scale - 1) > 0.02);
    if (isPortrait) {
      const nextKey = mode === 'fit-width' ? 'fitPage' : 'fitWidth';
      const nextLabel = t(nextKey);
      targetEl.setAttribute('data-i18n', nextKey);
      targetEl.textContent = nextLabel;
      this.btnResetZoom.title = `${nextLabel} (${pct}, Ctrl+0)`;
    } else {
      targetEl.removeAttribute('data-i18n');
      targetEl.textContent = Math.abs(scale - 1) < 0.03 ? '100%' : pct;
      this.btnResetZoom.title = `${t('fitPage')} (${pct}, Ctrl+0)`;
    }
  }
}
