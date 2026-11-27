/**
 * Captnz Board — Interactive Geometry Kit (Ruler with Pen Edge-Snapping, Protractor, Compass)
 * Lives inside #geometry-layer (board coordinate space) so it aligns seamlessly with 4K pan/zoom.
 */

export class GeometryKitManager {
  constructor({ layerEl, inkEngine, getScale, getActiveStyle, onToolToggled }) {
    this.layerEl = layerEl;
    this.inkEngine = inkEngine;
    this.getScale = getScale;
    this.getActiveStyle = getActiveStyle;
    this.onToolToggled = onToolToggled;

    this.ruler = {
      active: false,
      x: 240,
      y: 260,
      w: 520,
      h: 72,
      angle: 0, // degrees
      el: null,
    };

    this.protractor = {
      active: false,
      cx: 480,
      cy: 480,
      r: 170,
      bodyAngle: 0,
      measureAngle: 45,
      el: null,
    };

    this.compass = {
      active: false,
      cx: 540,
      cy: 420,
      radius: 130,
      angle: -30,
      el: null,
    };

    // Wire pen edge-snapping hook into InkEngine
    this.inkEngine.setSnapPointTransform((pt) => this.snapPointToRuler(pt));
  }

  isActive(toolName) {
    return Boolean(this[toolName]?.active);
  }

  toggle(toolName) {
    const tool = this[toolName];
    if (!tool) return false;
    tool.active = !tool.active;
    if (tool.active) {
      this._centerToolInView(toolName);
    }
    this._render();
    this.onToolToggled?.(toolName, tool.active);
    return tool.active;
  }

  _centerToolInView(toolName) {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    if (toolName === 'ruler') {
      this.ruler.x = Math.max(80, cx - this.ruler.w / 2);
      this.ruler.y = Math.max(80, cy - this.ruler.h / 2);
    } else if (toolName === 'protractor') {
      this.protractor.cx = cx;
      this.protractor.cy = cy + 40;
    } else if (toolName === 'compass') {
      this.compass.cx = cx;
      this.compass.cy = cy;
    }
  }

