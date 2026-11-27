/**
 * Captnz Board — Zero-Latency Hardware-Accelerated Ink Engine
 * - Pointer Events + getCoalescedEvents()
 * - Quadratic Bezier midpoint smoothing
 * - Velocity & pressure-based stroke width variation
 * - 7 brushes/pens, Vanishing Ink (2.5s auto-fade), Red/Blue Laser, Stroke & Pixel Erasers
 */

import { maybeStraightenHighlighter, recognizeShape } from './shapeRecognizer.js';

const VANISH_HOLD_MS = 2500;
const VANISH_FADE_MS = 600;
const LASER_TAIL_MS = 260;
const HOLD_SHAPE_MS = 460;
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

export class InkEngine {
  constructor({ inkCanvas, activeCanvas, onStrokeCommitted, onStrokeErased, onShapeSnapped }) {
    this.inkCanvas = inkCanvas;
    this.activeCanvas = activeCanvas;
    this.dpr = Number(inkCanvas.dataset?.dpr) || getOptimalDpr();

    // Hardware-accelerated low-latency desynchronized 2D contexts
    this.inkCtx = inkCanvas.getContext('2d', { alpha: true, desynchronized: true });
    this.activeCtx = activeCanvas.getContext('2d', { alpha: true, desynchronized: true });

    this.onStrokeCommitted = onStrokeCommitted;
    this.onStrokeErased = onStrokeErased;
    this.onShapeSnapped = onShapeSnapped;

    this.tool = 'fountain';
    this.color = '#111827';
    this.size = 4;
    this.isDarkBackground = false;

    this.currentStroke = null;
    this.vanishingStrokes = [];
    this.laserTrail = [];
    this.laserActive = false;

    this.holdTimer = null;
    this.holdAnchor = null;
    this.snappedShape = null;

    this._rafId = null;
  }

