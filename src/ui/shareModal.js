/**
 * Captnz Board — Smart Hybrid QR Share Modal
 * - Online: Generates crisp PDF, uploads to tmpfiles.org (1h auto-expire, fallback 0x0.st), shows direct-download QR.
 * - Offline (Tauri Windows): Starts on-demand tiny_http local server, detects hotspot/LAN IPv4, shows local QR.
 * - Zero-Connection: Pure offline Text/Formula QR, System/Nearby Share (navigator.share), and Save PDF / .cboard.
 */

import QRCode from 'qrcode';
import { buildSessionPdfBytes } from '../document/pdfExporter.js';
import { isTauriRuntime } from '../document/fileImporter.js';
import { t } from '../i18n/translations.js';

function normalizeTmpfilesDirectUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  if (url.startsWith('http://tmpfiles.org/')) {
    url = url.replace('http://tmpfiles.org/', 'https://tmpfiles.org/');
  }
  if (url.startsWith('https://tmpfiles.org/') && !url.includes('/dl/')) {
    url = url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
  }
  return url;
}

async function uploadToTmpfiles(blob, fileName, signal) {
  const form = new FormData();
  form.append('file', blob, fileName);
  const res = await fetch('https://tmpfiles.org/api/v1/upload', {
    method: 'POST',
    body: form,
    signal,
  });
  if (!res.ok) throw new Error(`tmpfiles.org HTTP ${res.status}`);
  const data = await res.json();
  const rawUrl = data?.data?.url;
  const direct = normalizeTmpfilesDirectUrl(rawUrl);
  if (!direct) throw new Error('tmpfiles.org returned invalid URL');
  return direct;
}

