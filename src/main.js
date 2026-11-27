/**
 * Captnz Board — Main Application Bootstrap
 * Coordinates 4K DPR canvas scaling, Procreate-style InkEngine, GestureManager,
 * Offline Smart Ink OCR (EN/ML/AR), Quick Chemistry & Geometry Kits, .cboard Projects,
 * Open Recent Files, Windows "Open with" integration, PageManager, and Floating UI.
 */

import './styles/main.css';
import { applyLanguage, getLanguage, t } from './i18n/translations.js';
import { getOptimalDpr, InkEngine } from './engine/inkEngine.js';
import { GestureManager } from './engine/gestureManager.js';
import { LassoSnipTool } from './engine/lassoSnip.js';
import { SmartInkRecognizer } from './engine/smartInk.js';
import { OfflineSmartInkEngine } from './smart/smartInkEngine.js';
import { PageManager } from './document/pageManager.js';
import {
  isTauriRuntime,
  loadPdfFromBytes,
  openFileFromPath,
  pickAndImportImage,
  pickAndOpenPdf,
  pickAndOpenPpt,
} from './document/fileImporter.js';
import { loadCboardFromBytes, pickAndOpenCboard, saveCboardProject } from './document/cboardFormat.js';
import { exportSessionToPdf } from './document/pdfExporter.js';
import { RecoveryStore } from './document/recoveryStore.js';
import {
  getRecentFiles,
  loadRecentSnapshot,
  recordRecentFile,
  removeRecentFile,
} from './document/recentFiles.js';
import { buildCoordinateAxesSvg } from './kits/chemistryStencils.js';
import { buildChemistryFormulaSvg } from './kits/chemistryKit.js';
import { GeometryKitManager } from './kits/geometryTools.js';
import { createElementBadgeSvg } from './data/periodicTable.js';
import { SlideDrawer } from './ui/drawer.js';
import { FloatingOrb } from './ui/floatingOrb.js';
import { NavControls } from './ui/navControls.js';
import { PeriodicTableModal } from './ui/periodicModal.js';

const PERMANENT_BRUSHES = new Set([
  'technical',
  'calligraphy',
  'chalk',
  'pencil',
  'marker',
  'dashed',
  'highlighter',
]);

const viewport = document.getElementById('board-viewport');
const transformLayer = document.getElementById('board-transform-layer');
const bgCanvas = document.getElementById('bg-canvas');
const highlighterCanvas = document.getElementById('highlighter-canvas');
const inkCanvas = document.getElementById('ink-canvas');
const activeCanvas = document.getElementById('active-canvas');
const stampLayer = document.getElementById('stamp-layer');
const geometryLayer = document.getElementById('geometry-layer');
const toastEl = document.getElementById('toast');

let toastTimer = null;
function showToast(msg, duration = 2200) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

// High-DPI 4K canvas sizing (capped to 4K pixel budget to prevent RAM bloat)
function resizeCanvases(zoomScale = 1) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = getOptimalDpr(w, h, zoomScale);
  for (const c of [bgCanvas, highlighterCanvas, inkCanvas, activeCanvas]) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.dataset.dpr = String(dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return dpr;
}

function resizeInkCanvasesForZoom(zoomScale = 1) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const nextDpr = getOptimalDpr(w, h, zoomScale);
  const prevDpr = Number(inkCanvas.dataset?.dpr) || 1;
  if (Math.abs(nextDpr - prevDpr) < 0.08) return false;
  for (const c of [highlighterCanvas, inkCanvas, activeCanvas]) {
    c.width = Math.round(w * nextDpr);
    c.height = Math.round(h * nextDpr);
    c.dataset.dpr = String(nextDpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }
  inkEngine.setDpr(nextDpr);
  return true;
}

resizeCanvases();

const recoveryStore = new RecoveryStore();
const offlineOcr = new OfflineSmartInkEngine();
let pageManager = null;
let orb = null;
let drawer = null;

// Offline Smart Ink local recognition hook
const smartInk = new SmartInkRecognizer({
  onRecognized: (res) => {
    orb?.setSmartInkLast(`${res.label} (${Math.round(res.confidence * 100)}%)`);
  },
});

