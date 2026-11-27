/**
 * Captnz Board — Lasso Snip & Interactive Stamp/Sticky-Note Layer
 * Handles freehand region snips, resizable/rotatable vector SVG stencils,
 * Periodic Table element badges, and movable/editable Sticky Notes with optional Grid Snap.
 */

const GRID_STEP = 24;

function snapVal(v, enabled) {
  return enabled ? Math.round(v / GRID_STEP) * GRID_STEP : v;
}

export function svgMarkupToDataUrl(svgMarkup) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
}

export class LassoSnipTool {
  constructor({
    bgCanvas,
    highlighterCanvas = null,
    inkCanvas,
    activeCanvas,
    stampLayer,
    actionsEl,
    onPasteHere,
    onSendToNewPage,
  }) {
    this.bgCanvas = bgCanvas;
    this.highlighterCanvas = highlighterCanvas;
    this.inkCanvas = inkCanvas;
    this.activeCanvas = activeCanvas;
    this.activeCtx = activeCanvas.getContext('2d');
    this.stampLayer = stampLayer;
    this.actionsEl = actionsEl;
    this.onPasteHere = onPasteHere;
    this.onSendToNewPage = onSendToNewPage;
    this.isDarkBackground = false;

    this.points = [];
    this.pendingSnip = null;

    document.getElementById('btn-lasso-move')?.addEventListener('click', () => {
      if (!this.pendingSnip) return;
      const snip = this.pendingSnip;
      this.clearSelection();
      this.onPasteHere?.(snip);
    });

    document.getElementById('btn-lasso-new-page')?.addEventListener('click', () => {
      if (!this.pendingSnip) return;
      const snip = this.pendingSnip;
      this.clearSelection();
      this.onSendToNewPage?.(snip);
    });

    document.getElementById('btn-lasso-cancel')?.addEventListener('click', () => {
      this.clearSelection();
    });
  }

  setDarkBackground(isDark) {
    this.isDarkBackground = Boolean(isDark);
  }

  begin(pt) {
    this.clearSelection();
    this.points = [pt];
    this._drawMarquee();
  }

  extend(pts) {
    for (const p of pts) this.points.push(p);
    this._drawMarquee();
  }

