/**
 * Captnz Board — Lasso Snip Tool
 * Crops any freehand region from the PDF/slide + ink layers and lets the user
 * move/resize it on the current page or paste it directly onto a new blank page.
 */

export class LassoSnipTool {
  constructor({ bgCanvas, inkCanvas, activeCanvas, stampLayer, actionsEl, onPasteHere, onSendToNewPage }) {
    this.bgCanvas = bgCanvas;
    this.inkCanvas = inkCanvas;
    this.activeCanvas = activeCanvas;
    this.activeCtx = activeCanvas.getContext('2d');
    this.stampLayer = stampLayer;
    this.actionsEl = actionsEl;
    this.onPasteHere = onPasteHere;
    this.onSendToNewPage = onSendToNewPage;

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

    // Composite bgCanvas + inkCanvas inside the clipped lasso polygon
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

    ctx.drawImage(
      this.bgCanvas,
      minX * bgDpr, minY * bgDpr, w * bgDpr, h * bgDpr,
      0, 0, w, h
    );
    ctx.drawImage(
      this.inkCanvas,
      minX * inkDpr, minY * inkDpr, w * inkDpr, h * inkDpr,
      0, 0, w, h
    );
    ctx.restore();

    const dataUrl = cropCanvas.toDataURL('image/png');
    cropCanvas.width = 0;
    cropCanvas.height = 0;

    this.pendingSnip = {
      id: `snip_${Date.now()}`,
      dataUrl,
      x: minX + 24,
      y: minY + 24,
      w,
      h,
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
   * Renders interactive movable/resizable stamps for the active page.
   */
  renderStamps(stamps, { getScale, onChange, onDelete }) {
    this.stampLayer.innerHTML = '';
    for (const st of stamps) {
      const el = document.createElement('div');
      el.className = 'snip-stamp';
      el.style.left = `${st.x}px`;
      el.style.top = `${st.y}px`;
      el.style.width = `${st.w}px`;
      el.style.height = `${st.h}px`;

      const img = document.createElement('img');
      img.src = st.dataUrl;
      el.appendChild(img);

      const controls = document.createElement('div');
      controls.className = 'stamp-controls';
      const delBtn = document.createElement('button');
      delBtn.className = 'stamp-btn';
      delBtn.textContent = '✕';
      delBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete?.(st.id);
      });
      controls.appendChild(delBtn);
      el.appendChild(controls);

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'stamp-resize';
      el.appendChild(resizeHandle);

      // Drag stamp
      el.addEventListener('pointerdown', (e) => {
        if (e.target === resizeHandle || e.target === delBtn) return;
        e.stopPropagation();
        el.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = st.x;
        const origY = st.y;

        const onMove = (mv) => {
          const sc = getScale?.() || 1;
          st.x = origX + (mv.clientX - startX) / sc;
          st.y = origY + (mv.clientY - startY) / sc;
          el.style.left = `${st.x}px`;
          el.style.top = `${st.y}px`;
        };
        const onUp = () => {
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerup', onUp);
          onChange?.();
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
      });

      // Resize stamp
      resizeHandle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        resizeHandle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startY = e.clientY;
        const origW = st.w;
        const origH = st.h;
        const aspect = origW / Math.max(origH, 1);

        const onMove = (mv) => {
          const sc = getScale?.() || 1;
          const nextW = Math.max(60, origW + (mv.clientX - startX) / sc);
          st.w = nextW;
          st.h = nextW / aspect;
          el.style.width = `${st.w}px`;
          el.style.height = `${st.h}px`;
        };
        const onUp = () => {
          resizeHandle.removeEventListener('pointermove', onMove);
          resizeHandle.removeEventListener('pointerup', onUp);
          onChange?.();
        };
        resizeHandle.addEventListener('pointermove', onMove);
        resizeHandle.addEventListener('pointerup', onUp);
      });

      this.stampLayer.appendChild(el);
    }
  }
}
