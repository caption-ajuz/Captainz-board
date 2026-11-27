/**
 * Captnz Board — Page & Background Manager
 * Manages PDF pages, PPT slides, imported images, inserted blank whiteboard pages,
 * per-page undo/redo stacks, stroke erasing, and thumbnail generation.
 */

import { getOptimalDpr } from '../engine/inkEngine.js';

export class PageManager {
  constructor({ bgCanvas, onPageChanged, onPagesUpdated }) {
    this.bgCanvas = bgCanvas;
    this.bgCtx = bgCanvas.getContext('2d', { alpha: true });
    this.onPageChanged = onPageChanged;
    this.onPagesUpdated = onPagesUpdated;

    this.pages = [];
    this.currentIndex = 0;
    this.defaultBackground = 'white';

    // Map of pdfDocId -> { pdfDoc, rawBytes }
    this.pdfDocs = new Map();

    // Active render & buffer lifecycle tracking for 4K memory optimization
    this._renderSeq = 0;
    this._activePdfRenderTask = null;
    this._activePdfPage = null;
    this._thumbCanvas = null;

    this.createBlankSession();
  }

  createBlankSession() {
    this.releaseInactivePageBuffers(-1);
    this.pages = [this._makeBlankPage(this.defaultBackground)];
    this.currentIndex = 0;
    this.onPagesUpdated?.();
    this.onPageChanged?.(this.getCurrentPage(), this.currentIndex);
  }

