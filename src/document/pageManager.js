/**
 * Captnz Board — Page & Background Manager
 * Manages PDF pages, PPT slides, imported images, inserted blank whiteboard pages,
 * per-page undo/redo stacks, stroke erasing, and thumbnail generation.
 */

import { getOptimalDpr } from '../engine/inkEngine.js';

export class PageManager {
  constructor({ bgCanvas, onPageChanged, onPagesUpdated }) {
    this.bgCanvas = bgCanvas;
    this.bgCtx = bgCanvas.getContext('2d', { alpha: false });
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
    if (sh.kind === 'line') {
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
   * Renders the active page's background + PDF/Image/PPT slide onto a target 2D canvas.
   */
  async renderPageBackground(page, targetCanvas = this.bgCanvas, dpr = null) {
    const effectiveDpr = dpr || Number(targetCanvas.dataset?.dpr) || getOptimalDpr();
    const isLiveCanvas = targetCanvas === this.bgCanvas;
    const seq = isLiveCanvas ? ++this._renderSeq : 0;

    const ctx = targetCanvas.getContext('2d', { alpha: false });
    const cssW = targetCanvas.width / effectiveDpr;
    const cssH = targetCanvas.height / effectiveDpr;

    ctx.save();
    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

    // 1. Paint board background pattern
    this._drawBoardBackground(ctx, cssW, cssH, page.background || 'white');

    // 2. Render PDF page centered with capped DPR scaling
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
          return;
        }

        const unscaled = pdfPage.getViewport({ scale: 1 });
        const fitScale = Math.min((cssW * 0.96) / unscaled.width, (cssH * 0.96) / unscaled.height);
        const viewport = pdfPage.getViewport({ scale: fitScale });
        const offsetX = (cssW - viewport.width) / 2;
        const offsetY = (cssH - viewport.height) / 2;

        // Crisp paper card backdrop
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.18)';
        ctx.shadowBlur = 18;
        ctx.fillRect(offsetX, offsetY, viewport.width, viewport.height);
        ctx.shadowBlur = 0;

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
          if (isLiveCanvas && this._activePdfRenderTask === renderTask) {
            this._activePdfRenderTask = null;
          }
          if (!isLiveCanvas) {
            pdfPage.cleanup?.();
          }
        }
      }
    } else if (page.type === 'image' && page.imageDataUrl) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          if (!isLiveCanvas || seq === this._renderSeq) {
            const fit = Math.min((cssW * 0.92) / img.width, (cssH * 0.92) / img.height, 1.5);
            const w = img.width * fit;
            const h = img.height * fit;
            ctx.drawImage(img, (cssW - w) / 2, (cssH - h) / 2, w, h);
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
      await this._renderFallbackSlide(ctx, cssW, cssH, page.slideData);
    }

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
   * Generates a lightweight JPEG thumbnail for the current page from the live canvases,
   * reusing a single small offscreen canvas to avoid per-page buffer churn.
   */
  captureCurrentThumbnail(inkCanvas) {
    const page = this.getCurrentPage();
    if (!page) return;
    if (!this._thumbCanvas) {
      this._thumbCanvas = document.createElement('canvas');
      this._thumbCanvas.width = 256;
      this._thumbCanvas.height = 144;
    }
    const thumb = this._thumbCanvas;
    const ctx = thumb.getContext('2d');
    ctx.clearRect(0, 0, thumb.width, thumb.height);
    ctx.drawImage(this.bgCanvas, 0, 0, thumb.width, thumb.height);
    if (inkCanvas) {
      ctx.drawImage(inkCanvas, 0, 0, thumb.width, thumb.height);
    }
    page.thumbnail = thumb.toDataURL('image/jpeg', 0.72);
  }
}
