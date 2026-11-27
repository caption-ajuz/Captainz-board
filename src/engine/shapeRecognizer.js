/**
 * Captnz Board — Draw-and-Hold Auto-Shape Recognizer
 * Recognizes Straight Line, Circle/Ellipse, Rectangle, and Triangle from freehand points.
 */

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

function pointToSegmentDist(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rdpSimplify(pts, epsilon) {
  if (pts.length < 3) return pts.slice();
  let maxDist = 0;
  let index = 0;
  const end = pts.length - 1;
  for (let i = 1; i < end; i++) {
    const d = pointToSegmentDist(pts[i], pts[0], pts[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, index + 1), epsilon);
    const right = rdpSimplify(pts.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[end]];
}

function getBounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Checks if a highlighter stroke is roughly straight and should auto-straighten.
 */
export function maybeStraightenHighlighter(pts) {
  if (pts.length < 4) return null;
  const start = pts[0];
  const end = pts[pts.length - 1];
  const direct = dist(start, end);
  if (direct < 40) return null;

  const total = pathLength(pts);
  if (total / direct > 1.18) return null;

  let maxDev = 0;
  for (const p of pts) {
    const d = pointToSegmentDist(p, start, end);
    if (d > maxDev) maxDev = d;
  }
  if (maxDev > Math.max(22, direct * 0.1)) return null;

  // Snap nearly horizontal/vertical highlights to exact 0° or 90°
  const angle = Math.abs(Math.atan2(end.y - start.y, end.x - start.x));
  const snappedEnd = { ...end };
  if (angle < 0.12 || Math.abs(angle - Math.PI) < 0.12) {
    snappedEnd.y = start.y;
  } else if (Math.abs(angle - Math.PI / 2) < 0.12) {
    snappedEnd.x = start.x;
  }

  return [start, snappedEnd];
}

/**
 * Recognizes a geometric shape from freehand points.
 * Returns { kind: 'line'|'circle'|'rect'|'triangle', ...geometry } or null.
 */
export function recognizeShape(pts) {
  if (!pts || pts.length < 6) return null;

  const bounds = getBounds(pts);
  const diag = Math.hypot(bounds.w, bounds.h);
  if (diag < 30) return null;

  const start = pts[0];
  const end = pts[pts.length - 1];
  const totalLen = pathLength(pts);
  const directDist = dist(start, end);

  // 1. Straight Line check (open stroke with low deviation)
  if (directDist > diag * 0.72 && totalLen / Math.max(directDist, 1) < 1.16) {
    let maxDev = 0;
    for (const p of pts) {
      maxDev = Math.max(maxDev, pointToSegmentDist(p, start, end));
    }
    if (maxDev < Math.max(18, directDist * 0.08)) {
      const endPt = { x: end.x, y: end.y };
      const angle = Math.abs(Math.atan2(endPt.y - start.y, endPt.x - start.x));
      if (angle < 0.08 || Math.abs(angle - Math.PI) < 0.08) endPt.y = start.y;
      else if (Math.abs(angle - Math.PI / 2) < 0.08) endPt.x = start.x;
      return { kind: 'line', x1: start.x, y1: start.y, x2: endPt.x, y2: endPt.y };
    }
  }

  // Closed shape requirement: start and end reasonably close relative to perimeter
  const closureRatio = directDist / Math.max(diag, 1);
  if (closureRatio > 0.48) return null;

  // 2. Circle / Ellipse check: test radial consistency around bounding box center
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const rx = Math.max(bounds.w / 2, 1);
  const ry = Math.max(bounds.h / 2, 1);

  let normErrSum = 0;
  for (const p of pts) {
    const nx = (p.x - cx) / rx;
    const ny = (p.y - cy) / ry;
    const r = Math.hypot(nx, ny);
    normErrSum += Math.abs(r - 1);
  }
  const meanCircleErr = normErrSum / pts.length;

  // Simplify polygon to count corners for Triangle vs Rectangle
  const simplified = rdpSimplify(pts, diag * 0.075);
  // Remove closing duplicate vertex if close to start
  const vertices = simplified.slice();
  if (vertices.length > 2 && dist(vertices[0], vertices[vertices.length - 1]) < diag * 0.25) {
    vertices.pop();
  }

  // 3. Triangle check (3 distinct corners)
  if (vertices.length === 3) {
    return {
      kind: 'triangle',
      points: vertices.map((v) => ({ x: v.x, y: v.y })),
    };
  }

  // 4. Rectangle check (4 corners & high rectangularity)
  if (vertices.length === 4 && meanCircleErr > 0.14) {
    return {
      kind: 'rect',
      x: bounds.minX,
      y: bounds.minY,
      w: bounds.w,
      h: bounds.h,
    };
  }

  // 5. Circle / Ellipse fallback if radial fit is strong
  if (meanCircleErr < 0.22) {
    const aspect = rx / ry;
    if (aspect > 0.82 && aspect < 1.22) {
      const r = (rx + ry) / 2;
      return { kind: 'circle', cx, cy, rx: r, ry: r };
    }
    return { kind: 'circle', cx, cy, rx, ry };
  }

  // 6. Rectangle fallback if 4-5 corners
  if (vertices.length >= 4 && vertices.length <= 5) {
    return {
      kind: 'rect',
      x: bounds.minX,
      y: bounds.minY,
      w: bounds.w,
      h: bounds.h,
    };
  }

  return null;
}