// 1. Ink Engine
const inkEngine = new InkEngine({
  inkCanvas,
  highlighterCanvas,
  activeCanvas,
  onStrokeCommitted: (stroke) => {
    pageManager.addStroke(stroke);
    smartInk.analyzeStroke(stroke);
    recoveryStore.scheduleSave(pageManager);
  },
  onStrokeErased: (pt, radius) => {
    const removed = pageManager.eraseStrokeAt(pt, radius);
    if (removed) {
      inkEngine.redrawPageStrokes(pageManager.getCurrentPage().strokes);
      recoveryStore.scheduleSave(pageManager);
    }
  },
  onShapeSnapped: () => {
    showToast(t('toastShapeSnapped'), 1100);
  },
});

function removeStrokesInsideBounds(page, bounds) {
  if (!page?.strokes?.length) return false;
  const before = page.strokes.length;
  page.strokes = page.strokes.filter((s) => {
    if (!s.points || s.points.length === 0) return true;
    let hits = 0;
    for (const p of s.points) {
      if (
        p.x >= bounds.x - 10 &&
        p.x <= bounds.x + bounds.w + 10 &&
        p.y >= bounds.y - 10 &&
        p.y <= bounds.y + bounds.h + 10
      ) {
        hits += 1;
      }
    }
    return hits / s.points.length < 0.55;
  });
  return page.strokes.length !== before;
}

// 2. Lasso Snip, To-Text OCR & Interactive Stamp/Sticky-Note Layer
const lassoTool = new LassoSnipTool({
  bgCanvas,
  highlighterCanvas,
  inkCanvas,
  activeCanvas,
  stampLayer,
  actionsEl: document.getElementById('lasso-actions'),
  onPasteHere: (snip) => {
    const page = pageManager.getCurrentPage();
    page.stamps.push(snip);
    refreshStamps();
    recoveryStore.scheduleSave(pageManager);
  },
  onSendToNewPage: (snip) => {
    pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
    const newPage = pageManager.insertBlankAfterCurrent();
    snip.x = Math.max(40, (window.innerWidth - snip.w) / 2);
    snip.y = Math.max(40, (window.innerHeight - snip.h) / 2);
    newPage.stamps.push(snip);
    refreshStamps();
    showToast(t('toastBlankInserted'));
    recoveryStore.scheduleSave(pageManager);
  },
  onConvertToText: async (bounds) => {
    try {
      showToast('Recognizing...', 1800);
      const { text, langCode } = await offlineOcr.recognizeInkBounds(
        inkCanvas,
        bounds,
        getLanguage(),
        inkEngine.isDarkBackground
      );
      if (!text) {
        showToast(t('toastOcrNoText'), 2400);
        return;
      }
      const page = pageManager.getCurrentPage();
      if (removeStrokesInsideBounds(page, bounds)) {
        inkEngine.redrawPageStrokes(page.strokes);
      }
      page.stamps = page.stamps || [];
      page.stamps.push({
        id: `txt_${Date.now()}`,
        kind: 'text',
        text,
        lang: langCode,
        dir: langCode === 'ara' ? 'rtl' : 'ltr',
        color: inkEngine.isDarkBackground ? '#f8fafc' : '#111827',
        fontSize: Math.max(18, Math.min(34, Math.round(bounds.h * 0.28))),
        x: bounds.x,
        y: bounds.y,
        w: Math.max(180, bounds.w + 24),
        h: Math.max(76, bounds.h + 18),
        rot: 0,
      });
      refreshStamps();
      orb?.setSmartInkLast(`OCR (${langCode})`);
      showToast(t('toastOcrConverted'), 1600);
      recoveryStore.scheduleSave(pageManager);
    } catch (err) {
      if (err?.code === 'NO_PACK_INSTALLED' || err?.message === 'NO_PACK_INSTALLED') {
        showToast(t('toastOcrNoPack'), 3200);
      } else {
        showToast(err?.message || 'Could not recognize ink', 3000);
      }
    }
  },
});