  /**
   * Projects incoming pen coordinates onto the Ruler's top or bottom straight edge
   * when the pointer is within snap distance (~24px) of the ruler edge.
   */
  snapPointToRuler(pt) {
    if (!this.ruler.active) return null;
    const scale = this.getScale?.() || 1;
    const snapDist = 24 / Math.max(scale, 0.5);

    const cx = this.ruler.x + this.ruler.w / 2;
    const cy = this.ruler.y + this.ruler.h / 2;
    const rad = (this.ruler.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Transform board point into ruler-local coordinates (centered at ruler center)
    const dx = pt.x - cx;
    const dy = pt.y - cy;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;

    const halfW = this.ruler.w / 2 + 14;
    const halfH = this.ruler.h / 2;
    if (Math.abs(lx) > halfW) return null;

    let snappedLy = null;
    if (Math.abs(ly - -halfH) <= snapDist) {
      snappedLy = -halfH;
    } else if (Math.abs(ly - halfH) <= snapDist) {
      snappedLy = halfH;
    }
    if (snappedLy === null) return null;

    const clampedLx = Math.max(-this.ruler.w / 2, Math.min(this.ruler.w / 2, lx));
    return {
      x: cx + clampedLx * cos - snappedLy * sin,
      y: cy + clampedLx * sin + snappedLy * cos,
      snapped: true,
    };
  }

  _render() {
    this.layerEl.innerHTML = '';
    if (this.ruler.active) this._buildRuler();
    if (this.protractor.active) this._buildProtractor();
    if (this.compass.active) this._buildCompass();
  }

  _buildRuler() {
    const r = this.ruler;
    const el = document.createElement('div');
    el.className = 'geo-tool geo-ruler';
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
    el.style.transform = `rotate(${r.angle}deg)`;

    const ticks = [];
    for (let px = 10, cm = 0; px <= r.w - 10; px += 10, cm++) {
      const isMajor = cm % 5 === 0;
      const isCm = cm % 10 === 0;
      const h = isCm ? 18 : isMajor ? 13 : 8;
      ticks.push(`<line x1="${px}" y1="0" x2="${px}" y2="${h}" stroke="currentColor" stroke-width="${isCm ? 1.6 : 1}"/>`);
      ticks.push(`<line x1="${px}" y1="${r.h}" x2="${px}" y2="${r.h - h}" stroke="currentColor" stroke-width="${isCm ? 1.6 : 1}"/>`);
      if (isCm) {
        ticks.push(`<text x="${px + 3}" y="29" font-size="10" font-weight="700" fill="currentColor">${cm / 10}</text>`);
      }
    }

    el.innerHTML = `
      <svg class="geo-ruler-svg" viewBox="0 0 ${r.w} ${r.h}" width="${r.w}" height="${r.h}">
        ${ticks.join('')}
      </svg>
      <div class="geo-hud-pill">
        <span class="geo-angle-label">${Math.round(r.angle)}°</span>
        <button class="geo-close-btn" title="Hide Ruler" type="button">✕</button>
      </div>
      <div class="geo-rotate-knob" title="Drag to rotate ruler"></div>
    `;

    el.querySelector('.geo-close-btn').addEventListener('pointerdown', (e) => e.stopPropagation());
    el.querySelector('.geo-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle('ruler');
    });

    // Drag ruler
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.geo-rotate-knob') || e.target.closest('.geo-close-btn')) return;
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const sx = e.clientX;
      const sy = e.clientY;
      const ox = r.x;
      const oy = r.y;

      const onMove = (mv) => {
        const sc = this.getScale?.() || 1;
        r.x = ox + (mv.clientX - sx) / sc;
        r.y = oy + (mv.clientY - sy) / sc;
        el.style.left = `${r.x}px`;
        el.style.top = `${r.y}px`;
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });

