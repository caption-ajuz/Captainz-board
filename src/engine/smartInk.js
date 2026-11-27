/**
 * Captnz Board — Offline Smart Ink Recognition Hook (100% Local, Zero Network)
 * Classifies stroke geometry locally and emits lightweight recognition events
 * when Smart Ink Recognition is toggled ON in the Smart tab.
 */

import { recognizeShape } from './shapeRecognizer.js';

export class SmartInkRecognizer {
  constructor({ onRecognized } = {}) {
    this.enabled = false;
    this.onRecognized = onRecognized;
    this.lastResult = null;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  /**
   * Analyzes a newly committed stroke offline using local geometric & directional features.
   * Returns { label, kind, confidence } or null.
   */
  analyzeStroke(stroke) {
    if (!this.enabled || !stroke || !stroke.points || stroke.points.length < 4) {
      return null;
    }
    if (stroke.tool === 'highlighter' || stroke.tool.includes('eraser') || stroke.tool === 'vanishing') {
      return null;
    }

    const result = this._classifyLocal(stroke);
    if (result) {
      this.lastResult = { ...result, strokeId: stroke.id, timestamp: Date.now() };
      this.onRecognized?.(this.lastResult);
      // Expose hook for local plugin/automation inspection without network calls
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('captnz:smart-ink', { detail: this.lastResult }));
      }
    }
    return result;
  }

  _classifyLocal(stroke) {
    if (stroke.shape) {
      return { kind: stroke.shape.kind, label: stroke.shape.kind, confidence: 0.99 };
    }

    const pts = stroke.points;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let pathLen = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (i > 0) pathLen += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    }

    const w = maxX - minX;
    const h = maxY - minY;
    const diag = Math.hypot(w, h);
    if (diag < 18) return null;

    // 1. Geometric match
    const shape = recognizeShape(pts);
    if (shape) {
      return { kind: shape.kind, label: shape.kind, confidence: 0.88 };
    }

    // 2. Horizontal underline / rule gesture
    const start = pts[0];
    const end = pts[pts.length - 1];
    const direct = Math.hypot(end.x - start.x, end.y - start.y);
    if (w > 48 && h < w * 0.16 && pathLen / Math.max(direct, 1) < 1.15) {
      return { kind: 'underline', label: 'underline', confidence: 0.85 };
    }

    // 3. Checkmark heuristic (2 segments: short down-right, longer up-right)
    if (pts.length >= 6 && direct > 24) {
      let lowestIdx = 0;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].y > pts[lowestIdx].y) lowestIdx = i;
      }
      if (lowestIdx > 1 && lowestIdx < pts.length - 2) {
        const leg1 = Math.hypot(pts[lowestIdx].x - start.x, pts[lowestIdx].y - start.y);
        const leg2 = Math.hypot(end.x - pts[lowestIdx].x, end.y - pts[lowestIdx].y);
        if (leg1 > 10 && leg2 > leg1 * 1.15 && end.y < pts[lowestIdx].y - 12 && end.x > pts[lowestIdx].x) {
          return { kind: 'checkmark', label: 'checkmark', confidence: 0.8 };
        }
      }
    }

    return { kind: 'handwriting', label: 'ink', confidence: 0.7 };
  }
}