async function uploadTo0x0(blob, fileName, signal) {
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('expires', '1');
  const res = await fetch('https://0x0.st', {
    method: 'POST',
    body: form,
    signal,
  });
  if (!res.ok) throw new Error(`0x0.st HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!text.startsWith('http')) throw new Error('0x0.st returned invalid URL');
  return text;
}

async function uploadPdfWithFallback(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 16000);
  try {
    try {
      return await uploadToTmpfiles(blob, fileName, controller.signal);
    } catch {
      return await uploadTo0x0(blob, fileName, controller.signal);
    }
  } finally {
    clearTimeout(timer);
  }
}

function collectBoardText(pageManager) {
  const page = pageManager?.getCurrentPage?.();
  if (!page?.stamps?.length) return '';
  const parts = [];
  for (const st of page.stamps) {
    if ((st.kind === 'text' || st.kind === 'sticky') && st.text?.trim()) {
      parts.push(st.text.trim());
    } else if (st.formula?.trim()) {
      parts.push(st.formula.trim());
    }
  }
  return parts.join('\n\n');
}

async function renderQrToImg(imgEl, payload) {
  if (!imgEl || !payload) return;
  const dataUrl = await QRCode.toDataURL(payload, {
    width: 280,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
  imgEl.src = dataUrl;
}

export class ShareModal {
  constructor({ pageManager, inkEngine, onSavePdf, onSaveCboard, showToast }) {
    this.pageManager = pageManager;
    this.inkEngine = inkEngine;
    this.onSavePdf = onSavePdf;
    this.onSaveCboard = onSaveCboard;
    this.showToast = showToast;

    this.backdrop = document.getElementById('share-modal-backdrop');
    this.modal = document.getElementById('share-modal');
    this.btnClose = document.getElementById('btn-close-share');
    this.tabPdf = document.getElementById('share-tab-pdf');
    this.tabText = document.getElementById('share-tab-text');
    this.panePdf = document.getElementById('share-pane-pdf');
    this.paneText = document.getElementById('share-pane-text');

    this.modeBadge = document.getElementById('share-mode-badge');
    this.statusEl = document.getElementById('share-pdf-status');
    this.qrWrap = document.getElementById('share-pdf-qr-wrap');
    this.qrImg = document.getElementById('share-pdf-qr-img');
    this.urlEl = document.getElementById('share-pdf-url');
    this.hintEl = document.getElementById('share-pdf-hint');
    this.btnToggleHotspot = document.getElementById('btn-share-hotspot-mode');

    this.textInput = document.getElementById('share-text-input');
    this.textQrImg = document.getElementById('share-text-qr-img');
    this.textQrEmpty = document.getElementById('share-text-qr-empty');

    this.btnNearbyShare = document.getElementById('btn-share-nearby');
    this.btnSavePdf = document.getElementById('btn-share-save-pdf');
    this.btnSaveCboard = document.getElementById('btn-share-save-cboard');

    this._cachedPdf = null;
    this._localServerActive = false;
    this._isOpen = false;
    this._forceOfflineHotspot = false;

    this._bindEvents();
  }

  _bindEvents() {
    this.btnClose?.addEventListener('click', () => this.close());
    this.backdrop?.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isOpen) this.close();
    });

    this.tabPdf?.addEventListener('click', () => this._switchTab('pdf'));
    this.tabText?.addEventListener('click', () => this._switchTab('text'));

    this.btnToggleHotspot?.addEventListener('click', async () => {
      this._forceOfflineHotspot = !this._forceOfflineHotspot;
      await this._preparePdfQr();
    });

    this.textInput?.addEventListener('input', () => {
      this._updateTextQr();
    });

    this.btnNearbyShare?.addEventListener('click', () => this._triggerNearbyShare());
    this.btnSavePdf?.addEventListener('click', async () => {
      await this.onSavePdf?.();
    });
    this.btnSaveCboard?.addEventListener('click', async () => {
      await this.onSaveCboard?.();
    });
  }

  _switchTab(tab) {
    const isPdf = tab === 'pdf';
    this.tabPdf?.classList.toggle('active', isPdf);
    this.tabText?.classList.toggle('active', !isPdf);
    this.panePdf?.classList.toggle('hidden', !isPdf);
    this.paneText?.classList.toggle('hidden', isPdf);
    if (!isPdf) {
      this._updateTextQr();
    }
  }

  async open() {
    if (!this.backdrop) return;
    this._isOpen = true;
    this._cachedPdf = null;
    this._forceOfflineHotspot = false;
    this.backdrop.inert = false;
    this.backdrop.setAttribute('aria-hidden', 'false');
    this.backdrop.classList.remove('hidden');

    this._switchTab('pdf');

    const extracted = collectBoardText(this.pageManager);
    if (this.textInput) {
      this.textInput.value = extracted;
    }

    await this._preparePdfQr();
  }

  async close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    await this._stopLocalServer();
    if (this.backdrop?.contains(document.activeElement)) {
      document.activeElement?.blur?.();
    }
    this.backdrop?.classList.add('hidden');
    this.backdrop?.setAttribute('aria-hidden', 'true');
    if (this.backdrop) this.backdrop.inert = true;
    this._cachedPdf = null;
  }

  async _stopLocalServer() {
    if (!this._localServerActive || !isTauriRuntime()) return;
    this._localServerActive = false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('stop_local_pdf_share');
    } catch {
      // Ignore cleanup errors
    }
  }

  async _ensurePdfBytes() {
    if (this._cachedPdf) return this._cachedPdf;
    this._cachedPdf = await buildSessionPdfBytes(this.pageManager, this.inkEngine);
    return this._cachedPdf;
  }

  async _preparePdfQr() {
    await this._stopLocalServer();

    if (this.qrWrap) this.qrWrap.classList.add('hidden');
    if (this.statusEl) {
      this.statusEl.classList.remove('hidden');
      this.statusEl.textContent = t('shareGeneratingPdf');
    }
    if (this.btnToggleHotspot) {
      this.btnToggleHotspot.classList.toggle('hidden', !isTauriRuntime());
    }

    try {
      const pdfData = await this._ensurePdfBytes();
      if (!pdfData || !this._isOpen) return;

      const isOnline = navigator.onLine && !this._forceOfflineHotspot;

      if (isOnline) {
        if (this.modeBadge) {
          this.modeBadge.textContent = t('shareModeOnline');
          this.modeBadge.dataset.mode = 'online';
        }
        if (this.statusEl) this.statusEl.textContent = t('shareUploading');
        if (this.btnToggleHotspot) {
          this.btnToggleHotspot.textContent = t('shareSwitchHotspot');
        }

        try {
          const directUrl = await uploadPdfWithFallback(pdfData.bytes, pdfData.fileName);
          if (!this._isOpen) return;
          await renderQrToImg(this.qrImg, directUrl);
          if (this.urlEl) this.urlEl.textContent = directUrl;
          if (this.hintEl) this.hintEl.textContent = t('shareOnlineHint');
          this.statusEl?.classList.add('hidden');
          this.qrWrap?.classList.remove('hidden');
          return;
        } catch {
          // Fall through to offline hotspot if on Tauri, or show offline notice
          if (!isTauriRuntime()) {
            if (this.modeBadge) {
              this.modeBadge.textContent = t('shareModeOffline');
              this.modeBadge.dataset.mode = 'offline';
            }
            if (this.statusEl) this.statusEl.textContent = t('shareWebOfflineNotice');
            return;
          }
        }
      }

      // Offline Local Network / Hotspot QR (Windows .exe via tiny_http)
      if (isTauriRuntime()) {
        if (this.modeBadge) {
          this.modeBadge.textContent = t('shareModeHotspot');
          this.modeBadge.dataset.mode = 'offline';
        }
        if (this.btnToggleHotspot) {
          this.btnToggleHotspot.textContent = navigator.onLine
            ? t('shareSwitchOnline')
            : t('shareRetryHotspot');
        }
        const { invoke } = await import('@tauri-apps/api/core');
        const info = await invoke('start_local_pdf_share', {
          bytes: Array.from(pdfData.bytes),
          filename: pdfData.fileName,
        });
        if (!this._isOpen) {
          await invoke('stop_local_pdf_share');
          return;
        }
        this._localServerActive = true;
        await renderQrToImg(this.qrImg, info.url);
        if (this.urlEl) this.urlEl.textContent = info.url;
        if (this.hintEl) this.hintEl.textContent = t('shareHotspotHint');
        this.statusEl?.classList.add('hidden');
        this.qrWrap?.classList.remove('hidden');
      } else {
        if (this.modeBadge) {
          this.modeBadge.textContent = t('shareModeOffline');
          this.modeBadge.dataset.mode = 'offline';
        }
        if (this.statusEl) this.statusEl.textContent = t('shareWebOfflineNotice');
      }
    } catch (err) {
      if (this.statusEl) {
        this.statusEl.textContent = err?.message || 'Could not prepare Share QR';
      }
    }
  }

  async _updateTextQr() {
    const text = this.textInput?.value?.trim() || '';
    if (!text) {
      this.textQrImg?.classList.add('hidden');
      this.textQrEmpty?.classList.remove('hidden');
      return;
    }
    this.textQrEmpty?.classList.add('hidden');
    this.textQrImg?.classList.remove('hidden');
    await renderQrToImg(this.textQrImg, text.slice(0, 1200));
  }

  async _triggerNearbyShare() {
    try {
      const pdfData = await this._ensurePdfBytes();
      if (!pdfData) return;
      const file = new File([pdfData.bytes], pdfData.fileName, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Captnz Board Notes',
          text: 'Shared from Captnz Board',
          files: [file],
        });
      } else if (navigator.share) {
        await navigator.share({
          title: 'Captnz Board Notes',
          text: this.urlEl?.textContent || 'Captnz Board Notes',
        });
      } else {
        this.showToast?.(t('shareNearbyUnsupported'), 3000);
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        this.showToast?.(err?.message || t('shareNearbyUnsupported'), 3000);
      }
    }
  }
}