  end() {
    if (this.points.length < 5) {
      this.clearSelection();
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    const w = Math.round(maxX - minX);
    const h = Math.round(maxY - minY);
    if (w < 20 || h < 20) {
      this.clearSelection();
      return;
    }

    const bgDpr = Number(this.bgCanvas.dataset?.dpr) || this.bgCanvas.width / this.bgCanvas.clientWidth || 1;
    const inkDpr = Number(this.inkCanvas.dataset?.dpr) || this.inkCanvas.width / this.inkCanvas.clientWidth || 1;
    const cropDpr = Math.max(bgDpr, inkDpr);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.round(w * cropDpr);
    cropCanvas.height = Math.round(h * cropDpr);
    const ctx = cropCanvas.getContext('2d');
    ctx.scale(cropDpr, cropDpr);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.points[0].x - minX, this.points[0].y - minY);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x - minX, this.points[i].y - minY);
    }
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(this.bgCanvas, minX * bgDpr, minY * bgDpr, w * bgDpr, h * bgDpr, 0, 0, w, h);
    if (this.highlighterCanvas) {
      const hlDpr = Number(this.highlighterCanvas.dataset?.dpr) || inkDpr;
      ctx.save();
      ctx.globalCompositeOperation = this.isDarkBackground ? 'screen' : 'multiply';
      ctx.drawImage(this.highlighterCanvas, minX * hlDpr, minY * hlDpr, w * hlDpr, h * hlDpr, 0, 0, w, h);
      ctx.restore();
    }
    ctx.drawImage(this.inkCanvas, minX * inkDpr, minY * inkDpr, w * inkDpr, h * inkDpr, 0, 0, w, h);
    ctx.restore();

    const dataUrl = cropCanvas.toDataURL('image/png');
    cropCanvas.width = 0;
    cropCanvas.height = 0;

    this.pendingSnip = {
      id: `snip_${Date.now()}`,
      kind: 'image',
      dataUrl,
      x: minX + 24,
      y: minY + 24,
      w,
      h,
      rot: 0,
    };

    this.actionsEl.classList.remove('hidden');
  }

  clearSelection() {
    this.points = [];
    this.pendingSnip = null;
    this.activeCtx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
    this.actionsEl.classList.add('hidden');
  }

  _drawMarquee() {
    const ctx = this.activeCtx;
    ctx.clearRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
    if (this.points.length < 2) return;

    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.12)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Renders interactive movable/resizable/rotatable stamps & sticky notes for the active page.
   */
  renderStamps(stamps, { getScale, getGridSnap, onChange, onDelete }) {
    this.stampLayer.innerHTML = '';
    for (const st of stamps) {
      if (st.kind === 'sticky') {
        this._renderStickyNote(st, { getScale, getGridSnap, onChange, onDelete });
      } else {
        this._renderGraphicStamp(st, { getScale, getGridSnap, onChange, onDelete });
      }
    }
  }

  _renderGraphicStamp(st, { getScale, getGridSnap, onChange, onDelete }) {
    const el = document.createElement('div');
    el.className = `snip-stamp${st.kind === 'svg' ? ' vector-stamp' : ''}`;
    el.style.left = `${st.x}px`;
    el.style.top = `${st.y}px`;
    el.style.width = `${st.w}px`;
    el.style.height = `${st.h}px`;
    if (st.rot) {
      el.style.transform = `rotate(${st.rot}deg)`;
    }

    const img = document.createElement('img');
    img.src = st.svgMarkup ? svgMarkupToDataUrl(st.svgMarkup) : st.dataUrl;
    img.alt = st.label || 'Board stamp';
    el.appendChild(img);

    const controls = document.createElement('div');
    controls.className = 'stamp-controls';
    const delBtn = document.createElement('button');
    delBtn.className = 'stamp-btn';
    delBtn.title = 'Remove';
    delBtn.textContent = '✕';
    delBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete?.(st.id);
    });
    controls.appendChild(delBtn);
    el.appendChild(controls);

    // Rotation handle (especially useful for Chemistry apparatus, bonds & Coordinate Axes)
    const rotateHandle = document.createElement('div');
    rotateHandle.className = 'stamp-rotate';
    rotateHandle.title = 'Drag to rotate';
    rotateHandle.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><polyline points="21 3 21 8 16 8"/></svg>';
    el.appendChild(rotateHandle);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'stamp-resize';
    resizeHandle.title = 'Drag to resize';
    el.appendChild(resizeHandle);

    // Drag stamp
    el.addEventListener('pointerdown', (e) => {
      if (e.target === resizeHandle || e.target === rotateHandle || rotateHandle.contains(e.target) || e.target === delBtn) {
        return;
      }
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = st.x;
      const origY = st.y;

      const onMove = (mv) => {
        const sc = getScale?.() || 1;
        const snap = Boolean(getGridSnap?.());
        st.x = snapVal(origX + (mv.clientX - startX) / sc, snap);
        st.y = snapVal(origY + (mv.clientY - startY) / sc, snap);
        el.style.left = `${st.x}px`;
        el.style.top = `${st.y}px`;
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        onChange?.();
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });

    // Rotate stamp around center
    rotateHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      rotateHandle.setPointerCapture(e.pointerId);

      const onMove = (mv) => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let deg = Math.round((Math.atan2(mv.clientY - cy, mv.clientX - cx) * 180) / Math.PI + 90);
        // Subtle 15° snap when close to cardinal/common chemistry angles
        const nearest15 = Math.round(deg / 15) * 15;
        if (Math.abs(deg - nearest15) <= 3) deg = nearest15;
        st.rot = ((deg % 360) + 360) % 360;
        el.style.transform = `rotate(${st.rot}deg)`;
      };
      const onUp = () => {
        rotateHandle.removeEventListener('pointermove', onMove);
        rotateHandle.removeEventListener('pointerup', onUp);
        rotateHandle.removeEventListener('pointercancel', onUp);
        onChange?.();
      };
      rotateHandle.addEventListener('pointermove', onMove);
      rotateHandle.addEventListener('pointerup', onUp);
      rotateHandle.addEventListener('pointercancel', onUp);
    });

    // Resize stamp
    resizeHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      resizeHandle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const origW = st.w;
      const origH = st.h;
      const aspect = origW / Math.max(origH, 1);

      const onMove = (mv) => {
        const sc = getScale?.() || 1;
        const nextW = Math.max(48, origW + (mv.clientX - startX) / sc);
        st.w = nextW;
        st.h = nextW / aspect;
        el.style.width = `${st.w}px`;
        el.style.height = `${st.h}px`;
      };
      const onUp = () => {
        resizeHandle.removeEventListener('pointermove', onMove);
        resizeHandle.removeEventListener('pointerup', onUp);
        resizeHandle.removeEventListener('pointercancel', onUp);
        onChange?.();
      };
      resizeHandle.addEventListener('pointermove', onMove);
      resizeHandle.addEventListener('pointerup', onUp);
      resizeHandle.addEventListener('pointercancel', onUp);
    });

    this.stampLayer.appendChild(el);
  }

  _renderStickyNote(st, { getScale, getGridSnap, onChange, onDelete }) {
    const el = document.createElement('div');
    el.className = 'sticky-note';
    el.style.left = `${st.x}px`;
    el.style.top = `${st.y}px`;
    el.style.width = `${st.w}px`;
    el.style.height = `${st.h}px`;
    el.style.setProperty('--note-bg', st.color || '#fef08a');

    const header = document.createElement('div');
    header.className = 'sticky-note-header';

    const title = document.createElement('span');
    title.className = 'sticky-note-grip';
    title.textContent = 'Note';
    header.appendChild(title);

    const delBtn = document.createElement('button');
    delBtn.className = 'sticky-note-del';
    delBtn.title = 'Delete note';
    delBtn.textContent = '✕';
    delBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete?.(st.id);
    });
    header.appendChild(delBtn);
    el.appendChild(header);

    const textarea = document.createElement('textarea');
    textarea.className = 'sticky-note-body';
    textarea.placeholder = 'Write note...';
    textarea.value = st.text || '';
    textarea.addEventListener('pointerdown', (e) => e.stopPropagation());
    textarea.addEventListener('keydown', (e) => e.stopPropagation());
    textarea.addEventListener('input', () => {
      st.text = textarea.value;
      onChange?.();
    });
    el.appendChild(textarea);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'stamp-resize sticky-resize';
    el.appendChild(resizeHandle);

    // Drag sticky note by header
    header.addEventListener('pointerdown', (e) => {
      if (e.target === delBtn) return;
      e.stopPropagation();
      header.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = st.x;
      const origY = st.y;

      const onMove = (mv) => {
        const sc = getScale?.() || 1;
        const snap = Boolean(getGridSnap?.());
        st.x = snapVal(origX + (mv.clientX - startX) / sc, snap);
        st.y = snapVal(origY + (mv.clientY - startY) / sc, snap);
        el.style.left = `${st.x}px`;
        el.style.top = `${st.y}px`;
      };
      const onUp = () => {
        header.removeEventListener('pointermove', onMove);
        header.removeEventListener('pointerup', onUp);
        header.removeEventListener('pointercancel', onUp);
        onChange?.();
      };
      header.addEventListener('pointermove', onMove);
      header.addEventListener('pointerup', onUp);
      header.addEventListener('pointercancel', onUp);
    });

    // Resize sticky note freely
    resizeHandle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      resizeHandle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startY = e.clientY;
      const origW = st.w;
      const origH = st.h;

      const onMove = (mv) => {
        const sc = getScale?.() || 1;
        const snap = Boolean(getGridSnap?.());
        st.w = Math.max(150, snapVal(origW + (mv.clientX - startX) / sc, snap));
        st.h = Math.max(120, snapVal(origH + (mv.clientY - startY) / sc, snap));
        el.style.width = `${st.w}px`;
        el.style.height = `${st.h}px`;
      };
      const onUp = () => {
        resizeHandle.removeEventListener('pointermove', onMove);
        resizeHandle.removeEventListener('pointerup', onUp);
        resizeHandle.removeEventListener('pointercancel', onUp);
        onChange?.();
      };
      resizeHandle.addEventListener('pointermove', onMove);
      resizeHandle.addEventListener('pointerup', onUp);
      resizeHandle.addEventListener('pointercancel', onUp);
    });

    this.stampLayer.appendChild(el);
  }
}