// 3. Session Helpers
function performUndo(announce = false) {
  if (pageManager.undo()) {
    inkEngine.redrawPageStrokes(pageManager.getCurrentPage().strokes);
    recoveryStore.scheduleSave(pageManager);
    if (announce) showToast(t('undo'), 900);
    return true;
  }
  return false;
}

function performRedo(announce = false) {
  if (pageManager.redo()) {
    inkEngine.redrawPageStrokes(pageManager.getCurrentPage().strokes);
    recoveryStore.scheduleSave(pageManager);
    if (announce) showToast(t('redo'), 900);
    return true;
  }
  return false;
}

function refreshStamps() {
  const page = pageManager.getCurrentPage();
  lassoTool.renderStamps(page.stamps || [], {
    getScale: () => gestureManager.getTransform().scale,
    getGridSnap: () => Boolean(orb?.smartState?.stickyGrid),
    onChange: () => recoveryStore.scheduleSave(pageManager),
    onDelete: (id) => {
      page.stamps = page.stamps.filter((s) => s.id !== id);
      refreshStamps();
      recoveryStore.scheduleSave(pageManager);
    },
  });
}

function placeStampCentered(stamp) {
  const page = pageManager.getCurrentPage();
  if (!page) return;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const offset = ((page.stamps?.length || 0) % 5) * 16;
  page.stamps = page.stamps || [];
  page.stamps.push({
    ...stamp,
    x: Math.round(cx - stamp.w / 2 + offset),
    y: Math.round(cy - stamp.h / 2 + offset),
  });
  refreshStamps();
  recoveryStore.scheduleSave(pageManager);
}

// 4. Gesture Manager (Single-touch draw/pan, 2-finger pinch/pan, 2/3-finger tap Undo/Redo, Palm Eraser)
let currentLayout = null;
let currentViewMode = 'fit-page';
let lastRenderedZoom = 1;

function getFitWidthTransform(layout) {
  const cssW = window.innerWidth || 1920;
  const targetW = cssW * 0.75;
  const targetScale = Math.max(1, Math.min(3.5, targetW / Math.max(layout.width, 1)));
  const tx = cssW / 2 - (layout.x + layout.width / 2) * targetScale;
  const ty = 24 - layout.y * targetScale;
  return { scale: targetScale, tx, ty };
}

function applySmartPageView(layout, { animate = false } = {}) {
  if (!layout) return;
  currentLayout = layout;
  if (layout.isPortrait) {
    currentViewMode = 'fit-width';
    gestureManager.setViewTransform(getFitWidthTransform(layout), animate);
  } else {
    currentViewMode = 'fit-page';
    gestureManager.setViewTransform({ scale: 1, tx: 0, ty: 0 }, animate);
  }
  orb?.setZoomDisplay({
    mode: currentViewMode,
    isPortrait: layout.isPortrait,
    scale: gestureManager.getTransform().scale,
  });
}

function toggleZoomView() {
  if (currentLayout?.isPortrait) {
    currentViewMode = currentViewMode === 'fit-width' ? 'fit-page' : 'fit-width';
    const next =
      currentViewMode === 'fit-width'
        ? getFitWidthTransform(currentLayout)
        : { scale: 1, tx: 0, ty: 0 };
    gestureManager.setViewTransform(next, true);
  } else {
    currentViewMode = 'fit-page';
    gestureManager.setViewTransform({ scale: 1, tx: 0, ty: 0 }, true);
  }
}

const gestureManager = new GestureManager({
  viewport,
  transformLayer,
  onTransformChange: ({ scale }) => {
    orb?.setZoomDisplay({
      mode: currentViewMode,
      isPortrait: Boolean(currentLayout?.isPortrait),
      scale,
    });
  },
  onZoomEnd: async ({ scale }) => {
    const page = pageManager?.getCurrentPage();
    if (!page) return;
    if (resizeInkCanvasesForZoom(scale)) {
      inkEngine.redrawPageStrokes(page.strokes);
    }
    if (page.type === 'pdf' && Math.abs(scale - lastRenderedZoom) > 0.12) {
      lastRenderedZoom = scale;
      await pageManager.renderPageBackground(page, bgCanvas, null, scale);
    }
  },
  onDrawStart: (pt, overrideTool) => {
    orb.close();
    if (inkEngine.tool === 'lasso' && !overrideTool) {
      lassoTool.begin(pt);
      return;
    }
    inkEngine.beginStroke(pt, overrideTool);
  },
  onDrawMove: (pts) => {
    if (inkEngine.tool === 'lasso' && !gestureManager.isPalmErasing) {
      lassoTool.extend(pts);
      return;
    }
    inkEngine.extendStroke(pts);
  },
  onDrawEnd: () => {
    if (inkEngine.tool === 'lasso' && !gestureManager.isPalmErasing) {
      lassoTool.end();
      return;
    }
    inkEngine.endStroke();
  },
  onDrawCancel: () => {
    inkEngine.cancelStroke();
    lassoTool.clearSelection();
  },
  onTwoFingerTap: () => performUndo(true),
  onThreeFingerTap: () => performRedo(true),
});

