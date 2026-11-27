/**
 * Captnz Board — Slide Drawer Controller
 */

import { applyLanguage, t } from '../i18n/translations.js';

export class SlideDrawer {
  constructor({
    onOpenCboard,
    onSaveCboard,
    onOpenPdf,
    onOpenPpt,
    onImportImage,
    onExportPdf,
    onBackgroundChange,
    onThemeToggle,
    onPalmToggle,
    onSelectPage,
    onDeletePage,
    onClearPage,
    onNewBoard,
    onBeforeOpen,
    onRequestThumbnail,
  }) {
    this.drawer = document.getElementById('slide-drawer');
    this.backdrop = document.getElementById('drawer-backdrop');
    this.btnHamburger = document.getElementById('btn-hamburger');
    this.thumbList = document.getElementById('thumbnail-list');
    this.btnTheme = document.getElementById('btn-toggle-theme');
    this.btnPalm = document.getElementById('btn-toggle-palm');
    this.selectLang = document.getElementById('select-language');

    this.onSelectPage = onSelectPage;
    this.onDeletePage = onDeletePage;
    this.onBeforeOpen = onBeforeOpen;
    this.onRequestThumbnail = onRequestThumbnail;
    this._thumbObserver = null;
    this._renderVersion = 0;
    this._thumbQueue = [];
    this._thumbWorkerRunning = false;
    this.isOpen = false;
    this.drawer.inert = true;

    this.btnHamburger.addEventListener('click', () => this.toggle());
    document.getElementById('btn-close-drawer').addEventListener('click', () => this.close());
    this.backdrop.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    const drawerActions = [
      ['btn-open-cboard', onOpenCboard],
      ['btn-save-cboard', onSaveCboard],
      ['btn-open-pdf', onOpenPdf],
      ['btn-open-ppt', onOpenPpt],
      ['btn-import-img', onImportImage],
      ['btn-export-pdf', onExportPdf],
      ['btn-clear-page', onClearPage],
      ['btn-new-session', onNewBoard],
    ];
    for (const [id, handler] of drawerActions) {
      document.getElementById(id)?.addEventListener('click', () => {
        this.close();
        handler?.();
      });
    }

    // Background switcher
    document.querySelectorAll('#bg-switcher .bg-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bg = btn.dataset.bg;
        this.setActiveBackground(bg);
        onBackgroundChange?.(bg);
      });
    });

    // Dark / Light mode toggle
    this.btnTheme.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      this.setTheme(next);
      onThemeToggle?.(next);
    });

    // Palm Eraser / Palm Reject toggle
    this.palmMode = 'eraser';
    this.btnPalm.addEventListener('click', () => {
      this.palmMode = this.palmMode === 'eraser' ? 'reject' : 'eraser';
      this.btnPalm.textContent = t(this.palmMode === 'eraser' ? 'palmEraser' : 'palmReject');
      onPalmToggle?.(this.palmMode);
    });

    // Language selector
    this.selectLang.addEventListener('change', (e) => {
      applyLanguage(e.target.value);
      this._refreshDynamicLabels();
    });
  }

  setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('captnz_theme', theme);
    this.btnTheme.textContent = t(theme === 'dark' ? 'darkMode' : 'lightMode');
  }

  setActiveBackground(bg) {
    document.querySelectorAll('#bg-switcher .bg-chip').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.bg === bg);
    });
  }

  _refreshDynamicLabels() {
    const theme = document.documentElement.dataset.theme || 'dark';
    this.btnTheme.textContent = t(theme === 'dark' ? 'darkMode' : 'lightMode');
    this.btnPalm.textContent = t(this.palmMode === 'eraser' ? 'palmEraser' : 'palmReject');
  }

  open() {
    this.onBeforeOpen?.();
    this.isOpen = true;
    this.drawer.inert = false;
    this.drawer.classList.add('open');
    this.drawer.setAttribute('aria-hidden', 'false');
    this.backdrop.classList.remove('hidden');
  }

  close() {
    this.isOpen = false;
    if (this.drawer.contains(document.activeElement)) {
      document.activeElement?.blur?.();
      this.btnHamburger?.focus?.({ preventScroll: true });
    }
    this.drawer.classList.remove('open');
    this.drawer.inert = true;
    this.drawer.setAttribute('aria-hidden', 'true');
    this.backdrop.classList.add('hidden');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  renderThumbnails(pages, currentIndex) {
    this._renderVersion += 1;
    const version = this._renderVersion;
    this._thumbObserver?.disconnect();
    this._thumbQueue = [];
    this.thumbList.innerHTML = '';

    const fragment = document.createDocumentFragment();
    let activeCardEl = null;

    const pendingCards = [];
    pages.forEach((page, idx) => {
      const card = document.createElement('div');
      card.className = `thumb-card thumbnail-card${idx === currentIndex ? ' active' : ''}`;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Page ${idx + 1}`);
      card.dataset.pageIdx = String(idx);

      if (idx === currentIndex) activeCardEl = card;

      if (page.thumbnail) {
        const img = document.createElement('img');
        img.src = page.thumbnail;
        img.alt = `Page ${idx + 1}`;
        img.loading = 'lazy';
        img.decoding = 'async';
        card.appendChild(img);
      } else {
        card.style.background = page.background === 'blackboard' ? '#14362b' : '#ffffff';
        if (this.onRequestThumbnail) {
          pendingCards.push({ card, page, idx });
        }
      }

      const badge = document.createElement('span');
      badge.className = 'thumb-badge';
      badge.textContent = String(idx + 1);
      if (page.type === 'pdf') {
        const typeTag = document.createElement('span');
        typeTag.className = 'thumb-type';
        typeTag.textContent = 'PDF';
        badge.appendChild(typeTag);
      }
      card.appendChild(badge);

      if (pages.length > 1) {
        const del = document.createElement('button');
        del.className = 'thumb-delete';
        del.setAttribute('aria-label', 'Delete Page');
        del.title = 'Delete Page';
        del.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onDeletePage?.(idx);
        });
        card.appendChild(del);
      }

      const selectCard = () => {
        this.onSelectPage?.(idx);
        this.close(); // Auto-hide drawer when tapping a slide
      };
      card.addEventListener('click', selectCard);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectCard();
        }
      });

      fragment.appendChild(card);
    });

    this.thumbList.appendChild(fragment);

    if (activeCardEl) {
      activeCardEl.scrollIntoView({ block: 'nearest' });
    }

    if (pendingCards.length > 0 && typeof IntersectionObserver !== 'undefined') {
      const cardMap = new Map(pendingCards.map((item) => [item.card, item]));
      this._thumbObserver = new IntersectionObserver(
        (entries) => {
          if (version !== this._renderVersion) return;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const item = cardMap.get(entry.target);
            if (!item) continue;
            this._thumbObserver.unobserve(entry.target);
            cardMap.delete(entry.target);
            this._enqueueThumbnail(item, version);
          }
        },
        { root: this.thumbList, rootMargin: '240px 0px', threshold: 0.01 }
      );
      for (const { card } of pendingCards) {
        this._thumbObserver.observe(card);
      }
    }
  }

  _enqueueThumbnail(item, version) {
    this._thumbQueue.push({ ...item, version });
    if (!this._thumbWorkerRunning) {
      this._drainThumbnailQueue();
    }
  }

  async _drainThumbnailQueue() {
    this._thumbWorkerRunning = true;
    try {
      while (this._thumbQueue.length > 0) {
        const job = this._thumbQueue.shift();
        if (job.version !== this._renderVersion || !this.isOpen) continue;
        if (job.page.thumbnail) continue;
        try {
          const dataUrl = await this.onRequestThumbnail?.(job.page);
          if (job.version !== this._renderVersion || !dataUrl) continue;
          if (!job.card.querySelector('img')) {
            const img = document.createElement('img');
            img.src = dataUrl;
            img.alt = `Page ${job.idx + 1}`;
            img.decoding = 'async';
            job.card.prepend(img);
          }
        } catch {
          // Ignore cancelled/failed lazy thumbnail renders
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this._thumbWorkerRunning = false;
    }
  }
}