  setDpr(dpr) {
    this.dpr = dpr;
    this.inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

  setDarkBackground(isDark) {
    this.isDarkBackground = Boolean(isDark);
  }

  /**
   * Compute dynamic width from pen pressure & pointer velocity.
   */
  _computeWidth(prevPt, pt, baseSize, tool) {
    const dt = Math.max(pt.t - (prevPt?.t ?? pt.t), 1);
    const dist = prevPt ? Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y) : 0;
    const velocity = dist / dt; // px per ms

    const hasRealPressure = pt.pressure > 0 && pt.pressure !== 0.5 && pt.pointerType === 'pen';
    const pressureFactor = hasRealPressure ? 0.45 + pt.pressure * 0.95 : 1.0;

    switch (tool) {
      case 'fountain': {
        // Slower = richer ink, faster = crisp taper (Apple Pencil feel)
        const velFactor = Math.max(0.38, Math.min(1.28, 1.22 - velocity * 0.28));
        return Math.max(1.0, baseSize * velFactor * pressureFactor);
      }
      case 'ballpoint': {
        const velFactor = Math.max(0.82, Math.min(1.08, 1.04 - velocity * 0.08));
        return Math.max(1.0, baseSize * 0.85 * velFactor * pressureFactor);
      }
      case 'calligraphy': {
        // 40-degree angled chisel nib
        const dx = prevPt ? pt.x - prevPt.x : 1;
        const dy = prevPt ? pt.y - prevPt.y : 0;
        const angle = Math.atan2(dy, dx);
        const nibAngle = (40 * Math.PI) / 180;
        const factor = 0.28 + 0.95 * Math.abs(Math.sin(angle - nibAngle));
        return Math.max(1.2, baseSize * 1.6 * factor * pressureFactor);
      }
      case 'highlighter':
        return Math.max(14, baseSize * 4.2);
      case 'pencil': {
        const velFactor = Math.max(0.65, Math.min(1.15, 1.05 - velocity * 0.14));
        return Math.max(1.0, baseSize * 0.9 * velFactor * pressureFactor);
      }
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

  beginStroke(pt, overrideTool = null) {
    const activeTool = overrideTool || this.tool;
    this.snappedShape = null;
    this._clearHoldTimer();

    if (activeTool === 'laser-red' || activeTool === 'laser-blue') {
      this.laserActive = true;
      this.laserTrail = [{ x: pt.x, y: pt.y, t: performance.now(), color: activeTool === 'laser-red' ? '#ff2a2a' : '#38bdf8' }];
      this._ensureAnimationLoop();
      return;
    }

    if (activeTool === 'eraser-stroke') {
      this.currentStroke = { tool: 'eraser-stroke', points: [pt] };
      this.onStrokeErased?.(pt, Math.max(18, this.size * 2.5));
      return;
    }

    const startWidth = this._computeWidth(null, pt, this.size, activeTool);
    this.currentStroke = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tool: activeTool,
      color: activeTool === 'vanishing' ? (this.color === '#111827' ? '#38bdf8' : this.color) : this.color,
      size: this.size,
      isDarkBg: this.isDarkBackground,
      points: [{ x: pt.x, y: pt.y, w: startWidth, t: pt.t, pressure: pt.pressure }],
      shape: null,
    };

    if (activeTool === 'eraser-pixel' || activeTool === 'palm-eraser') {
      this._drawIncrementalSegment(this.inkCtx, this.currentStroke, 0);
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
    for (const pt of points) {
      const prev = s.points[s.points.length - 1];
      const d = Math.hypot(pt.x - prev.x, pt.y - prev.y);
      if (d < 1.1) continue; // Filter micro jitter

      const rawW = this._computeWidth(prev, pt, s.size, s.tool);
      // Low-pass smooth width transitions so lines look fluid
      const smoothW = prev.w * 0.65 + rawW * 0.35;
      s.points.push({ x: pt.x, y: pt.y, w: smoothW, t: pt.t, pressure: pt.pressure });

      if (s.tool === 'eraser-pixel' || s.tool === 'palm-eraser') {
        this._drawIncrementalSegment(this.inkCtx, s, s.points.length - 1);
      }

      // Reset draw-and-hold timer if pointer moved beyond tolerance
      if (!this.holdAnchor || Math.hypot(pt.x - this.holdAnchor.x, pt.y - this.holdAnchor.y) > HOLD_MOVE_TOLERANCE) {
        this.snappedShape = null;
        this._scheduleHoldCheck(pt);
      }
    }

    if (s.tool !== 'eraser-pixel' && s.tool !== 'palm-eraser') {
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

    if (stroke.tool === 'eraser-stroke') {
      return;
    }

    // Vanishing Ink: move to fading animation queue instead of permanent page strokes
    if (stroke.tool === 'vanishing') {
      stroke.createdAt = performance.now();
      this.vanishingStrokes.push(stroke);
      this._ensureAnimationLoop();
      return;
    }

    // Auto-Shape tool always tries to snap on release
    if (stroke.tool === 'shape' && !this.snappedShape) {
      const detected = recognizeShape(stroke.points);
      if (detected) {
        this.snappedShape = detected;
        this.onShapeSnapped?.(detected.kind);
      }
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

    // Clear active preview and commit permanently
    this._clearActiveCanvas();
    this.drawStroke(this.inkCtx, stroke);
    this.onStrokeCommitted?.(stroke);
  }

  cancelStroke() {
    this._clearHoldTimer();
    this.currentStroke = null;
    this.snappedShape = null;
    this.laserActive = false;
    this._clearActiveCanvas();
  }

  _scheduleHoldCheck(pt) {
    this._clearHoldTimer();
    if (!this.currentStroke) return;
    const eligible = ['fountain', 'ballpoint', 'calligraphy', 'pencil', 'shape'].includes(this.currentStroke.tool);
    if (!eligible) return;

    this.holdAnchor = { x: pt.x, y: pt.y };
    this.holdTimer = setTimeout(() => {
      if (!this.currentStroke || this.currentStroke.points.length < 8) return;
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
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  _clearActiveCanvas() {
    this._clearCanvas(this.activeCtx, this.activeCanvas);
  }

  /**
   * Releases transient active-layer buffers when switching pages or sessions.
   */
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
    if (this.snappedShape) {
      this.drawStroke(this.activeCtx, { ...this.currentStroke, shape: this.snappedShape });
    } else {
      this.drawStroke(this.activeCtx, this.currentStroke);
    }
  }

  _drawIncrementalSegment(ctx, stroke, idx) {
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
  }

  /**
   * Renders any stroke or snapped geometric shape onto a target 2D canvas context.
   */
  drawStroke(ctx, stroke, alphaOverride = 1) {
    if (!stroke) return;
    ctx.save();

    if (stroke.tool === 'eraser-pixel' || stroke.tool === 'palm-eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else if (stroke.tool === 'highlighter') {
      ctx.globalCompositeOperation = stroke.isDarkBg ? 'screen' : 'multiply';
      ctx.globalAlpha = 0.38 * alphaOverride;
      ctx.strokeStyle = stroke.color;
    } else if (stroke.tool === 'pencil') {
      ctx.globalAlpha = 0.72 * alphaOverride;
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

    // 1. Snapped Geometric Shape
    if (stroke.shape) {
      const sh = stroke.shape;
      ctx.lineWidth = Math.max(2, stroke.size);
      ctx.beginPath();
      if (sh.kind === 'line') {
        ctx.moveTo(sh.x1, sh.y1);
        ctx.lineTo(sh.x2, sh.y2);
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

    // Highlighter uses a single smooth uniform path so multiply blend doesn't double-darken joints
    if (stroke.tool === 'highlighter') {
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

    // Variable-width Quadratic Bezier midpoint smoothing for Fountain, Ballpoint, Calligraphy, Pencil, Vanishing
    for (let i = 1; i < pts.length; i++) {
      const p0 = i === 1 ? pts[0] : { x: (pts[i - 2].x + pts[i - 1].x) / 2, y: (pts[i - 2].y + pts[i - 1].y) / 2 };
      const p1 = pts[i - 1];
      const p2 = i === pts.length - 1 ? pts[i] : { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };

      ctx.lineWidth = pts[i].w;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      ctx.stroke();

      // Subtle graphite grain pass for Sketch Pencil
      if (stroke.tool === 'pencil') {
        ctx.save();
        ctx.globalAlpha = 0.25 * alphaOverride;
        ctx.lineWidth = Math.max(0.8, pts[i].w * 0.55);
        ctx.beginPath();
        ctx.moveTo(p0.x + 1.2, p0.y - 1.1);
        ctx.quadraticCurveTo(p1.x - 1.0, p1.y + 1.2, p2.x + 0.8, p2.y + 0.9);
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
   * Re-renders all committed strokes of the current page onto #ink-canvas.
   */
  redrawPageStrokes(strokes) {
    this._clearCanvas(this.inkCtx, this.inkCanvas);
    for (const stroke of strokes) {
      this.drawStroke(this.inkCtx, stroke);
    }
  }

  /**
   * On-demand animation loop for Vanishing Ink (2.5s hold + smooth fade) and Laser Pointer.
   * Stops automatically when no transient trails remain to save 4K GPU/CPU idle work.
   */
  _ensureAnimationLoop() {
    if (this._rafId !== null) return;

    const tick = (now) => {
      this._clearActiveCanvas();

      // Keep live stroke visible if drawing simultaneously
      if (this.currentStroke && !this.currentStroke.tool.includes('eraser')) {
        this.drawStroke(
          this.activeCtx,
          this.snappedShape ? { ...this.currentStroke, shape: this.snappedShape } : this.currentStroke
        );
      }

      // Render Vanishing Ink strokes
      this.vanishingStrokes = this.vanishingStrokes.filter((s) => {
        const age = now - s.createdAt;
        if (age >= VANISH_HOLD_MS + VANISH_FADE_MS) return false;
        const alpha = age <= VANISH_HOLD_MS ? 1 : 1 - (age - VANISH_HOLD_MS) / VANISH_FADE_MS;
        this.drawStroke(this.activeCtx, s, Math.max(0, alpha));
        return true;
      });

      // Render Laser Pointer comet trail + glowing tip
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
        // Glowing laser dot
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
