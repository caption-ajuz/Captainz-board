/**
 * Captnz Board — Local Auto-Save & Crash Recovery Store
 * Uses IndexedDB for fast binary storage (PDF buffers + pages) plus atomic Rust JSON backup.
 */

import { isTauriRuntime, loadPdfFromBytes } from './fileImporter.js';

const DB_NAME = 'captnz_board_recovery_db';
const STORE_NAME = 'session';
const KEY = 'latest';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class RecoveryStore {
  constructor() {
    this._timer = null;
  }

  scheduleSave(pageManager) {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this.saveNow(pageManager).catch(() => {});
    }, 1200);
  }

  async saveNow(pageManager) {
    const hasContent =
      pageManager.pages.length > 1 ||
      pageManager.pages.some(
        (p) => p.type !== 'blank' || p.strokes.length > 0 || (p.stamps && p.stamps.length > 0)
      );
    if (!hasContent) return;

    const pdfBlobs = {};
    for (const [id, entry] of pageManager.pdfDocs.entries()) {
      pdfBlobs[id] = entry.rawBytes;
    }

    const payload = {
      savedAt: Date.now(),
      currentIndex: pageManager.currentIndex,
      defaultBackground: pageManager.defaultBackground,
      pages: pageManager.pages.map((p) => ({
        ...p,
        redoStack: [],
        thumbnail: null,
      })),
      pdfBlobs,
    };

    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(payload, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    // Lightweight metadata/ink backup to Rust app data dir
    if (isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const light = {
          savedAt: payload.savedAt,
          currentIndex: payload.currentIndex,
          pageCount: payload.pages.length,
        };
        await invoke('save_recovery_session', { jsonData: JSON.stringify(light) });
      } catch {
        // Non-fatal
      }
    }
  }

  async hasRecoverableSession() {
    try {
      const db = await openDb();
      const data = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      return Boolean(data && data.pages && data.pages.length > 0);
    } catch {
      return false;
    }
  }

  async restoreInto(pageManager) {
    const db = await openDb();
    const data = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!data) return false;

    pageManager.pdfDocs.clear();
    if (data.pdfBlobs) {
      for (const [id, bytes] of Object.entries(data.pdfBlobs)) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const pdfDoc = await loadPdfFromBytes(u8);
        pageManager.pdfDocs.set(id, { pdfDoc, rawBytes: u8 });
      }
    }

    pageManager.defaultBackground = data.defaultBackground || 'white';
    pageManager.pages = data.pages.map((p) => ({
      ...p,
      redoStack: [],
      stamps: p.stamps || [],
    }));
    pageManager.currentIndex = Math.min(data.currentIndex || 0, pageManager.pages.length - 1);
    pageManager.onPagesUpdated?.();
    pageManager.onPageChanged?.(pageManager.getCurrentPage(), pageManager.currentIndex);
    return true;
  }

  async clear() {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      if (isTauriRuntime()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('clear_recovery_session');
      }
    } catch {
      // Ignore
    }
  }
}
