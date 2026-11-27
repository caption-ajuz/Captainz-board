/**
 * Captnz Board — Zero-Latency Procreate-Style Multi-Brush Ink Engine
 * - Pointer Events + getCoalescedEvents()
 * - StreamLine real-time stabilization (0–100%)
 * - 8 Brushes: Technical Pen, Calligraphy/Fountain Nib (30°–45°), Blackboard Chalk,
 *   Soft Sketch Pencil, Monoline Marker, Dashed/Dotted Pen, Behind-Ink Highlighter, Vanishing Ink (3s)
 * - QuickShape (Hold-to-Snap) for Line, Arrow, Circle/Ellipse, Rectangle, Triangle
 * - Ruler edge-snapping hook, Red/Blue Laser, Stroke & Pixel Erasers
 */

import { maybeStraightenHighlighter, recognizeShape } from './shapeRecognizer.js';

const DEFAULT_VANISH_MS = 4000;
const LASER_TAIL_MS = 260;
const HOLD_SHAPE_MS = 450;
const HOLD_MOVE_TOLERANCE = 9;
const MAX_DPR = 2;
const MAX_CANVAS_PIXELS = 3840 * 2160; // Cap backing buffers to 4K UHD pixel budget

/**
 * Computes a capped devicePixelRatio so 4K/5K smart boards stay crisp
 * without allocating excessive multi-hundred-megabyte canvas buffers.
 */
export function getOptimalDpr(cssW = window.innerWidth, cssH = window.innerHeight, zoomScale = 1) {
  const rawDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const area = Math.max(1, cssW * cssH);
  const budgetDpr = Math.sqrt(MAX_CANVAS_PIXELS / area);
  const desired = Math.max(rawDpr, Math.min(MAX_DPR, Math.max(1, zoomScale)));
  return Math.max(1, Math.min(desired, MAX_DPR, budgetDpr));
}

/**
 * Deterministic 64x64 procedural noise mask for Chalk & Graphite Pencil textures (100% offline).
 */
