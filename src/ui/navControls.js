/**
 * Captnz Board — Draggable Navigation Arrows (< >) & Instant Add Blank Page (+)
 */

import { makeDraggable } from './draggable.js';

export class NavControls {
  constructor({ onPrev, onNext, onAddBlank }) {
    this.prevDock = document.getElementById('nav-prev-dock');
    this.nextDock = document.getElementById('nav-next-dock');
    this.btnPrev = document.getElementById('btn-prev-page');
    this.btnNext = document.getElementById('btn-next-page');
    this.btnAdd = document.getElementById('btn-add-blank');
    this.indicator = document.getElementById('page-indicator');

    // Both left (<) and right (> +) controls snap smoothly to the nearest screen edge on release
    makeDraggable(this.prevDock, { storageKey: 'nav_prev', snapToEdge: true });
    makeDraggable(this.nextDock, { storageKey: 'nav_next', snapToEdge: true });

    this.btnPrev.addEventListener('click', () => onPrev?.());
    this.btnNext.addEventListener('click', () => onNext?.());
    this.btnAdd.addEventListener('click', () => onAddBlank?.());
  }

  update(currentIndex, totalPages) {
    this.indicator.textContent = `${currentIndex + 1} / ${totalPages}`;
    const atStart = currentIndex === 0;
    const atEnd = currentIndex >= totalPages - 1;
    this.btnPrev.classList.toggle('is-edge-disabled', atStart);
    this.btnPrev.setAttribute('aria-disabled', String(atStart));
    this.btnNext.classList.toggle('is-edge-disabled', atEnd);
    this.btnNext.setAttribute('aria-disabled', String(atEnd));
  }
}