// 5. Geometry Kit & Offline Periodic Table Modal
const geometryKit = new GeometryKitManager({
  layerEl: geometryLayer,
  inkEngine,
  getScale: () => gestureManager.getTransform().scale,
  getActiveStyle: () => ({
    tool: inkEngine.tool,
    dashStyle: inkEngine.dashStyle,
    color: inkEngine.color,
    size: inkEngine.size,
  }),
  onToolToggled: (toolName, active) => {
    orb?.setGeometryToolState(toolName, active);
  },
});

const periodicModal = new PeriodicTableModal({
  onPlaceElement: (el) => {
    placeStampCentered({
      id: `elem_${el.symbol}_${Date.now()}`,
      kind: 'svg',
      label: `${el.number} ${el.symbol}`,
      svgMarkup: createElementBadgeSvg(el),
      w: 140,
      h: 156,
      rot: 0,
    });
  },
});

function getKitStrokeColor() {
  return inkEngine.isDarkBackground && inkEngine.color.toLowerCase() === '#111827'
    ? '#f8fafc'
    : inkEngine.color;
}

// 6. Nested Floating Circle Toolbox (Orb)
orb = new FloatingOrb({
  onToolChange: (tool) => {
    lassoTool.clearSelection();
    gestureManager.setPanMode(tool === 'hand');
    if (tool !== 'hand') {
      inkEngine.setTool(tool);
    }
  },
  onColorChange: (color) => inkEngine.setColor(color),
  onSizeChange: (size) => inkEngine.setSize(size),
  onStreamlineChange: (pct) => inkEngine.setStreamline(pct),
  onNibAngleChange: (deg) => inkEngine.setNibAngle(deg),
  onDashStyleChange: (style) => inkEngine.setDashStyle(style),
  onVanishFadeChange: (sec) => inkEngine.setVanishDuration(sec),
  onUndo: () => performUndo(false),
  onRedo: () => performRedo(false),
  onResetZoom: () => toggleZoomView(),
  onTouchLockToggle: (locked) => {
    gestureManager.setTouchLocked(locked);
    showToast(t(locked ? 'toastTouchLocked' : 'toastTouchUnlocked'), 1500);
  },
  onGeometryToggle: (toolName) => geometryKit.toggle(toolName),
  onPlaceAxes: () => {
    const strokeColor = inkEngine.isDarkBackground ? '#f8fafc' : '#111827';
    placeStampCentered({
      id: `axes_${Date.now()}`,
      kind: 'svg',
      label: 'Coordinate Axes',
      svgMarkup: buildCoordinateAxesSvg(strokeColor),
      w: 320,
      h: 320,
      rot: 0,
    });
  },
  onPlaceChemStencil: (stencil) => {
    placeStampCentered({
      id: `chem_${stencil.id}_${Date.now()}`,
      kind: 'svg',
      label: stencil.label,
      svgMarkup: stencil.build(getKitStrokeColor()),
      w: stencil.w,
      h: stencil.h,
      rot: 0,
    });
  },
  onPlaceChemFormula: (raw) => {
    const built = buildChemistryFormulaSvg(raw, getKitStrokeColor(), inkEngine.isDarkBackground);
    if (!built) return;
    placeStampCentered({
      id: `formula_${Date.now()}`,
      kind: 'svg',
      label: raw,
      svgMarkup: built.svgMarkup,
      w: built.w,
      h: built.h,
      rot: 0,
    });
  },
  onPlaceChemCondition: (cond) => {
    const built = buildChemistryFormulaSvg(cond.ascii, getKitStrokeColor(), inkEngine.isDarkBackground);
    if (!built) return;
    placeStampCentered({
      id: `cond_${cond.id}_${Date.now()}`,
      kind: 'svg',
      label: cond.label,
      svgMarkup: built.svgMarkup,
      w: Math.max(96, Math.round(built.w * 0.78)),
      h: 48,
      rot: 0,
    });
  },
  onOpenPeriodicTable: () => periodicModal.open(),
  onSmartToggleChange: (state) => {
    inkEngine.setQuickShapeEnabled(state.quickShape);
    smartInk.setEnabled(state.smartInk);
  },
  onAddStickyNote: (color) => {
    placeStampCentered({
      id: `note_${Date.now()}`,
      kind: 'sticky',
      color,
      text: '',
      w: 220,
      h: 180,
      rot: 0,
    });
  },
  onDownloadOcrPack: async (code, onProgress) => {
    try {
      await offlineOcr.downloadPack(code, onProgress);
      showToast(`${code.toUpperCase()} ${t('packReady')}`, 2000);
    } catch (err) {
      showToast(err?.message || 'Pack download failed', 3500);
    }
  },
  onRemoveOcrPack: async (code) => {
    await offlineOcr.removePack(code);
  },
  getOcrPackStatuses: () => offlineOcr.getAllPackStatuses(),
});

