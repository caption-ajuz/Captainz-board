/**
 * Captnz Board — Touch, Stylus, Pinch-Zoom/Pan, Multi-Finger Tap Shortcuts & Palm Manager
 */

const PALM_DIM_THRESHOLD = 38; // px width or height on 4K touchscreens
const PALM_AREA_THRESHOLD = 1400; // px^2
const MIN_SCALE = 0.5;
const MAX_SCALE = 5.0;
const TAP_MAX_DURATION_MS = 360;
const TAP_MAX_MOVE_PX = 18;
const TAP_STAGGER_MS = 220;

export class GestureManager {
  constructor({
    viewport,
    transformLayer,
    onDrawStart,
    onDrawMove,
    onDrawEnd,
    onDrawCancel,
    onTransformChange,
    onZoomEnd,
    onTwoFingerTap,
    onThreeFingerTap,
  }) {
    this.viewport = viewport;
    this.transformLayer = transformLayer;
    this.onDrawStart = onDrawStart;
    this.onDrawMove = onDrawMove;
    this.onDrawEnd = onDrawEnd;
    this.onDrawCancel = onDrawCancel;
    this.onTransformChange = onTransformChange;
    this.onZoomEnd = onZoomEnd;
    this.onTwoFingerTap = onTwoFingerTap;
    this.onThreeFingerTap = onThreeFingerTap;

    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.palmMode = 'eraser'; // 'eraser' | 'reject'
    this.touchLocked = false; // Stylus-Only Mode: blocks finger drawing

    this.activePointers = new Map();
    this.drawingPointerId = null;
    this.drawingPointerType = null;
    this.isPalmErasing = false;
    this.isPinching = false;
    this.pinchStart = null;
    this._tapCandidate = null;
    this._animTimer = null;
    this._zoomEndTimer = null;

    this._bindEvents();
  }

  setPalmMode(mode) {
    this.palmMode = mode;
  }

  setTouchLocked(locked) {
    this.touchLocked = Boolean(locked);
  }

  isTouchLocked() {
    return this.touchLocked;
  }

  setViewTransform({ scale = 1, tx = 0, ty = 0 }, animate = true) {
    clearTimeout(this._animTimer);
    if (animate) {
      this.transformLayer.style.transition = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
      this._animTimer = setTimeout(() => {
        this.transformLayer.style.transition = '';
      }, 250);
    } else {
      this.transformLayer.style.transition = '';
    }
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    this.tx = tx;
    this.ty = ty;
    this._clampPan();
    this._applyTransform();
    this._scheduleZoomEnd(animate ? 250 : 40);
  }

  _scheduleZoomEnd(delay = 160) {
    clearTimeout(this._zoomEndTimer);
    this._zoomEndTimer = setTimeout(() => {
      this.onZoomEnd?.({ scale: this.scale, tx: this.tx, ty: this.ty });
    }, delay);
  }

  resetZoom(animate = true) {
    this.setViewTransform({ scale: 1, tx: 0, ty: 0 }, animate);
  }

  getTransform() {
    return { scale: this.scale, tx: this.tx, ty: this.ty };
  }

