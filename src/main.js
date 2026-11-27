/**
 * Captnz Board — Main Application Bootstrap
 * Coordinates 4K DPR canvas scaling, InkEngine, GestureManager, LassoSnip,
 * PageManager, FileImporter, PDFExporter, RecoveryStore, and Floating UI.
 */

import './styles/main.css';
import { applyLanguage, t } from './i18n/translations.js';
import { getOptimalDpr, InkEngine } from './engine/inkEngine.js';
import { GestureManager } from './engine/gestureManager.js';
import { LassoSnipTool } from './engine/lassoSnip.js';
import { PageManager } from './document/pageManager.js';
import { pickAndImportImage, pickAndOpenPdf, pickAndOpenPpt } from './document/fileImporter.js';
import { exportSessionToPdf } from './document/pdfExporter.js';
import { RecoveryStore } from './document/recoveryStore.js';
import { SlideDrawer } from './ui/drawer.js';
import { FloatingOrb } from './ui/floatingOrb.js';
import { NavControls } from './ui/navControls.js';

const viewport = document.getElementById('board-viewport');
const transformLayer = document.getElementById('board-transform-layer');
const bgCanvas = document.getElementById('bg-canvas');
const inkCanvas = document.getElementById('ink-canvas');
const activeCanvas = document.getElementById('active-canvas');
const stampLayer = document.getElementById('stamp-layer');
const toastEl = document.getElementById('toast');

let toastTimer = null;
function showToast(msg, duration = 2200) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

// High-DPI 4K canvas sizing (capped to 4K pixel budget to prevent RAM bloat)
function resizeCanvases() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = getOptimalDpr(w, h);
  for (const c of [bgCanvas, inkCanvas, activeCanvas]) {
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

resizeCanvases();

const recoveryStore = new RecoveryStore();
let pageManager = null;

// 1. Ink Engine
const inkEngine = new InkEngine({
  inkCanvas,
  activeCanvas,
  onStrokeCommitted: (stroke) => {
    pageManager.addStroke(stroke);
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

// 2. Lasso Snip Tool
const lassoTool = new LassoSnipTool({
  bgCanvas,
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
    pageManager.captureCurrentThumbnail(inkCanvas);
    const newPage = pageManager.insertBlankAfterCurrent();
    snip.x = Math.max(40, (window.innerWidth - snip.w) / 2);
    snip.y = Math.max(40, (window.innerHeight - snip.h) / 2);
    newPage.stamps.push(snip);
    refreshStamps();
    showToast(t('toastBlankInserted'));
    recoveryStore.scheduleSave(pageManager);
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
    onChange: () => recoveryStore.scheduleSave(pageManager),
    onDelete: (id) => {
      page.stamps = page.stamps.filter((s) => s.id !== id);
      refreshStamps();
      recoveryStore.scheduleSave(pageManager);
    },
  });
}

// 4. Gesture Manager (Single-touch draw, 2-finger pinch/pan, Palm Eraser/Rejection)
const gestureManager = new GestureManager({
  viewport,
  transformLayer,
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
  onTransformChange: ({ scale }) => orb?.setZoom(scale),
});

// 5. Floating Circle Toolbox (Orb)
const orb = new FloatingOrb({
  onToolChange: (tool) => {
    lassoTool.clearSelection();
    inkEngine.setTool(tool);
  },
  onColorChange: (color) => inkEngine.setColor(color),
  onSizeChange: (size) => inkEngine.setSize(size),
  onUndo: () => performUndo(false),
  onRedo: () => performRedo(false),
  onResetZoom: () => gestureManager.resetZoom(),
  onTouchLockToggle: (locked) => {
    gestureManager.setTouchLocked(locked);
    showToast(t(locked ? 'toastTouchLocked' : 'toastTouchUnlocked'), 1500);
  },
});

// 6. Navigation Controls (< > +)
const navControls = new NavControls({
  onPrev: () => {
    pageManager.captureCurrentThumbnail(inkCanvas);
    pageManager.prevPage();
  },
  onNext: () => {
    pageManager.captureCurrentThumbnail(inkCanvas);
    pageManager.nextPage();
  },
  onAddBlank: () => {
    pageManager.captureCurrentThumbnail(inkCanvas);
    pageManager.insertBlankAfterCurrent();
    showToast(t('toastBlankInserted'));
    recoveryStore.scheduleSave(pageManager);
  },
});

// 7. Slide Drawer
const drawer = new SlideDrawer({
  onBeforeOpen: () => {
    pageManager.captureCurrentThumbnail(inkCanvas);
    drawer.renderThumbnails(pageManager.pages, pageManager.currentIndex);
  },
  onSelectPage: (idx) => {
    pageManager.captureCurrentThumbnail(inkCanvas);
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
    // Switch default ink between chalk white and dark ink when switching background polarity
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
  onOpenPdf: async () => {
    try {
      const res = await pickAndOpenPdf();
      if (!res) return;
      pageManager.loadPdfDocument(`pdf_${Date.now()}`, res.pdfDoc, res.rawBytes, true);
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
      recoveryStore.scheduleSave(pageManager);
    } catch (err) {
      showToast(err?.message || 'Could not open presentation', 4000);
    }
  },
  onImportImage: async () => {
    try {
      const dataUrl = await pickAndImportImage();
      if (!dataUrl) return;
      pageManager.captureCurrentThumbnail(inkCanvas);
      pageManager.addImagePage(dataUrl);
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

// 8. Page Manager (initialized after UI controllers referenced in its callbacks)
pageManager = new PageManager({
  bgCanvas,
  onPageChanged: async (page, idx) => {
    lassoTool.clearSelection();
    inkEngine.clearTransient();
    gestureManager?.resetZoom();
    drawer?.setActiveBackground(page.background || 'white');
    inkEngine.setDarkBackground(page.background === 'blackboard');

    if (!pageManager) return;
    await pageManager.renderPageBackground(page);
    inkEngine.redrawPageStrokes(page.strokes);
    refreshStamps();
    navControls?.update(idx, pageManager.getPageCount());
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
pageManager.renderPageBackground(pageManager.getCurrentPage());
navControls.update(0, pageManager.getPageCount());

// Window resize handling
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    const dpr = resizeCanvases();
    inkEngine.setDpr(dpr);
    const page = pageManager.getCurrentPage();
    await pageManager.renderPageBackground(page);
    inkEngine.redrawPageStrokes(page.strokes);
  }, 120);
});

// Keyboard shortcuts for presenter remotes & keyboards
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'PageDown') {
    pageManager.captureCurrentThumbnail(inkCanvas);
    pageManager.nextPage();
  } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    pageManager.captureCurrentThumbnail(inkCanvas);
    pageManager.prevPage();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    performUndo(false);
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    performRedo(false);
  } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
    e.preventDefault();
    gestureManager.resetZoom();
  } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
    drawer.toggle();
  }
});

// Crash recovery banner check on startup
(async () => {
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