// 7. Navigation Controls (< > +)
const navControls = new NavControls({
  onPrev: () => {
    pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
    pageManager.prevPage();
  },
  onNext: () => {
    pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
    pageManager.nextPage();
  },
  onAddBlank: () => {
    pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
    pageManager.insertBlankAfterCurrent();
    showToast(t('toastBlankInserted'));
    recoveryStore.scheduleSave(pageManager);
  },
});

async function openRecentItem(item) {
  try {
    if (item.path && isTauriRuntime()) {
      await handleOpenFilePath(item.path);
      return;
    }
    const snap = await loadRecentSnapshot(item.id);
    if (!snap) {
      showToast('Recent file snapshot is no longer cached', 2800);
      return;
    }
    if (snap.kind === 'cboard' && snap.bytes) {
      await loadCboardFromBytes(new Uint8Array(snap.bytes), pageManager);
      showToast(`${t('toastProjectLoaded')}: ${snap.name}`);
    } else if (snap.kind === 'pdf' && snap.bytes) {
      const rawBytes = new Uint8Array(snap.bytes);
      const pdfDoc = await loadPdfFromBytes(rawBytes);
      pageManager.loadPdfDocument(`pdf_${Date.now()}`, pdfDoc, rawBytes, true);
      showToast(`${t('toastPdfLoaded')}: ${snap.name}`);
    } else if (snap.kind === 'image' && snap.dataUrl) {
      pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
      pageManager.addImagePage(snap.dataUrl);
      showToast(`${t('toastImageAdded')}: ${snap.name}`);
    }
    recoveryStore.scheduleSave(pageManager);
  } catch (err) {
    showToast(err?.message || 'Could not reopen recent file', 3200);
  }
}

