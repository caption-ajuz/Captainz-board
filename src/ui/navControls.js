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
    this.btnPrev.style.opacity = currentIndex === 0 ? '0.45' : '1';
    this.btnNext.style.opacity = currentIndex >= totalPages - 1 ? '0.45' : '1';
  }
}