  _makeBlankPage(background = 'white') {
    return {
      id: `pg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'blank',
      background,
      strokes: [],
      redoStack: [],
      stamps: [],
      thumbnail: null,
    };
  }

  getCurrentPage() {
    return this.pages[this.currentIndex];
  }

  getPageCount() {
    return this.pages.length;
  }

  goToPage(index) {
    if (index < 0 || index >= this.pages.length) return;
    this.currentIndex = index;
    this.releaseInactivePageBuffers(this.currentIndex);
    this.onPageChanged?.(this.getCurrentPage(), this.currentIndex);
  }

  nextPage() {
    if (this.currentIndex < this.pages.length - 1) {
      this.goToPage(this.currentIndex + 1);
    }
  }

  prevPage() {
    if (this.currentIndex > 0) {
      this.goToPage(this.currentIndex - 1);
    }
  }

  /**
   * Instant '+' button: inserts a new blank whiteboard page immediately after the current slide.
   */
  insertBlankAfterCurrent() {
    const bg = this.getCurrentPage()?.background || this.defaultBackground;
    const newPage = this._makeBlankPage(bg);
    const insertAt = this.currentIndex + 1;
    this.pages.splice(insertAt, 0, newPage);
    this.currentIndex = insertAt;
    this.releaseInactivePageBuffers(this.currentIndex);
    this.onPagesUpdated?.();
    this.onPageChanged?.(newPage, this.currentIndex);
    return newPage;
  }

  deletePage(index) {
    if (this.pages.length <= 1) {
      this.clearCurrentPageInk();
      return;
    }
    this.pages.splice(index, 1);
    if (this.currentIndex >= this.pages.length) {
      this.currentIndex = this.pages.length - 1;
    }
    this.releaseInactivePageBuffers(this.currentIndex);
    this.onPagesUpdated?.();
    this.onPageChanged?.(this.getCurrentPage(), this.currentIndex);
  }

  setBackground(bg) {
    this.defaultBackground = bg;
    const page = this.getCurrentPage();
    if (page) {
      page.background = bg;
    }
  }

  loadPdfDocument(pdfDocId, pdfDoc, rawBytes, replaceSession = true) {
    this.pdfDocs.set(pdfDocId, { pdfDoc, rawBytes });
    const newPages = [];
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      newPages.push({
        id: `pdf_${pdfDocId}_${p}_${Date.now()}`,
        type: 'pdf',
        pdfDocId,
        pdfPageNum: p,
        background: 'white',
        strokes: [],
        redoStack: [],
        stamps: [],
        thumbnail: null,
      });
    }
    if (replaceSession) {
      this.releaseInactivePageBuffers(-1);
      this.pages = newPages;
      this.currentIndex = 0;
    } else {
      this.pages.splice(this.currentIndex + 1, 0, ...newPages);
      this.currentIndex += 1;
      this.releaseInactivePageBuffers(this.currentIndex);
    }
    this.onPagesUpdated?.();
    this.onPageChanged?.(this.getCurrentPage(), this.currentIndex);
  }

  loadFallbackPptSlides(slides) {
    this.releaseInactivePageBuffers(-1);
    const newPages = slides.map((s, idx) => ({
      id: `ppt_${idx}_${Date.now()}`,
      type: 'pptx-fallback',
      slideData: s,
      background: 'white',
      strokes: [],
      redoStack: [],
      stamps: [],
      thumbnail: null,
    }));
    this.pages = newPages;
    this.currentIndex = 0;
    this.onPagesUpdated?.();
    this.onPageChanged?.(this.getCurrentPage(), this.currentIndex);
  }

  addImagePage(dataUrl) {
    const imgPage = {
      id: `img_${Date.now()}`,
      type: 'image',
      imageDataUrl: dataUrl,
      background: 'white',
      strokes: [],
      redoStack: [],
      stamps: [],
      thumbnail: null,
    };
    const insertAt = this.currentIndex + 1;
    this.pages.splice(insertAt, 0, imgPage);
    this.currentIndex = insertAt;
    this.releaseInactivePageBuffers(this.currentIndex);
    this.onPagesUpdated?.();
    this.onPageChanged?.(imgPage, this.currentIndex);
  }

  /**
   * Cancels pending PDF renders and frees heavy offscreen canvas / PDF.js page buffers
   * for inactive pages so 4K page switching stays zero-lag and memory stays flat.
   */
  releaseInactivePageBuffers(activeIndex = this.currentIndex) {
    if (this._activePdfRenderTask) {
      try {
        this._activePdfRenderTask.cancel();
      } catch {
        // Ignore already-completed render tasks
      }
      this._activePdfRenderTask = null;
    }

    if (this._activePdfPage) {
      try {
        this._activePdfPage.cleanup?.();
      } catch {
        // Ignore cleanup errors
      }
      this._activePdfPage = null;
    }

    for (let i = 0; i < this.pages.length; i++) {
      if (i === activeIndex) continue;
      const page = this.pages[i];
      if (page._offscreenCanvas) {
        page._offscreenCanvas.width = 0;
        page._offscreenCanvas.height = 0;
        delete page._offscreenCanvas;
      }
      if (page._decodedImage) {
        delete page._decodedImage;
      }
    }
  }

  addStroke(stroke) {
    const page = this.getCurrentPage();
    if (!page) return;
    page.strokes.push(stroke);
    page.redoStack = [];
  }

  undo() {
    const page = this.getCurrentPage();
    if (!page || page.strokes.length === 0) return false;
    const popped = page.strokes.pop();
    page.redoStack.push(popped);
    return true;
  }

  redo() {
    const page = this.getCurrentPage();
    if (!page || page.redoStack.length === 0) return false;
    const restored = page.redoStack.pop();
    page.strokes.push(restored);
    return true;
  }

  clearCurrentPageInk() {
    const page = this.getCurrentPage();
    if (!page) return;
    page.strokes = [];
    page.redoStack = [];
    page.stamps = [];
  }

  /**
   * Stroke Eraser: removes any stroke whose points or shape intersect (pt, radius).
   */
  eraseStrokeAt(pt, radius) {
    const page = this.getCurrentPage();
    if (!page || page.strokes.length === 0) return false;

    const before = page.strokes.length;
    page.strokes = page.strokes.filter((s) => {
      if (s.tool === 'eraser-pixel' || s.tool === 'palm-eraser') return true;
      if (s.shape) {
        return !this._hitTestShape(s.shape, pt, radius);
      }
      for (let i = 0; i < s.points.length; i += 2) {
        const p = s.points[i];
        if (Math.hypot(p.x - pt.x, p.y - pt.y) <= radius + (p.w || 4) * 0.5) {
          return false;
        }
      }
      return true;
    });
    return page.strokes.length !== before;
  }

  _hitTestShape(sh, pt, r) {
    if (sh.kind === 'line' || sh.kind === 'arrow') {
      const dx = sh.x2 - sh.x1;
      const dy = sh.y2 - sh.y1;
      const l2 = dx * dx + dy * dy || 1;
      let t = ((pt.x - sh.x1) * dx + (pt.y - sh.y1) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(pt.x - (sh.x1 + t * dx), pt.y - (sh.y1 + t * dy)) <= r;
    }
    if (sh.kind === 'circle') {
      const nx = (pt.x - sh.cx) / Math.max(sh.rx, 1);
      const ny = (pt.y - sh.cy) / Math.max(sh.ry, 1);
      const d = Math.abs(Math.hypot(nx, ny) - 1) * Math.min(sh.rx, sh.ry);
      return d <= r + 6;
    }
    if (sh.kind === 'rect') {
      const nearX = pt.x >= sh.x - r && pt.x <= sh.x + sh.w + r;
      const nearY = pt.y >= sh.y - r && pt.y <= sh.y + sh.h + r;
      const onEdge =
        Math.abs(pt.x - sh.x) <= r ||
        Math.abs(pt.x - (sh.x + sh.w)) <= r ||
        Math.abs(pt.y - sh.y) <= r ||
        Math.abs(pt.y - (sh.y + sh.h)) <= r;
      return nearX && nearY && onEdge;
    }
    if (sh.kind === 'triangle') {
      const pts = sh.points;
      for (let i = 0; i < 3; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 3];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy || 1;
        let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)) <= r) return true;
      }
    }
    return false;
  }

  /**
   * Computes a high-DPI render scale for crisp PDF text while staying within a safe 4K memory budget.
   */
  getPdfRenderScale(cssW, cssH, zoomScale = 1) {
    const baseDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const renderScale = Math.max(baseDpr, 2.5) * Math.max(1, zoomScale);
    const maxBudgetDpr = Math.sqrt((3840 * 2160 * 1.5) / Math.max(1, cssW * cssH));
    return Math.max(1, Math.min(renderScale, maxBudgetDpr, 4));
  }

  /**
   * Renders the active page's sheet + PDF/Image/PPT slide onto a target 2D canvas
   * and returns the sheet layout metadata for orientation-aware viewport fitting.
   */
  async renderPageBackground(page, targetCanvas = this.bgCanvas, dpr = null, zoomScale = 1) {
    const isLiveCanvas = targetCanvas === this.bgCanvas;
    let effectiveDpr = dpr;
    if (isLiveCanvas && !effectiveDpr) {
      const baseCssW = parseFloat(targetCanvas.style.width) || window.innerWidth || 1920;
      const baseCssH = parseFloat(targetCanvas.style.height) || window.innerHeight || 1080;
      effectiveDpr =
        page.type === 'pdf'
          ? this.getPdfRenderScale(baseCssW, baseCssH, zoomScale)
          : getOptimalDpr(baseCssW, baseCssH);
      const targetW = Math.round(baseCssW * effectiveDpr);
      const targetH = Math.round(baseCssH * effectiveDpr);
      if (targetCanvas.width !== targetW || targetCanvas.height !== targetH) {
        targetCanvas.width = targetW;
        targetCanvas.height = targetH;
      }
      targetCanvas.dataset.dpr = String(effectiveDpr);
    }
    effectiveDpr = effectiveDpr || Number(targetCanvas.dataset?.dpr) || getOptimalDpr();
    const seq = isLiveCanvas ? ++this._renderSeq : 0;

    const ctx = targetCanvas.getContext('2d', { alpha: true });
    const cssW = targetCanvas.width / effectiveDpr;
    const cssH = targetCanvas.height / effectiveDpr;

    ctx.save();
    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    let layout = {
      x: 0,
      y: 0,
      width: cssW,
      height: cssH,
      isPortrait: false,
      aspect: cssW / Math.max(1, cssH),
    };

    if (page.type === 'pdf') {
      const entry = this.pdfDocs.get(page.pdfDocId);
      if (entry?.pdfDoc) {
        if (isLiveCanvas && this._activePdfRenderTask) {
          try {
            this._activePdfRenderTask.cancel();
          } catch {
            // Ignore
          }
          this._activePdfRenderTask = null;
        }

        const pdfPage = await entry.pdfDoc.getPage(page.pdfPageNum);
        if (isLiveCanvas && seq !== this._renderSeq) {
          pdfPage.cleanup?.();
          ctx.restore();
          return null;
        }

        const unscaled = pdfPage.getViewport({ scale: 1 });
        const isPortrait = unscaled.height > unscaled.width;
        const fillRatio = isPortrait ? 0.94 : 0.97;
        const fitScale = Math.min((cssW * fillRatio) / unscaled.width, (cssH * fillRatio) / unscaled.height);
        const viewport = pdfPage.getViewport({ scale: fitScale });
        const offsetX = (cssW - viewport.width) / 2;
        const offsetY = (cssH - viewport.height) / 2;

        layout = {
          x: offsetX,
          y: offsetY,
          width: viewport.width,
          height: viewport.height,
          isPortrait,
          aspect: unscaled.width / Math.max(1, unscaled.height),
        };

        this._drawSheetFrame(ctx, offsetX, offsetY, viewport.width, viewport.height, '#ffffff', false);

        ctx.save();
        ctx.translate(offsetX, offsetY);
        const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
        if (isLiveCanvas) {
          this._activePdfPage = pdfPage;
          this._activePdfRenderTask = renderTask;
        }
        try {
          await renderTask.promise;
        } catch (err) {
          if (err?.name !== 'RenderingCancelledException') throw err;
        } finally {
          ctx.restore();
          if (isLiveCanvas && this._activePdfRenderTask === renderTask) {
            this._activePdfRenderTask = null;
          }
          if (!isLiveCanvas) {
            pdfPage.cleanup?.();
          }
        }
        this._strokeSheetBorder(ctx, offsetX, offsetY, viewport.width, viewport.height, false);
      }
    } else if (page.type === 'image' && page.imageDataUrl) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          if (!isLiveCanvas || seq === this._renderSeq) {
            const isPortrait = img.height > img.width;
            const fillRatio = isPortrait ? 0.94 : 0.96;
            const fit = Math.min((cssW * fillRatio) / img.width, (cssH * fillRatio) / img.height, 2);
            const w = img.width * fit;
            const h = img.height * fit;
            const x = (cssW - w) / 2;
            const y = (cssH - h) / 2;
            layout = { x, y, width: w, height: h, isPortrait, aspect: img.width / Math.max(1, img.height) };
            this._drawSheetFrame(ctx, x, y, w, h, '#ffffff', false);
            ctx.drawImage(img, x, y, w, h);
            this._strokeSheetBorder(ctx, x, y, w, h, false);
          }
          img.onload = null;
          img.onerror = null;
          img.src = '';
          resolve();
        };
        img.onerror = () => {
          img.onload = null;
          img.onerror = null;
          resolve();
        };
        img.src = page.imageDataUrl;
      });
    } else if (page.type === 'pptx-fallback' && page.slideData) {
      const slideW = Math.min(cssW * 0.96, (cssH * 0.96 * 16) / 9);
      const slideH = (slideW * 9) / 16;
      const sx = (cssW - slideW) / 2;
      const sy = (cssH - slideH) / 2;
      layout = { x: sx, y: sy, width: slideW, height: slideH, isPortrait: false, aspect: 16 / 9 };
      this._drawSheetFrame(ctx, sx, sy, slideW, slideH, '#ffffff', false);
      ctx.save();
      ctx.translate(sx, sy);
      await this._renderFallbackSlide(ctx, slideW, slideH, page.slideData);
      ctx.restore();
      this._strokeSheetBorder(ctx, sx, sy, slideW, slideH, false);
    } else {
      // Blank / board sheet: framed on the live studio desk, edge-to-edge on PDF export
      const inset = isLiveCanvas ? 16 : 0;
      const sx = inset;
      const sy = inset;
      const sw = cssW - inset * 2;
      const sh = cssH - inset * 2;
      const bg = page.background || 'white';
      layout = { x: sx, y: sy, width: sw, height: sh, isPortrait: false, aspect: sw / Math.max(1, sh) };

      if (isLiveCanvas) {
        this._drawSheetFrame(ctx, sx, sy, sw, sh, bg === 'blackboard' ? '#102a20' : '#ffffff', bg === 'blackboard', 10);
        ctx.save();
        this._roundedRectPath(ctx, sx, sy, sw, sh, 10);
        ctx.clip();
        ctx.translate(sx, sy);
        this._drawBoardBackground(ctx, sw, sh, bg);
        ctx.restore();
        this._strokeSheetBorder(ctx, sx, sy, sw, sh, bg === 'blackboard', 10);
      } else {
        this._drawBoardBackground(ctx, cssW, cssH, bg);
      }
    }

    page._layout = layout;
    ctx.restore();
    return layout;
  }

  _roundedRectPath(ctx, x, y, w, h, r = 0) {
    ctx.beginPath();
    if (r > 0 && typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
  }

  _drawSheetFrame(ctx, x, y, w, h, fill, isDark, radius = 4) {
    ctx.save();
    ctx.fillStyle = fill;
    ctx.shadowColor = isDark ? 'rgba(0, 0, 0, 0.36)' : 'rgba(15, 23, 42, 0.14)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 14;
    this._roundedRectPath(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.restore();
  }

  _strokeSheetBorder(ctx, x, y, w, h, isDark, radius = 4) {
    ctx.save();
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(15, 23, 42, 0.12)';
    ctx.lineWidth = 1.5;
    this._roundedRectPath(ctx, x, y, w, h, radius);
    ctx.stroke();
    ctx.restore();
  }

  _drawBoardBackground(ctx, w, h, bg) {
    if (bg === 'blackboard') {
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
      grad.addColorStop(0, '#1b4332');
      grad.addColorStop(1, '#102a20');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      return;
    }

    if (bg === 'ruled') {
      ctx.fillStyle = '#fffdf7';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.22)';
      ctx.lineWidth = 1;
      const step = 42;
      ctx.beginPath();
      for (let y = step * 2; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      // Left margin line
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(96, 0);
      ctx.lineTo(96, h);
      ctx.stroke();
      return;
    }

    if (bg === 'grid') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
      ctx.lineWidth = 1;
      const step = 36;
      ctx.beginPath();
      for (let x = step; x < w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = step; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
      return;
    }

    // Default clean White
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }

  async _renderFallbackSlide(ctx, w, h, slide) {
    const padX = w * 0.08;
    const padY = h * 0.1;
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 ${Math.round(Math.min(w, h) * 0.042)}px "Segoe UI", sans-serif`;
    ctx.fillText(slide.title || `Slide ${slide.index}`, padX, padY + 36, w - padX * 2);

    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(padX, padY + 54);
    ctx.lineTo(padX + 120, padY + 54);
    ctx.stroke();

    ctx.fillStyle = '#334155';
    const bodySize = Math.round(Math.min(w, h) * 0.024);
    ctx.font = `400 ${bodySize}px "Segoe UI", sans-serif`;
    let y = padY + 104;
    for (const para of (slide.paragraphs || []).slice(0, 12)) {
      ctx.fillText(`• ${para}`, padX, y, w - padX * 2);
      y += bodySize * 1.65;
      if (y > h - 80) break;
    }

    if (slide.images && slide.images.length > 0) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const maxW = w * 0.42;
          const maxH = h * 0.48;
          const s = Math.min(maxW / img.width, maxH / img.height, 1);
          const iw = img.width * s;
          const ih = img.height * s;
          ctx.drawImage(img, w - padX - iw, h - padY - ih, iw, ih);
          resolve();
        };
        img.onerror = resolve;
        img.src = slide.images[0];
      });
    }
  }

  /**
   * Generates a lightweight 4:3 JPEG thumbnail for the current page from the live canvases,
   * reusing a single small offscreen canvas to avoid per-page buffer churn.
   */
  captureCurrentThumbnail(inkCanvas, highlighterCanvas = null, isDarkBg = false) {
    const page = this.getCurrentPage();
    if (!page) return;
    if (!this._thumbCanvas) {
      this._thumbCanvas = document.createElement('canvas');
      this._thumbCanvas.width = 240;
      this._thumbCanvas.height = 180;
    }
    const thumb = this._thumbCanvas;
    const ctx = thumb.getContext('2d');
    ctx.fillStyle = document.documentElement.dataset.theme === 'light' ? '#eef1f5' : '#0b0f17';
    ctx.fillRect(0, 0, thumb.width, thumb.height);
    ctx.drawImage(this.bgCanvas, 0, 0, thumb.width, thumb.height);
    if (highlighterCanvas) {
      ctx.save();
      ctx.globalCompositeOperation = isDarkBg ? 'screen' : 'multiply';
      ctx.drawImage(highlighterCanvas, 0, 0, thumb.width, thumb.height);
      ctx.restore();
    }
    if (inkCanvas) {
      ctx.drawImage(inkCanvas, 0, 0, thumb.width, thumb.height);
    }
    page.thumbnail = thumb.toDataURL('image/jpeg', 0.72);
  }

  /**
   * Lazily renders a 4:3 thumbnail for any unvisited page (used by the windowed drawer list).
   */
  async renderThumbnailForPage(page) {
    if (!page) return null;
    if (page.thumbnail) return page.thumbnail;

    if (!this._lazyThumbCanvas) {
      this._lazyThumbCanvas = document.createElement('canvas');
      this._lazyThumbCanvas.width = 240;
      this._lazyThumbCanvas.height = 180;
    }
    const thumb = this._lazyThumbCanvas;
    const ctx = thumb.getContext('2d');
    const w = thumb.width;
    const h = thumb.height;

    ctx.fillStyle = document.documentElement.dataset.theme === 'light' ? '#eef1f5' : '#0b0f17';
    ctx.fillRect(0, 0, w, h);

    if (page.type === 'pdf') {
      const entry = this.pdfDocs.get(page.pdfDocId);
      if (!entry?.pdfDoc) return null;
      const pdfPage = await entry.pdfDoc.getPage(page.pdfPageNum);
      try {
        const unscaled = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min((w * 0.9) / unscaled.width, (h * 0.9) / unscaled.height);
        const viewport = pdfPage.getViewport({ scale });
        const ox = (w - viewport.width) / 2;
        const oy = (h - viewport.height) / 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(ox, oy, viewport.width, viewport.height);
        ctx.save();
        ctx.translate(ox, oy);
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        ctx.restore();
      } finally {
        pdfPage.cleanup?.();
      }
    } else if (page.type === 'image' && page.imageDataUrl) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const s = Math.min((w * 0.9) / img.width, (h * 0.9) / img.height);
          const iw = img.width * s;
          const ih = img.height * s;
          ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
          resolve();
        };
        img.onerror = resolve;
        img.src = page.imageDataUrl;
      });
    } else {
      this._drawBoardBackground(ctx, w, h, page.background || 'white');
    }

    page.thumbnail = thumb.toDataURL('image/jpeg', 0.72);
    return page.thumbnail;
  }
}