// 8. Slide Drawer
drawer = new SlideDrawer({
  getRecentFiles,
  onOpenRecent: openRecentItem,
  onRemoveRecent: removeRecentFile,
  onBeforeOpen: () => {
    pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
    drawer.renderThumbnails(pageManager.pages, pageManager.currentIndex);
  },
  onRequestThumbnail: (page) => pageManager.renderThumbnailForPage(page),
  onSelectPage: (idx) => {
    pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
    pageManager.goToPage(idx);
  },
  onDeletePage: (idx) => {
    pageManager.deletePage(idx);
    drawer.renderThumbnails(pageManager.pages, pageManager.currentIndex);
    recoveryStore.scheduleSave(pageManager);
  },
  onBackgroundChange: async (bg) => {
    pageManager.setBackground(bg);
    const isDark = bg === 'blackboard';
    inkEngine.setDarkBackground(isDark);
    lassoTool.setDarkBackground(isDark);
    if (isDark && orb.currentColor.toLowerCase() === '#111827') {
      orb.setColor('#ffffff');
      inkEngine.setColor('#ffffff');
    } else if (!isDark && orb.currentColor.toLowerCase() === '#ffffff') {
      orb.setColor('#111827');
      inkEngine.setColor('#111827');
    }
    await pageManager.renderPageBackground(pageManager.getCurrentPage());
    recoveryStore.scheduleSave(pageManager);
  },
  onPalmToggle: (mode) => gestureManager.setPalmMode(mode),
  onClearPage: () => {
    pageManager.clearCurrentPageInk();
    inkEngine.redrawPageStrokes([]);
    refreshStamps();
    showToast(t('toastCleared'));
    recoveryStore.scheduleSave(pageManager);
  },
  onNewBoard: () => {
    pageManager.createBlankSession();
    recoveryStore.clear();
  },
  onOpenCboard: async () => {
    try {
      const res = await pickAndOpenCboard(pageManager);
      if (!res) return;
      await recordRecentFile({ name: res.name, kind: 'cboard', path: res.path, bytes: res.bytes });
      drawer.renderRecentFiles();
      showToast(`${t('toastProjectLoaded')}: ${res.name}`);
      recoveryStore.scheduleSave(pageManager);
    } catch (err) {
      showToast(err?.message || 'Could not open .cboard project', 3500);
    }
  },
  onSaveCboard: async () => {
    try {
      const res = await saveCboardProject(pageManager);
      if (!res) return;
      await recordRecentFile({ name: res.name, kind: 'cboard', path: res.path, bytes: res.bytes });
      drawer.renderRecentFiles();
      showToast(t('toastProjectSaved'));
    } catch (err) {
      showToast(err?.message || 'Could not save .cboard project', 3500);
    }
  },
  onOpenPdf: async () => {
    try {
      const res = await pickAndOpenPdf();
      if (!res) return;
      pageManager.loadPdfDocument(`pdf_${Date.now()}`, res.pdfDoc, res.rawBytes, true);
      await recordRecentFile({ name: res.name, kind: 'pdf', path: res.path, bytes: res.rawBytes });
      drawer.renderRecentFiles();
      showToast(`${t('toastPdfLoaded')}: ${res.name}`);
      recoveryStore.scheduleSave(pageManager);
    } catch (err) {
      showToast(err?.message || 'Could not open PDF', 3500);
    }
  },
  onOpenPpt: async () => {
    try {
      const res = await pickAndOpenPpt();
      if (!res) return;
      if (res.mode === 'pdf') {
        pageManager.loadPdfDocument(`ppt_${Date.now()}`, res.pdfDoc, res.rawBytes, true);
        showToast(`${t('toastPptLoaded')}: ${res.name}`);
      } else {
        pageManager.loadFallbackPptSlides(res.slides);
        showToast(t('toastPptFallback'), 3000);
      }
      await recordRecentFile({ name: res.name, kind: 'ppt', path: res.path });
      drawer.renderRecentFiles();
      recoveryStore.scheduleSave(pageManager);
    } catch (err) {
      showToast(err?.message || 'Could not open presentation', 4000);
    }
  },
  onImportImage: async () => {
    try {
      const res = await pickAndImportImage();
      if (!res) return;
      pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
      pageManager.addImagePage(res.dataUrl);
      await recordRecentFile({ name: res.name, kind: 'image', path: res.path, dataUrl: res.dataUrl });
      drawer.renderRecentFiles();
      showToast(t('toastImageAdded'));
      recoveryStore.scheduleSave(pageManager);
    } catch (err) {
      showToast(err?.message || 'Could not import image', 3500);
    }
  },
  onExportPdf: async () => {
    try {
      showToast(t('toastExporting'), 5000);
      const ok = await exportSessionToPdf(pageManager, inkEngine);
      if (ok) showToast(t('toastExportSuccess'), 2800);
    } catch (err) {
      showToast(err?.message || 'Export failed', 3500);
    }
  },
});

