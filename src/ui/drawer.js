/**
 * Captnz Board — Auto-Hide Hamburger Slide Drawer Controller
 */

import { applyLanguage, t } from '../i18n/translations.js';

export class SlideDrawer {
  constructor({
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
    this.isOpen = false;
    this.drawer.inert = true;

    this.btnHamburger.addEventListener('click', () => this.toggle());
    document.getElementById('btn-close-drawer').addEventListener('click', () => this.close());
    this.backdrop.addEventListener('click', () => this.close());

    document.getElementById('btn-open-pdf').addEventListener('click', () => {
      this.close();
      onOpenPdf?.();
    });
    document.getElementById('btn-open-ppt').addEventListener('click', () => {
      this.close();
      onOpenPpt?.();
    });
    document.getElementById('btn-import-img').addEventListener('click', () => {
      this.close();
      onImportImage?.();
    });
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
      this.close();
      onExportPdf?.();
    });
    document.getElementById('btn-clear-page').addEventListener('click', () => {
      this.close();
      onClearPage?.();
    });
    document.getElementById('btn-new-session').addEventListener('click', () => {
      this.close();
      onNewBoard?.();
    });

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
    this.thumbList.innerHTML = '';
    pages.forEach((page, idx) => {
      const card = document.createElement('div');
      card.className = `thumb-card${idx === currentIndex ? ' active' : ''}`;

      if (page.thumbnail) {
        const img = document.createElement('img');
        img.src = page.thumbnail;
        img.alt = `Page ${idx + 1}`;
        card.appendChild(img);
      } else {
        card.style.background = page.background === 'blackboard' ? '#14362b' : '#ffffff';
      }

      const badge = document.createElement('span');
      badge.className = 'thumb-badge';
      badge.textContent = `${idx + 1}${page.type === 'pdf' ? ' • PDF' : ''}`;
      card.appendChild(badge);

      if (pages.length > 1) {
        const del = document.createElement('button');
        del.className = 'thumb-delete';
        del.textContent = '✕';
        del.title = 'Delete Page';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onDeletePage?.(idx);
        });
        card.appendChild(del);
      }

      card.addEventListener('click', () => {
        this.onSelectPage?.(idx);
        this.close(); // Auto-hide drawer when tapping a slide
      });

      this.thumbList.appendChild(card);
    });
  }
}