function createGrainMask(size, threshold, maxAlpha) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  let seed = 0x5f3759df;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const r = (seed & 0xffff) / 0xffff;
    const alpha = r > threshold ? Math.round(((r - threshold) / (1 - threshold)) * 255 * maxAlpha) : 0;
    img.data[i] = 255;
    img.data[i + 1] = 255;
    img.data[i + 2] = 255;
    img.data[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class InkEngine {
  constructor({
    inkCanvas,
    highlighterCanvas = null,
    activeCanvas,
    onStrokeCommitted,
    onStrokeErased,
    onShapeSnapped,
  }) {
    this.inkCanvas = inkCanvas;
    this.highlighterCanvas = highlighterCanvas;
    this.activeCanvas = activeCanvas;
    this.dpr = Number(inkCanvas.dataset?.dpr) || getOptimalDpr();

    // Hardware-accelerated low-latency desynchronized 2D contexts
    this.inkCtx = inkCanvas.getContext('2d', { alpha: true, desynchronized: true });
    this.highlighterCtx = highlighterCanvas
      ? highlighterCanvas.getContext('2d', { alpha: true, desynchronized: true })
      : null;
    this.activeCtx = activeCanvas.getContext('2d', { alpha: true, desynchronized: true });

    this.onStrokeCommitted = onStrokeCommitted;
    this.onStrokeErased = onStrokeErased;
    this.onShapeSnapped = onShapeSnapped;

    this.tool = 'calligraphy';
    this.color = '#111827';
    this.size = 4;
    this.streamline = 0.35; // 0..1
    this.nibAngle = 38; // 30..45 degrees for Calligraphy/Fountain Nib
    this.dashStyle = 'dashed'; // 'dashed' | 'dotted'
    this.vanishDurationMs = DEFAULT_VANISH_MS;
    this.quickShapeEnabled = true;
    this.isDarkBackground = false;

    // Optional coordinate transformer (e.g. Ruler edge-snapping)
    this.snapPointTransform = null;

    this.currentStroke = null;
    this._rawLastPt = null;
    this._smoothedPos = null;
    this.vanishingStrokes = [];
    this.laserTrail = [];
    this.laserActive = false;

    this.holdTimer = null;
    this.holdAnchor = null;
    this.snappedShape = null;
    this._rafId = null;

    this._chalkMask = createGrainMask(64, 0.22, 0.96);
    this._pencilMask = createGrainMask(64, 0.34, 0.85);
    this._patternCache = new Map();
  }

  setDpr(dpr) {
    this.dpr = dpr;
    this.inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.highlighterCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.activeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setTool(tool) {
    this.tool = tool;
    this.laserActive = false;
    this.laserTrail = [];
  }

  setColor(color) {
    this.color = color;
  }

  setSize(size) {
    this.size = Number(size) || 4;
  }

  setStreamline(pct) {
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    this.streamline = clamped / 100;
  }

  setNibAngle(deg) {
    this.nibAngle = Math.max(30, Math.min(45, Number(deg) || 38));
  }

  setDashStyle(style) {
    this.dashStyle = style === 'dotted' ? 'dotted' : 'dashed';
  }

  setVanishDuration(seconds) {
    const sec = Math.max(1, Math.min(15, Number(seconds) || 4));
    this.vanishDurationMs = sec * 1000;
  }

  setQuickShapeEnabled(enabled) {
    this.quickShapeEnabled = Boolean(enabled);
    if (!this.quickShapeEnabled) {
      this._clearHoldTimer();
      this.snappedShape = null;
    }
  }

  setDarkBackground(isDark) {
    this.isDarkBackground = Boolean(isDark);
    if (this.highlighterCanvas) {
      this.highlighterCanvas.style.mixBlendMode = this.isDarkBackground ? 'screen' : 'multiply';
    }
  }

  setSnapPointTransform(fn) {
    this.snapPointTransform = typeof fn === 'function' ? fn : null;
  }

  _getTexturedPattern(ctx, kind, color) {
    const key = `${kind}:${color}`;
    let entry = this._patternCache.get(key);
    if (!entry) {
      if (this._patternCache.size >= 24) {
        const firstKey = this._patternCache.keys().next().value;
        this._patternCache.delete(firstKey);
      }
      const mask = kind === 'chalk' ? this._chalkMask : this._pencilMask;
      const tile = document.createElement('canvas');
      tile.width = mask.width;
      tile.height = mask.height;
      const tctx = tile.getContext('2d');
      tctx.fillStyle = color;
      tctx.fillRect(0, 0, tile.width, tile.height);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(mask, 0, 0);
      entry = { tile, pattern: ctx.createPattern(tile, 'repeat') };
      this._patternCache.set(key, entry);
    }
    return entry.pattern || color;
  }

  _applyPointSnap(pt) {
    if (!this.snapPointTransform) return pt;
    const snapped = this.snapPointTransform(pt);
    if (!snapped) return pt;
    return { ...pt, x: snapped.x, y: snapped.y, snappedToGuide: Boolean(snapped.snapped) };
  }

  /**
   * Compute dynamic width from pen pressure, tilt, nib angle & pointer velocity.
   */
  _computeWidth(prevPt, pt, baseSize, tool, nibAngle = this.nibAngle) {
    const dt = Math.max(pt.t - (prevPt?.t ?? pt.t), 1);
    const dist = prevPt ? Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y) : 0;
    const velocity = dist / dt; // px per ms

    const hasRealPressure = pt.pressure > 0 && pt.pressure !== 0.5 && pt.pointerType === 'pen';
    const pressureFactor = hasRealPressure ? 0.45 + pt.pressure * 0.95 : 1.0;

    switch (tool) {
      case 'technical':
        return Math.max(1.0, baseSize * (hasRealPressure ? 0.9 + pt.pressure * 0.2 : 1.0));
      case 'calligraphy':
      case 'fountain': {
        const dx = prevPt ? pt.x - prevPt.x : 1;
        const dy = prevPt ? pt.y - prevPt.y : 0;
        const strokeAngle = Math.atan2(dy, dx);
        const nibRad = ((nibAngle || 38) * Math.PI) / 180;
        // Directional chisel nib + velocity/pressure thick-to-thin taper (great for English, Malayalam, Arabic)
        const angleFactor = 0.28 + 0.92 * Math.abs(Math.sin(strokeAngle - nibRad));
        const velFactor = Math.max(0.55, Math.min(1.24, 1.16 - velocity * 0.24));
        return Math.max(1.1, baseSize * 1.48 * angleFactor * velFactor * pressureFactor);
      }
      case 'ballpoint': {
        const velFactor = Math.max(0.84, Math.min(1.06, 1.02 - velocity * 0.06));
        return Math.max(1.0, baseSize * 0.9 * velFactor * pressureFactor);
      }
      case 'chalk': {
        const velFactor = Math.max(0.76, Math.min(1.18, 1.1 - velocity * 0.14));
        return Math.max(2.4, baseSize * 1.45 * velFactor * pressureFactor);
      }
      case 'pencil': {
        const tiltMag = Math.hypot(pt.tiltX || 0, pt.tiltY || 0);
        const tiltBoost = tiltMag > 16 ? 1 + Math.min(0.85, (tiltMag - 16) / 45) : 1;
        const velFactor = Math.max(0.68, Math.min(1.15, 1.05 - velocity * 0.14));
        return Math.max(1.0, baseSize * 0.95 * velFactor * pressureFactor * tiltBoost);
      }
      case 'marker':
        return Math.max(3.5, baseSize * 1.7 * (hasRealPressure ? 0.85 + pt.pressure * 0.3 : 1));
      case 'dashed':
        return Math.max(1.5, baseSize);
      case 'highlighter':
        return Math.max(14, baseSize * 4.2);
      case 'vanishing':
        return Math.max(3, baseSize * 1.15);
      case 'eraser-pixel':
        return Math.max(14, baseSize * 3.5);
      case 'palm-eraser':
        return Math.max(36, pt.palmRadius || 48);
      default:
        return baseSize;
    }
  }

  beginStroke(rawPt, overrideTool = null) {
    const activeTool = overrideTool || this.tool;
    this.snappedShape = null;
    this._clearHoldTimer();

    const pt = this._applyPointSnap(rawPt);

    if (activeTool === 'laser-red' || activeTool === 'laser-blue') {
      this.activeCanvas.style.mixBlendMode = 'normal';
      this.laserActive = true;
      this.laserTrail = [
        {
          x: pt.x,
          y: pt.y,
          t: performance.now(),
          color: activeTool === 'laser-red' ? '#ff2a2a' : '#38bdf8',
        },
      ];
      this._ensureAnimationLoop();
      return;
    }

    if (activeTool === 'eraser-stroke') {
      this.currentStroke = { tool: 'eraser-stroke', points: [pt] };
      this.onStrokeErased?.(pt, Math.max(18, this.size * 2.5));
      return;
    }

    this._rawLastPt = pt;
    this._smoothedPos = { x: pt.x, y: pt.y };

    // Live active canvas blend mode for Behind-Ink Highlighter preview
    if (activeTool === 'highlighter') {
      this.activeCanvas.style.mixBlendMode = this.isDarkBackground ? 'screen' : 'multiply';
    } else {
      this.activeCanvas.style.mixBlendMode = 'normal';
    }

    const startWidth = this._computeWidth(null, pt, this.size, activeTool);
    this.currentStroke = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tool: activeTool,
      color: activeTool === 'vanishing' ? (this.color === '#111827' ? '#38bdf8' : this.color) : this.color,
      size: this.size,
      nibAngle: this.nibAngle,
      dashStyle: this.dashStyle,
      isDarkBg: this.isDarkBackground,
      points: [{ x: pt.x, y: pt.y, w: startWidth, t: pt.t, pressure: pt.pressure }],
      shape: null,
    };

    if (activeTool === 'eraser-pixel' || activeTool === 'palm-eraser') {
      this._drawIncrementalErase(this.currentStroke, 0);
    } else {
      this._renderActiveStroke();
    }

    this._scheduleHoldCheck(pt);
  }

  extendStroke(points) {
    if (!points.length) return;

    if (this.laserActive) {
      const now = performance.now();
      const color = this.tool === 'laser-red' ? '#ff2a2a' : '#38bdf8';
      for (const pt of points) {
        this.laserTrail.push({ x: pt.x, y: pt.y, t: now, color });
      }
      return;
    }

    if (!this.currentStroke) return;

    if (this.currentStroke.tool === 'eraser-stroke') {
      for (const pt of points) {
        this.onStrokeErased?.(pt, Math.max(18, this.size * 2.5));
      }
      return;
    }

    const s = this.currentStroke;
    const isEraser = s.tool === 'eraser-pixel' || s.tool === 'palm-eraser';
    // StreamLine EMA coefficient (0% -> 1.0 instant, 100% -> 0.22 silky stabilization)
    const alpha = isEraser ? 1 : 1 - this.streamline * 0.78;

    for (const rawPt of points) {
      const pt = this._applyPointSnap(rawPt);
      this._rawLastPt = pt;

      let sx = pt.x;
      let sy = pt.y;
      if (!isEraser && this._smoothedPos && this.streamline > 0 && !pt.snappedToGuide) {
        sx = this._smoothedPos.x + (pt.x - this._smoothedPos.x) * alpha;
        sy = this._smoothedPos.y + (pt.y - this._smoothedPos.y) * alpha;
      }
      this._smoothedPos = { x: sx, y: sy };

      const prev = s.points[s.points.length - 1];
      const d = Math.hypot(sx - prev.x, sy - prev.y);
      if (d < 1.1) continue; // Filter micro jitter

      const smoothedPt = { ...pt, x: sx, y: sy };
      const rawW = this._computeWidth(prev, smoothedPt, s.size, s.tool, s.nibAngle);
      const smoothW = prev.w * 0.65 + rawW * 0.35;
      s.points.push({ x: sx, y: sy, w: smoothW, t: pt.t, pressure: pt.pressure });

      if (isEraser) {
        this._drawIncrementalErase(s, s.points.length - 1);
      }

      // Reset QuickShape draw-and-hold timer if pointer moved beyond tolerance
      if (!this.holdAnchor || Math.hypot(pt.x - this.holdAnchor.x, pt.y - this.holdAnchor.y) > HOLD_MOVE_TOLERANCE) {
        this.snappedShape = null;
        this._scheduleHoldCheck(pt);
      }
    }

    if (!isEraser) {
      this._renderActiveStroke();
    }
  }

  endStroke() {
    this._clearHoldTimer();

    if (this.laserActive) {
      this.laserActive = false;
      return;
    }

    if (!this.currentStroke) return;
    const stroke = this.currentStroke;
    this.currentStroke = null;
    const rawLast = this._rawLastPt;
    this._rawLastPt = null;
    this._smoothedPos = null;
    this.activeCanvas.style.mixBlendMode = 'normal';

    if (stroke.tool === 'eraser-stroke') {
      return;
    }

    // StreamLine catch-up tail so stabilized endpoints meet the lifted pen cleanly
    if (
      rawLast &&
      this.streamline > 0 &&
      !this.snappedShape &&
      stroke.points.length > 1 &&
      !stroke.tool.includes('eraser')
    ) {
      const last = stroke.points[stroke.points.length - 1];
      const gap = Math.hypot(rawLast.x - last.x, rawLast.y - last.y);
      if (gap > 2 && gap < 48) {
        const midX = (last.x + rawLast.x) / 2;
        const midY = (last.y + rawLast.y) / 2;
        stroke.points.push({ x: midX, y: midY, w: last.w, t: rawLast.t, pressure: rawLast.pressure });
        stroke.points.push({ x: rawLast.x, y: rawLast.y, w: last.w * 0.9, t: rawLast.t, pressure: rawLast.pressure });
      }
    }

    // Vanishing Ink: move to fading animation queue instead of permanent page strokes
    if (stroke.tool === 'vanishing') {
      stroke.createdAt = performance.now();
      stroke.vanishDurationMs = this.vanishDurationMs;
      this.vanishingStrokes.push(stroke);
      this._ensureAnimationLoop();
      return;
    }

    if (this.snappedShape) {
      stroke.shape = this.snappedShape;
      this.snappedShape = null;
    } else if (stroke.tool === 'highlighter') {
      const straight = maybeStraightenHighlighter(stroke.points);
      if (straight) {
        stroke.points = straight.map((p) => ({ ...p, w: stroke.points[0].w }));
      }
    }

    this._clearActiveCanvas();
    this._commitStrokeToLayer(stroke);
    this.onStrokeCommitted?.(stroke);
  }

  /**
   * Commits a pre-built stroke (e.g. from Geometry Compass) directly to the board.
   */
  commitSyntheticStroke(stroke) {
    if (!stroke) return;
    this._commitStrokeToLayer(stroke);
    this.onStrokeCommitted?.(stroke);
  }

  _commitStrokeToLayer(stroke) {
    if (stroke.tool === 'highlighter' && this.highlighterCtx) {
      this.drawStroke(this.highlighterCtx, stroke, 1, { onDedicatedHighlightLayer: true });
    } else if ((stroke.tool === 'eraser-pixel' || stroke.tool === 'palm-eraser') && this.highlighterCtx) {
      this.drawStroke(this.inkCtx, stroke);
      this.drawStroke(this.highlighterCtx, stroke);
    } else {
      this.drawStroke(this.inkCtx, stroke);
    }
  }

  cancelStroke() {
    this._clearHoldTimer();
    this.currentStroke = null;
    this._rawLastPt = null;
    this._smoothedPos = null;
    this.snappedShape = null;
    this.laserActive = false;
    this.activeCanvas.style.mixBlendMode = 'normal';
    this._clearActiveCanvas();
  }

  _scheduleHoldCheck(pt) {
    this._clearHoldTimer();
    if (!this.quickShapeEnabled || !this.currentStroke) return;
    const eligible = [
      'technical',
      'calligraphy',
      'chalk',
      'pencil',
      'marker',
      'dashed',
      'fountain',
      'ballpoint',
    ].includes(this.currentStroke.tool);
    if (!eligible) return;

    this.holdAnchor = { x: pt.x, y: pt.y };
    this.holdTimer = setTimeout(() => {
      if (!this.quickShapeEnabled || !this.currentStroke || this.currentStroke.points.length < 8) return;
      const detected = recognizeShape(this.currentStroke.points);
      if (detected) {
        this.snappedShape = detected;
        this._renderActiveStroke();
        this.onShapeSnapped?.(detected.kind);
      }
    }, HOLD_SHAPE_MS);
  }

  _clearHoldTimer() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  _clearCanvas(ctx, canvas) {
    if (!ctx || !canvas) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  _clearActiveCanvas() {
    this._clearCanvas(this.activeCtx, this.activeCanvas);
  }

  clearTransient() {
    this.cancelStroke();
    this.vanishingStrokes = [];
    this.laserTrail = [];
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._clearActiveCanvas();
  }

  _renderActiveStroke() {
    this._clearActiveCanvas();
    if (!this.currentStroke) return;
    const target = this.snappedShape ? { ...this.currentStroke, shape: this.snappedShape } : this.currentStroke;
    this.drawStroke(this.activeCtx, target, 1, {
      onDedicatedHighlightLayer: this.currentStroke.tool === 'highlighter',
    });
  }

  _drawIncrementalErase(stroke, idx) {
    const drawOn = (ctx) => {
      if (!ctx) return;
      const pts = stroke.points;
      if (pts.length === 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      const p = pts[idx];
      const prev = idx > 0 ? pts[idx - 1] : p;
      ctx.lineWidth = p.w;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    };
    drawOn(this.inkCtx);
    drawOn(this.highlighterCtx);
  }

  _applyDashIfNeeded(ctx, stroke) {
    if (stroke.tool !== 'dashed') return;
    const base = Math.max(2, stroke.size || 4);
    if (stroke.dashStyle === 'dotted') {
      ctx.setLineDash([0.5, base * 2.3]);
    } else {
      ctx.setLineDash([base * 3.4, base * 2.2]);
    }
  }

  /**
   * Renders any stroke or snapped geometric shape onto a target 2D canvas context.
   */
  drawStroke(ctx, stroke, alphaOverride = 1, { onDedicatedHighlightLayer = false } = {}) {
    if (!stroke || !ctx) return;
    ctx.save();

    const isChalk = stroke.tool === 'chalk';
    const isPencil = stroke.tool === 'pencil';

    if (stroke.tool === 'eraser-pixel' || stroke.tool === 'palm-eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else if (stroke.tool === 'highlighter') {
      if (!onDedicatedHighlightLayer) {
        ctx.globalCompositeOperation = stroke.isDarkBg ? 'screen' : 'multiply';
      }
      ctx.globalAlpha = 0.42 * alphaOverride;
      ctx.strokeStyle = stroke.color;
    } else if (isChalk) {
      ctx.globalAlpha = 0.88 * alphaOverride;
      ctx.strokeStyle = this._getTexturedPattern(ctx, 'chalk', stroke.color);
    } else if (isPencil) {
      ctx.globalAlpha = 0.72 * alphaOverride;
      ctx.strokeStyle = this._getTexturedPattern(ctx, 'pencil', stroke.color);
    } else if (stroke.tool === 'marker') {
      ctx.globalAlpha = 0.94 * alphaOverride;
      ctx.strokeStyle = stroke.color;
    } else if (stroke.tool === 'vanishing') {
      ctx.globalAlpha = alphaOverride;
      ctx.strokeStyle = stroke.color;
      ctx.shadowColor = stroke.color;
      ctx.shadowBlur = 14;
    } else {
      ctx.globalAlpha = alphaOverride;
      ctx.strokeStyle = stroke.color;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this._applyDashIfNeeded(ctx, stroke);

    // 1. Snapped Geometric Shape
    if (stroke.shape) {
      const sh = stroke.shape;
      ctx.lineWidth = Math.max(2, stroke.size);
      ctx.beginPath();
      if (sh.kind === 'line') {
        ctx.moveTo(sh.x1, sh.y1);
        ctx.lineTo(sh.x2, sh.y2);
      } else if (sh.kind === 'arrow') {
        ctx.moveTo(sh.x1, sh.y1);
        ctx.lineTo(sh.x2, sh.y2);
        const angle = Math.atan2(sh.y2 - sh.y1, sh.x2 - sh.x1);
        const headLen = Math.max(14, Math.min(28, stroke.size * 3.4));
        const spread = Math.PI / 6;
        ctx.moveTo(sh.x2 - headLen * Math.cos(angle - spread), sh.y2 - headLen * Math.sin(angle - spread));
        ctx.lineTo(sh.x2, sh.y2);
        ctx.lineTo(sh.x2 - headLen * Math.cos(angle + spread), sh.y2 - headLen * Math.sin(angle + spread));
      } else if (sh.kind === 'circle') {
        ctx.ellipse(sh.cx, sh.cy, Math.max(1, sh.rx), Math.max(1, sh.ry), 0, 0, Math.PI * 2);
      } else if (sh.kind === 'rect') {
        ctx.rect(sh.x, sh.y, sh.w, sh.h);
      } else if (sh.kind === 'triangle') {
        ctx.moveTo(sh.points[0].x, sh.points[0].y);
        ctx.lineTo(sh.points[1].x, sh.points[1].y);
        ctx.lineTo(sh.points[2].x, sh.points[2].y);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    const pts = stroke.points;
    if (!pts || pts.length === 0) {
      ctx.restore();
      return;
    }

    // Single tap dot
    if (pts.length === 1) {
      ctx.fillStyle = stroke.tool.includes('eraser') ? 'rgba(0,0,0,1)' : stroke.color;
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, Math.max(1, pts[0].w / 2), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // Uniform-width continuous quadratic path for Highlighter, Marker, Technical, and Dashed/Dotted
    if (
      stroke.tool === 'highlighter' ||
      stroke.tool === 'dashed' ||
      stroke.tool === 'marker' ||
      stroke.tool === 'technical'
    ) {
      ctx.lineWidth = pts[0].w;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Variable-width Quadratic Bezier midpoint smoothing for Calligraphy, Chalk, Pencil, Vanishing, legacy brushes
    for (let i = 1; i < pts.length; i++) {
      const p0 =
        i === 1 ? pts[0] : { x: (pts[i - 2].x + pts[i - 1].x) / 2, y: (pts[i - 2].y + pts[i - 1].y) / 2 };
      const p1 = pts[i - 1];
      const p2 =
        i === pts.length - 1 ? pts[i] : { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };

      ctx.lineWidth = pts[i].w;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      ctx.stroke();

      // Subtle powdery outer dust pass for Blackboard Chalk
      if (isChalk) {
        ctx.save();
        ctx.globalAlpha = 0.22 * alphaOverride;
        ctx.lineWidth = pts[i].w + 2.2;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Bright white core for Vanishing Ink
    if (stroke.tool === 'vanishing') {
      ctx.strokeStyle = '#ffffff';
      ctx.shadowBlur = 4;
      ctx.globalAlpha = 0.85 * alphaOverride;
      ctx.lineWidth = Math.max(1.5, stroke.size * 0.45);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Re-renders all committed strokes of the current page onto #highlighter-canvas and #ink-canvas.
   */
  redrawPageStrokes(strokes) {
    this._clearCanvas(this.inkCtx, this.inkCanvas);
    if (this.highlighterCtx) {
      this._clearCanvas(this.highlighterCtx, this.highlighterCanvas);
    }
    for (const stroke of strokes) {
      this._commitStrokeToLayer(stroke);
    }
  }

  /**
   * On-demand animation loop for Vanishing Ink (3.0s lifetime) and Laser Pointer.
   */
  _ensureAnimationLoop() {
    if (this._rafId !== null) return;

    const tick = (now) => {
      this._clearActiveCanvas();

      if (this.currentStroke && !this.currentStroke.tool.includes('eraser')) {
        this.drawStroke(
          this.activeCtx,
          this.snappedShape ? { ...this.currentStroke, shape: this.snappedShape } : this.currentStroke,
          1,
          { onDedicatedHighlightLayer: this.currentStroke.tool === 'highlighter' }
        );
      }

      this.vanishingStrokes = this.vanishingStrokes.filter((s) => {
        const totalMs = s.vanishDurationMs || DEFAULT_VANISH_MS;
        const fadeMs = Math.min(900, Math.max(350, totalMs * 0.35));
        const holdMs = Math.max(200, totalMs - fadeMs);
        const age = now - s.createdAt;
        if (age >= totalMs) return false;
        let alpha = 1;
        if (age > holdMs) {
          const t = (age - holdMs) / fadeMs;
          // Smooth quadratic ease-out fade curve
          alpha = (1 - t) * (1 - t);
        }
        this.drawStroke(this.activeCtx, s, Math.max(0, alpha));
        return true;
      });

      this.laserTrail = this.laserTrail.filter((p) => now - p.t < LASER_TAIL_MS);
      if (this.laserTrail.length > 0) {
        const ctx = this.activeCtx;
        const tip = this.laserTrail[this.laserTrail.length - 1];
        ctx.save();
        ctx.lineCap = 'round';
        for (let i = 1; i < this.laserTrail.length; i++) {
          const p0 = this.laserTrail[i - 1];
          const p1 = this.laserTrail[i];
          const life = 1 - (now - p1.t) / LASER_TAIL_MS;
          ctx.strokeStyle = p1.color;
          ctx.globalAlpha = life * 0.75;
          ctx.lineWidth = Math.max(2, life * 10);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.shadowColor = tip.color;
        ctx.shadowBlur = 22;
        ctx.fillStyle = tip.color;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      if (this.vanishingStrokes.length > 0 || this.laserTrail.length > 0) {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._rafId = null;
      }
    };

    this._rafId = requestAnimationFrame(tick);
  }
}