  /**
   * Convert screen client coordinates into board canvas coordinates.
   */
  clientToCanvas(clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.tx) / this.scale,
      y: (clientY - rect.top - this.ty) / this.scale,
    };
  }

  _isPalmContact(e) {
    if (e.pointerType !== 'touch') return false;
    const w = e.width || 0;
    const h = e.height || 0;
    return w >= PALM_DIM_THRESHOLD || h >= PALM_DIM_THRESHOLD || w * h >= PALM_AREA_THRESHOLD;
  }

  _toBoardPoint(e) {
    const pos = this.clientToCanvas(e.clientX, e.clientY);
    return {
      x: pos.x,
      y: pos.y,
      pressure: e.pressure ?? 0.5,
      pointerType: e.pointerType,
      t: e.timeStamp || performance.now(),
      palmRadius: Math.max(e.width || 44, e.height || 44) / this.scale,
    };
  }

  _cancelActiveDraw() {
    if (this.drawingPointerId !== null) {
      this.onDrawCancel?.();
      this.drawingPointerId = null;
      this.drawingPointerType = null;
      this.isPalmErasing = false;
    }
  }

  _bindEvents() {
    this.viewport.addEventListener('pointerdown', (e) => {
      // Ignore UI controls overlaying the viewport
      if (e.target !== this.viewport && e.target !== this.transformLayer) return;
      if (e.button === 2) return;
      clearTimeout(this._animTimer);
      this.transformLayer.style.transition = '';

      // In Stylus-Only Mode (touchLocked), resting touch/palm never interrupts an active stylus/mouse stroke
      if (this.touchLocked && e.pointerType === 'touch' && this.drawingPointerId !== null) {
        return;
      }

      // Palm detection
      if (this._isPalmContact(e)) {
        if (this.touchLocked || this.palmMode === 'reject') return;
        this.viewport.setPointerCapture(e.pointerId);
        this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pointerType: e.pointerType });
        this._tapCandidate = null;
        this.isPalmErasing = true;
        this.drawingPointerId = e.pointerId;
        this.drawingPointerType = e.pointerType;
        this.onDrawStart?.(this._toBoardPoint(e), 'palm-eraser');
        return;
      }

      this.viewport.setPointerCapture(e.pointerId);
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pointerType: e.pointerType });

      // Multi-finger tap candidate tracking (2-finger Undo / 3-finger Redo)
      if (e.pointerType === 'touch') {
        const now = performance.now();
        if (this.activePointers.size === 1) {
          this._tapCandidate = {
            startTime: now,
            maxPointers: 1,
            cancelled: false,
            preTransform: { scale: this.scale, tx: this.tx, ty: this.ty },
            pointers: new Map([[e.pointerId, { startX: e.clientX, startY: e.clientY }]]),
          };
        } else if (
          this._tapCandidate &&
          !this._tapCandidate.cancelled &&
          now - this._tapCandidate.startTime <= TAP_STAGGER_MS &&
          this.activePointers.size <= 3
        ) {
          this._tapCandidate.pointers.set(e.pointerId, { startX: e.clientX, startY: e.clientY });
          this._tapCandidate.maxPointers = Math.max(this._tapCandidate.maxPointers, this.activePointers.size);
        } else if (this._tapCandidate) {
          this._tapCandidate.cancelled = true;
        }
      } else {
        this._tapCandidate = null;
      }

      // Three-finger touch (potential 3-finger tap Redo): stop pinch & drawing
      if (this.activePointers.size === 3) {
        this._cancelActiveDraw();
        this.isPinching = false;
        this.pinchStart = null;
        return;
      }

      // Two-finger pinch-to-zoom & pan (or 2-finger tap Undo)
      if (this.activePointers.size === 2) {
        this._cancelActiveDraw();
        this._startPinch();
        return;
      }

      if (this.activePointers.size > 3) {
        if (this._tapCandidate) this._tapCandidate.cancelled = true;
        return;
      }

      // Stylus-Only Mode: block finger drawing while still allowing stylus & mouse
      if (this.touchLocked && e.pointerType === 'touch') {
        return;
      }

      // Single-touch / stylus / mouse drawing
      this.drawingPointerId = e.pointerId;
      this.drawingPointerType = e.pointerType;
      this.isPalmErasing = false;
      this.onDrawStart?.(this._toBoardPoint(e), null);
    });

    this.viewport.addEventListener('pointermove', (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, pointerType: e.pointerType });

      if (this._tapCandidate && !this._tapCandidate.cancelled) {
        const origin = this._tapCandidate.pointers.get(e.pointerId);
        if (origin && Math.hypot(e.clientX - origin.startX, e.clientY - origin.startY) > TAP_MAX_MOVE_PX) {
          this._tapCandidate.cancelled = true;
        }
      }

      if (this.isPinching && this.activePointers.size === 2) {
        this._updatePinch();
        return;
      }

      if (e.pointerId !== this.drawingPointerId) return;

      // Zero-lag high-frequency input via getCoalescedEvents()
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      const rawEvents = coalesced.length > 0 ? coalesced : [e];
      const pts = rawEvents.map((ev) => this._toBoardPoint(ev));
      this.onDrawMove?.(pts);
    });

    const handleEnd = (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.delete(e.pointerId);

      if (e.type === 'pointercancel' && this._tapCandidate) {
        this._tapCandidate.cancelled = true;
      }

      if (this.isPinching && this.activePointers.size < 2) {
        this.isPinching = false;
        this.pinchStart = null;
        this._scheduleZoomEnd(120);
      }

      if (e.pointerId === this.drawingPointerId) {
        this.drawingPointerId = null;
        this.drawingPointerType = null;
        this.isPalmErasing = false;
        this.onDrawEnd?.();
      }

      // Fire 2-finger Undo / 3-finger Redo when all fingers lift after a clean quick tap
      if (this.activePointers.size === 0 && this._tapCandidate) {
        const candidate = this._tapCandidate;
        this._tapCandidate = null;
        const elapsed = performance.now() - candidate.startTime;
        if (!candidate.cancelled && elapsed <= TAP_MAX_DURATION_MS && candidate.maxPointers >= 2) {
          // Restore any sub-threshold pinch/pan jitter that occurred during tap
          if (candidate.preTransform) {
            this.scale = candidate.preTransform.scale;
            this.tx = candidate.preTransform.tx;
            this.ty = candidate.preTransform.ty;
            this._applyTransform();
          }
          if (candidate.maxPointers === 2) {
            this.onTwoFingerTap?.();
          } else if (candidate.maxPointers === 3) {
            this.onThreeFingerTap?.();
          }
        }
      }
    };

    this.viewport.addEventListener('pointerup', handleEnd);
    this.viewport.addEventListener('pointercancel', handleEnd);

    // Desktop mouse Ctrl+Wheel zoom & regular wheel vertical/horizontal pan
    this.viewport.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        clearTimeout(this._animTimer);
        this.transformLayer.style.transition = '';

        if (!e.ctrlKey && !e.metaKey) {
          const panX = e.shiftKey ? -e.deltaY : -e.deltaX;
          const panY = e.shiftKey ? 0 : -e.deltaY;
          this.tx += panX;
          this.ty += panY;
          this._clampPan();
          this._applyTransform();
          return;
        }

        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));
        const rect = this.viewport.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        this.tx = cx - ((cx - this.tx) / this.scale) * nextScale;
        this.ty = cy - ((cy - this.ty) / this.scale) * nextScale;
        this.scale = nextScale;
        this._clampPan();
        this._applyTransform();
        this._scheduleZoomEnd(180);
      },
      { passive: false }
    );
  }

  _clampPan() {
    const rect = this.viewport.getBoundingClientRect();
    const w = rect.width || window.innerWidth || 1920;
    const h = rect.height || window.innerHeight || 1080;
    const minTx = w * 0.2 - w * this.scale;
    const maxTx = w * 0.8;
    const minTy = h * 0.15 - h * this.scale;
    const maxTy = h * 0.85;
    this.tx = Math.max(minTx, Math.min(maxTx, this.tx));
    this.ty = Math.max(minTy, Math.min(maxTy, this.ty));
  }

  _startPinch() {
    const [p1, p2] = Array.from(this.activePointers.values());
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    this.isPinching = true;
    this.pinchStart = {
      dist: Math.max(dist, 1),
      midX,
      midY,
      scale: this.scale,
      tx: this.tx,
      ty: this.ty,
    };
  }

  _updatePinch() {
    const [p1, p2] = Array.from(this.activePointers.values());
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;

    const ratio = dist / this.pinchStart.dist;
    const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.pinchStart.scale * ratio));

    const worldX = (this.pinchStart.midX - this.pinchStart.tx) / this.pinchStart.scale;
    const worldY = (this.pinchStart.midY - this.pinchStart.ty) / this.pinchStart.scale;

    this.scale = nextScale;
    this.tx = midX - worldX * nextScale;
    this.ty = midY - worldY * nextScale;
    this._clampPan();
    this._applyTransform();
  }

  _applyTransform() {
    this.transformLayer.style.transform = `translate3d(${this.tx}px, ${this.ty}px, 0) scale(${this.scale})`;
    this.onTransformChange?.({ scale: this.scale, tx: this.tx, ty: this.ty });
  }
}