// 9. Page Manager
pageManager = new PageManager({
  bgCanvas,
  onPageChanged: async (page, idx) => {
    lassoTool.clearSelection();
    inkEngine.clearTransient();
    drawer?.setActiveBackground(page.background || 'white');
    const isDark = page.background === 'blackboard';
    inkEngine.setDarkBackground(isDark);
    lassoTool.setDarkBackground(isDark);

    // Optional PowerPoint-style behavior: default to Vanishing Ink on PDF/PPT/Image slides
    const isSlideOrPdf = page.type === 'pdf' || page.type === 'pptx-fallback' || page.type === 'image';
    if (isSlideOrPdf && orb?.smartState?.vanishSlides && PERMANENT_BRUSHES.has(orb.currentTool)) {
      orb.setTool('vanishing');
      gestureManager.setPanMode(false);
      inkEngine.setTool('vanishing');
    }

    if (!pageManager) return;
    lastRenderedZoom = 1;
    const layout = await pageManager.renderPageBackground(page, bgCanvas, null, 1);
    if (!layout) return;
    inkEngine.redrawPageStrokes(page.strokes);
    refreshStamps();
    navControls?.update(idx, pageManager.getPageCount());
    applySmartPageView(layout, { animate: false });
  },
  onPagesUpdated: () => {
    if (!pageManager) return;
    navControls?.update(pageManager.currentIndex, pageManager.getPageCount());
  },
});

// Restore saved language & theme preferences
const savedLang = localStorage.getItem('captnz_lang') || 'en';
document.getElementById('select-language').value = savedLang;
applyLanguage(savedLang);
drawer.setTheme(localStorage.getItem('captnz_theme') || 'dark');

// Initial page render
pageManager.renderPageBackground(pageManager.getCurrentPage()).then((layout) => {
  applySmartPageView(layout, { animate: false });
});
navControls.update(0, pageManager.getPageCount());

// Window resize handling
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    const dpr = resizeCanvases();
    inkEngine.setDpr(dpr);
    const page = pageManager.getCurrentPage();
    const layout = await pageManager.renderPageBackground(page);
    if (!layout) return;
    inkEngine.redrawPageStrokes(page.strokes);
    applySmartPageView(layout, { animate: false });
  }, 120);
});

// Keyboard shortcuts for presenter remotes & keyboards
window.addEventListener('keydown', (e) => {
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
    pageManager.nextPage();
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    pageManager.captureCurrentThumbnail(inkCanvas, highlighterCanvas, inkEngine.isDarkBackground);
    pageManager.prevPage();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    performUndo(false);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    performRedo(false);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveCboardProject(pageManager).then(async (res) => {
      if (!res) return;
      await recordRecentFile({ name: res.name, kind: 'cboard', path: res.path, bytes: res.bytes });
      drawer.renderRecentFiles();
      showToast(t('toastProjectSaved'));
    });
  } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    toggleZoomView();
  } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
    drawer.toggle();
  }
});

// Handle files opened via Windows "Open with Captnz Board" / file association / Open Recent
async function handleOpenFilePath(filePath) {
  if (!filePath) return;
  try {
    const res = await openFileFromPath(filePath);
    if (!res) return;
    if (res.kind === 'cboard') {
      await loadCboardFromBytes(res.bytes, pageManager);
      await recordRecentFile({ name: res.name, kind: 'cboard', path: filePath, bytes: res.bytes });
      showToast(`${t('toastProjectLoaded')}: ${res.name}`);
    } else if (res.kind === 'pdf') {
      pageManager.loadPdfDocument(`pdf_${Date.now()}`, res.pdfDoc, res.rawBytes, true);
      await recordRecentFile({ name: res.name, kind: 'pdf', path: filePath, bytes: res.rawBytes });
      showToast(`${t('toastPdfLoaded')}: ${res.name}`);
    } else if (res.kind === 'ppt') {
      if (res.mode === 'pdf') {
        pageManager.loadPdfDocument(`ppt_${Date.now()}`, res.pdfDoc, res.rawBytes, true);
        showToast(`${t('toastPptLoaded')}: ${res.name}`);
      } else {
        pageManager.loadFallbackPptSlides(res.slides);
        showToast(t('toastPptFallback'), 3000);
      }
      await recordRecentFile({ name: res.name, kind: 'ppt', path: filePath });
    } else if (res.kind === 'image') {
      pageManager.addImagePage(res.dataUrl);
      await recordRecentFile({ name: res.name, kind: 'image', path: filePath, dataUrl: res.dataUrl });
      showToast(`${t('toastImageAdded')}: ${res.name}`);
    }
    drawer.renderRecentFiles();
    recoveryStore.scheduleSave(pageManager);
  } catch (err) {
    showToast(err?.message || 'Could not open file', 3800);
  }
}