    // Rotate ruler around center
    const knob = el.querySelector('.geo-rotate-knob');
    const angleLabel = el.querySelector('.geo-angle-label');
    knob.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      knob.setPointerCapture(e.pointerId);
      const onMove = (mv) => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let deg = (Math.atan2(mv.clientY - cy, mv.clientX - cx) * 180) / Math.PI;
        const nearest15 = Math.round(deg / 15) * 15;
        if (Math.abs(deg - nearest15) <= 2.5) deg = nearest15;
        r.angle = ((Math.round(deg * 10) / 10) % 360 + 360) % 360;
        el.style.transform = `rotate(${r.angle}deg)`;
        angleLabel.textContent = `${r.angle.toFixed(0)}°`;
      };
      const onUp = () => {
        knob.removeEventListener('pointermove', onMove);
        knob.removeEventListener('pointerup', onUp);
        knob.removeEventListener('pointercancel', onUp);
      };
      knob.addEventListener('pointermove', onMove);
      knob.addEventListener('pointerup', onUp);
      knob.addEventListener('pointercancel', onUp);
    });

    this.layerEl.appendChild(el);
    r.el = el;
  }

  _buildProtractor() {
    const p = this.protractor;
    const rad = p.r;
    const w = rad * 2 + 24;
    const h = rad + 36;
    const ox = w / 2;
    const oy = rad + 12;

    const el = document.createElement('div');
    el.className = 'geo-tool geo-protractor';
    el.style.left = `${p.cx - ox}px`;
    el.style.top = `${p.cy - oy}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.transformOrigin = `${ox}px ${oy}px`;
    el.style.transform = `rotate(${p.bodyAngle}deg)`;

    const ticks = [];
    for (let deg = 0; deg <= 180; deg += 2) {
      const a = (deg * Math.PI) / 180;
      const is10 = deg % 10 === 0;
      const is5 = deg % 5 === 0;
      const len = is10 ? 18 : is5 ? 12 : 7;
      const x1 = ox + Math.cos(a) * rad;
      const y1 = oy - Math.sin(a) * rad;
      const x2 = ox + Math.cos(a) * (rad - len);
      const y2 = oy - Math.sin(a) * (rad - len);
      ticks.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="currentColor" stroke-width="${is10 ? 1.6 : 0.9}" opacity="${is5 ? 0.9 : 0.55}"/>`);
      if (deg % 30 === 0) {
        const tx = ox + Math.cos(a) * (rad - 30);
        const ty = oy - Math.sin(a) * (rad - 30) + 4;
        ticks.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="currentColor">${deg}°</text>`);
      }
    }

    const mRad = (p.measureAngle * Math.PI) / 180;
    const mx = ox + Math.cos(mRad) * (rad + 8);
    const my = oy - Math.sin(mRad) * (rad + 8);

    el.innerHTML = `
      <svg class="geo-protractor-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
        <path d="M ${ox - rad} ${oy} A ${rad} ${rad} 0 0 1 ${ox + rad} ${oy} Z" class="geo-protractor-arc"/>
        ${ticks.join('')}
        <line x1="${ox - 12}" y1="${oy}" x2="${ox + 12}" y2="${oy}" stroke="currentColor" stroke-width="1.6"/>
        <line x1="${ox}" y1="${oy - 12}" x2="${ox}" y2="${oy + 12}" stroke="currentColor" stroke-width="1.6"/>
        <line class="geo-arm-line" x1="${ox}" y1="${oy}" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#3b82f6" stroke-width="2.4" stroke-dasharray="5 3"/>
      </svg>
      <div class="geo-hud-pill geo-protractor-hud">
        <span class="geo-angle-readout">${p.measureAngle.toFixed(1)}°</span>
        <button class="geo-close-btn" title="Hide Protractor" type="button">✕</button>
      </div>
      <div class="geo-arm-knob" style="left:${mx}px;top:${my}px" title="Drag to measure angle"></div>
    `;

    el.querySelector('.geo-close-btn').addEventListener('pointerdown', (e) => e.stopPropagation());
    el.querySelector('.geo-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle('protractor');
    });

    // Drag protractor body
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.geo-arm-knob') || e.target.closest('.geo-close-btn')) return;
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const sx = e.clientX;
      const sy = e.clientY;
      const ocx = p.cx;
      const ocy = p.cy;
      const onMove = (mv) => {
        const sc = this.getScale?.() || 1;
        p.cx = ocx + (mv.clientX - sx) / sc;
        p.cy = ocy + (mv.clientY - sy) / sc;
        el.style.left = `${p.cx - ox}px`;
        el.style.top = `${p.cy - oy}px`;
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });

    // Drag measurement arm for live angle readout
    const armKnob = el.querySelector('.geo-arm-knob');
    const armLine = el.querySelector('.geo-arm-line');
    const readout = el.querySelector('.geo-angle-readout');
    armKnob.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      armKnob.setPointerCapture(e.pointerId);
      const onMove = (mv) => {
        const rect = el.getBoundingClientRect();
        const sc = rect.width / w;
        const pivotClientX = rect.left + ox * sc;
        const pivotClientY = rect.top + oy * sc;
        let deg = (Math.atan2(pivotClientY - mv.clientY, mv.clientX - pivotClientX) * 180) / Math.PI;
        if (deg < 0) deg = deg > -90 ? 0 : 180;
        deg = Math.max(0, Math.min(180, deg));
        const nearest5 = Math.round(deg / 5) * 5;
        if (Math.abs(deg - nearest5) <= 1.2) deg = nearest5;
        p.measureAngle = Math.round(deg * 10) / 10;
        const ar = (p.measureAngle * Math.PI) / 180;
        const nx = ox + Math.cos(ar) * (rad + 8);
        const ny = oy - Math.sin(ar) * (rad + 8);
        armLine.setAttribute('x2', nx.toFixed(1));
        armLine.setAttribute('y2', ny.toFixed(1));
        armKnob.style.left = `${nx}px`;
        armKnob.style.top = `${ny}px`;
        readout.textContent = `${p.measureAngle.toFixed(1)}°`;
      };
      const onUp = () => {
        armKnob.removeEventListener('pointermove', onMove);
        armKnob.removeEventListener('pointerup', onUp);
        armKnob.removeEventListener('pointercancel', onUp);
      };
      armKnob.addEventListener('pointermove', onMove);
      armKnob.addEventListener('pointerup', onUp);
      armKnob.addEventListener('pointercancel', onUp);
    });

    this.layerEl.appendChild(el);
    p.el = el;
  }

  _buildCompass() {
    const c = this.compass;
    const el = document.createElement('div');
    el.className = 'geo-tool geo-compass';
    el.style.left = `${c.cx}px`;
    el.style.top = `${c.cy}px`;

    const rad = (c.angle * Math.PI) / 180;
    const tipX = Math.cos(rad) * c.radius;
    const tipY = Math.sin(rad) * c.radius;

    el.innerHTML = `
      <svg class="geo-compass-svg" viewBox="-260 -260 520 520" width="520" height="520">
        <circle cx="0" cy="0" r="${c.radius}" stroke="currentColor" stroke-width="1.4" stroke-dasharray="5 5" opacity="0.45"/>
        <line class="geo-compass-arm" x1="0" y1="0" x2="${tipX.toFixed(1)}" y2="${tipY.toFixed(1)}" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
      </svg>
      <div class="geo-compass-pivot" title="Drag pivot to move compass">
        <span class="geo-compass-needle"></span>
      </div>
      <div class="geo-hud-pill geo-compass-hud">
        <span class="geo-compass-readout">r: ${Math.round(c.radius)}px</span>
        <button class="geo-stamp-circle-btn" title="Draw full circle" type="button">◯ Draw</button>
        <button class="geo-close-btn" title="Hide Compass" type="button">✕</button>
      </div>
      <div class="geo-compass-tip" style="left:${tipX}px;top:${tipY}px" title="Drag radially to resize, sweep around to draw arc">✎</div>
    `;

    el.querySelector('.geo-close-btn').addEventListener('pointerdown', (e) => e.stopPropagation());
    el.querySelector('.geo-close-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle('compass');
    });

    el.querySelector('.geo-stamp-circle-btn').addEventListener('pointerdown', (e) => e.stopPropagation());
    el.querySelector('.geo-stamp-circle-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const style = this.getActiveStyle?.() || { color: '#111827', size: 4, tool: 'technical' };
      const tool = style.tool === 'dashed' ? 'dashed' : 'technical';
      this.inkEngine.commitSyntheticStroke({
        id: `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tool,
        dashStyle: style.dashStyle || 'dashed',
        color: style.color,
        size: Math.max(2, style.size),
        isDarkBg: this.inkEngine.isDarkBackground,
        points: [],
        shape: { kind: 'circle', cx: c.cx, cy: c.cy, rx: c.radius, ry: c.radius },
      });
    });

    // Move pivot
    const pivot = el.querySelector('.geo-compass-pivot');
    pivot.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      pivot.setPointerCapture(e.pointerId);
      const sx = e.clientX;
      const sy = e.clientY;
      const ocx = c.cx;
      const ocy = c.cy;
      const onMove = (mv) => {
        const sc = this.getScale?.() || 1;
        c.cx = ocx + (mv.clientX - sx) / sc;
        c.cy = ocy + (mv.clientY - sy) / sc;
        el.style.left = `${c.cx}px`;
        el.style.top = `${c.cy}px`;
      };
      const onUp = () => {
        pivot.removeEventListener('pointermove', onMove);
        pivot.removeEventListener('pointerup', onUp);
        pivot.removeEventListener('pointercancel', onUp);
      };
      pivot.addEventListener('pointermove', onMove);
      pivot.addEventListener('pointerup', onUp);
      pivot.addEventListener('pointercancel', onUp);
    });

    // Pencil tip: sweep around pivot to draw a live arc stroke, or pull radially to adjust radius
    const tip = el.querySelector('.geo-compass-tip');
    const arm = el.querySelector('.geo-compass-arm');
    const guideCircle = el.querySelector('circle');
    const readout = el.querySelector('.geo-compass-readout');

    tip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      tip.setPointerCapture(e.pointerId);
      const style = this.getActiveStyle?.() || { color: '#111827', size: 4, tool: 'technical' };
      const drawTool = style.tool === 'dashed' ? 'dashed' : 'technical';
      let mode = null; // 'resize' | 'draw'
      let startAngle = c.angle;
      let startRadius = c.radius;
      let swept = false;
      let strokePts = [];
      let prevPointerAngle = (c.angle * Math.PI) / 180;

      const startRect = el.getBoundingClientRect();
      const pivotClientX = startRect.left + startRect.width / 2;
      const pivotClientY = startRect.top + startRect.height / 2;
      const startPointerDist = Math.hypot(e.clientX - pivotClientX, e.clientY - pivotClientY);

      const onMove = (mv) => {
        const sc = this.getScale?.() || 1;
        const dx = (mv.clientX - pivotClientX) / sc;
        const dy = (mv.clientY - pivotClientY) / sc;
        const curRadius = Math.max(30, Math.min(250, Math.hypot(dx, dy)));
        const curAngleRad = Math.atan2(dy, dx);
        const curAngleDeg = (curAngleRad * 180) / Math.PI;

        if (!mode) {
          const radialDelta = Math.abs(Math.hypot(mv.clientX - pivotClientX, mv.clientY - pivotClientY) - startPointerDist);
          const angDelta = Math.abs(curAngleDeg - startAngle);
          if (radialDelta > 10 && radialDelta > angDelta * 1.4) {
            mode = 'resize';
          } else if (angDelta > 3) {
            mode = 'draw';
            swept = true;
            const px = c.cx + Math.cos(prevPointerAngle) * c.radius;
            const py = c.cy + Math.sin(prevPointerAngle) * c.radius;
            strokePts = [{ x: px, y: py, w: Math.max(2, style.size), t: performance.now(), pressure: 0.5 }];
            this.inkEngine.beginStroke(strokePts[0], drawTool);
          }
        }

        if (mode === 'resize') {
          c.radius = curRadius;
          c.angle = curAngleDeg;
          guideCircle.setAttribute('r', String(c.radius));
          readout.textContent = `r: ${Math.round(c.radius)}px`;
        } else if (mode === 'draw') {
          c.angle = curAngleDeg;
          const px = c.cx + Math.cos(curAngleRad) * c.radius;
          const py = c.cy + Math.sin(curAngleRad) * c.radius;
          const nextPt = { x: px, y: py, w: Math.max(2, style.size), t: performance.now(), pressure: 0.5 };
          strokePts.push(nextPt);
          this.inkEngine.extendStroke([nextPt]);
        }

        const tx = Math.cos((c.angle * Math.PI) / 180) * c.radius;
        const ty = Math.sin((c.angle * Math.PI) / 180) * c.radius;
        arm.setAttribute('x2', tx.toFixed(1));
        arm.setAttribute('y2', ty.toFixed(1));
        tip.style.left = `${tx}px`;
        tip.style.top = `${ty}px`;
      };

      const onUp = () => {
        tip.removeEventListener('pointermove', onMove);
        tip.removeEventListener('pointerup', onUp);
        tip.removeEventListener('pointercancel', onUp);
        if (swept) {
          this.inkEngine.endStroke();
        }
        startRadius; // keep lint clean
      };

      tip.addEventListener('pointermove', onMove);
      tip.addEventListener('pointerup', onUp);
      tip.addEventListener('pointercancel', onUp);
    });

    this.layerEl.appendChild(el);
    c.el = el;
  }
}
