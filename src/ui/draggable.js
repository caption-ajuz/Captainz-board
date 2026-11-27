/**
 * Captnz Board — Touch-Friendly Draggable Dock Utility
 * Distinguishes clean taps (< 8px) from drags (>= 8px), clamps to viewport,
 * magnetically snaps to the nearest left/right screen edge on release,
 * and persists user positions in localStorage.
 */

const DRAG_THRESHOLD = 8;
const SNAP_TRANSITION = 'left 260ms cubic-bezier(0.22, 1, 0.36, 1), top 260ms cubic-bezier(0.22, 1, 0.36, 1)';

export function makeDraggable(
  el,
  { storageKey, handleSelector = null, snapToEdge = true, edgeMargin = 16, onDragEnd = null } = {}
) {
  let isDragging = false;
  let moved = false;
  let startClientX = 0;
  let startClientY = 0;
  let startLeft = 0;
  let startTop = 0;
  let snappedSide = null;
  let snapTimer = null;

  // Restore saved position if present (keeping edge snap consistent)
  if (storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(`captnz_pos_${storageKey}`) || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        const rect = el.getBoundingClientRect();
        let targetLeft = saved.left;
        if (snapToEdge) {
          const side =
            saved.side === 'left' || saved.side === 'right'
              ? saved.side
              : saved.left + rect.width / 2 < window.innerWidth / 2
                ? 'left'
                : 'right';
          snappedSide = side;
          targetLeft = getSnappedLeft(rect.width, side, edgeMargin);
        }
        applyClampedPosition(el, targetLeft, saved.top, edgeMargin);
        onDragEnd?.({ ...el.getBoundingClientRect(), side: snappedSide });
      }
    } catch {
      // Ignore corrupt storage
    }
  }

  const target = handleSelector ? el.querySelector(handleSelector) || el : el;

  target.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    // Do not start dragging from sliders, inputs, or the expanded orb panel
    if (e.target.closest('.orb-panel') || e.target.tagName === 'INPUT') return;

    clearTimeout(snapTimer);
    el.style.transition = 'none';

    const rect = el.getBoundingClientRect();
    startClientX = e.clientX;
    startClientY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    isDragging = true;
    moved = false;

    target.setPointerCapture(e.pointerId);
  });

  target.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;

    if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    moved = true;

    applyClampedPosition(el, startLeft + dx, startTop + dy, edgeMargin);
  });

  const endDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;

    if (moved) {
      // Suppress the synthetic click event immediately after a drag
      const suppressClick = (clickEv) => {
        clickEv.stopImmediatePropagation();
        clickEv.preventDefault();
      };
      el.addEventListener('click', suppressClick, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', suppressClick, { capture: true }), 80);

      const rect = el.getBoundingClientRect();
      let finalLeft = rect.left;
      let finalTop = rect.top;

      if (snapToEdge) {
        const centerX = rect.left + rect.width / 2;
        snappedSide = centerX < window.innerWidth / 2 ? 'left' : 'right';
        finalLeft = getSnappedLeft(rect.width, snappedSide, edgeMargin);
        finalTop = clampTop(rect.height, rect.top, edgeMargin);

        el.style.transition = SNAP_TRANSITION;
        applyClampedPosition(el, finalLeft, finalTop, edgeMargin);
        snapTimer = setTimeout(() => {
          el.style.transition = '';
        }, 280);
      } else {
        const clamped = applyClampedPosition(el, finalLeft, finalTop, edgeMargin);
        finalLeft = clamped.left;
        finalTop = clamped.top;
      }

      if (storageKey) {
        localStorage.setItem(
          `captnz_pos_${storageKey}`,
          JSON.stringify({ left: Math.round(finalLeft), top: Math.round(finalTop), side: snappedSide })
        );
      }

      onDragEnd?.({
        left: finalLeft,
        top: finalTop,
        width: rect.width,
        height: rect.height,
        right: finalLeft + rect.width,
        bottom: finalTop + rect.height,
        side: snappedSide,
      });
    }

    if (target.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
  };

  target.addEventListener('pointerup', endDrag);
  target.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => {
    if (el.style.left && el.style.top) {
      const rect = el.getBoundingClientRect();
      let targetLeft = parseFloat(el.style.left);
      if (snapToEdge) {
        const side = snappedSide || (targetLeft + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right');
        snappedSide = side;
        targetLeft = getSnappedLeft(rect.width, side, edgeMargin);
      }
      const clamped = applyClampedPosition(el, targetLeft, parseFloat(el.style.top), edgeMargin);
      onDragEnd?.({ ...rect, left: clamped.left, top: clamped.top, side: snappedSide });
    }
  });
}

function getSnappedLeft(width, side, margin) {
  if (side === 'left') return margin;
  return Math.max(margin, window.innerWidth - width - margin);
}

function clampTop(height, top, margin) {
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return Math.max(margin, Math.min(maxTop, top));
}

function applyClampedPosition(el, left, top, margin = 10) {
  const rect = el.getBoundingClientRect();
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
  const clampedLeft = Math.max(margin, Math.min(maxLeft, left));
  const clampedTop = clampTop(rect.height, top, margin);

  el.style.left = `${clampedLeft}px`;
  el.style.top = `${clampedTop}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = 'none';

  return { left: clampedLeft, top: clampedTop };
}