async function initWindowsFileAssociationBridge() {
  if (!isTauriRuntime()) return;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const { invoke } = await import('@tauri-apps/api/core');

    await listen('open-file-path', (event) => {
      handleOpenFilePath(event.payload);
    });

    const startupPath = await invoke('take_startup_file_path');
    if (startupPath) {
      await handleOpenFilePath(startupPath);
      return true;
    }
  } catch {
    // Non-fatal outside desktop shell
  }
  return false;
}

// Startup: check Windows file-open arg first; otherwise check crash recovery banner
(async () => {
  const openedExternal = await initWindowsFileAssociationBridge();
  if (openedExternal) return;

  const hasBackup = await recoveryStore.hasRecoverableSession();
  if (!hasBackup) return;
  const banner = document.getElementById('recovery-banner');
  banner.classList.remove('hidden');

  document.getElementById('btn-recovery-restore').addEventListener('click', async () => {
    banner.classList.add('hidden');
    await recoveryStore.restoreInto(pageManager);
    showToast(t('toastRestored'));
  });

  document.getElementById('btn-recovery-dismiss').addEventListener('click', async () => {
    banner.classList.add('hidden');
    await recoveryStore.clear();
  });
})();

// Silent startup auto-update check in Tauri desktop builds
async function initAutoUpdater() {
  if (!isTauriRuntime()) return;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update?.available) return;

    const backdrop = document.getElementById('update-modal-backdrop');
    const badge = document.getElementById('update-version-badge');
    const notes = document.getElementById('update-modal-notes');
    const progressWrap = document.getElementById('update-progress-wrap');
    const progressBar = document.getElementById('update-progress-bar');
    const progressText = document.getElementById('update-progress-text');
    const btnDismiss = document.getElementById('btn-update-dismiss');
    const btnInstall = document.getElementById('btn-update-install');
    if (!backdrop || !btnInstall || !btnDismiss) return;

    badge.textContent = `v${update.version}`;
    if (update.body?.trim()) {
      notes.textContent = update.body.trim();
    }

    const closeUpdateModal = () => {
      if (backdrop.contains(document.activeElement)) {
        document.activeElement?.blur?.();
      }
      backdrop.classList.add('hidden');
      backdrop.setAttribute('aria-hidden', 'true');
      backdrop.inert = true;
    };

    backdrop.inert = false;
    backdrop.setAttribute('aria-hidden', 'false');
    backdrop.classList.remove('hidden');

    btnDismiss.onclick = closeUpdateModal;
    btnInstall.onclick = async () => {
      btnInstall.disabled = true;
      btnDismiss.disabled = true;
      progressWrap.classList.remove('hidden');
      let downloaded = 0;
      let contentLength = 0;

      try {
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') {
            contentLength = event.data.contentLength || 0;
            progressText.textContent = t('updateDownloading');
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength || 0;
            if (contentLength > 0) {
              const pct = Math.min(100, Math.round((downloaded / contentLength) * 100));
              progressBar.style.width = `${pct}%`;
              progressText.textContent = `${t('updateDownloading')} ${pct}%`;
            }
          } else if (event.event === 'Finished') {
            progressBar.style.width = '100%';
          }
        });
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      } catch (err) {
        btnInstall.disabled = false;
        btnDismiss.disabled = false;
        progressWrap.classList.add('hidden');
        showToast(err?.message || 'Update download failed', 3500);
      }
    };
  } catch {
    // Silent no-op when offline or updater key/manifest is unavailable
  }
}

setTimeout(() => {
  initAutoUpdater();
}, 1500);
