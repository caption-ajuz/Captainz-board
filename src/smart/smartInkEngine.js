/**
 * Captnz Board — Offline Smart Ink Engine (Tesseract.js + IndexedDB Language Packs)
 * Supports on-demand downloadable open-source traineddata packs for English (eng),
 * Malayalam (mal), and Arabic (ara) stored permanently in IndexedDB for 100% offline use.
 */

export const LANGUAGE_PACKS = [
  { code: 'eng', name: 'English', native: 'English', sizeHint: '~4 MB' },
  { code: 'mal', name: 'Malayalam', native: 'മലയാളം', sizeHint: '~3 MB' },
  { code: 'ara', name: 'Arabic', native: 'العربية', sizeHint: '~2.5 MB' },
];

const DB_NAME = 'captnz_ocr_packs_db';
const STORE_NAME = 'packs';
const PACK_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';

function openPackDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'code' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStoredPack(code) {
  const db = await openPackDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(code);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function putStoredPack(record) {
  const db = await openPackDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteStoredPack(code) {
  const db = await openPackDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(code);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function supportsWasmSimd() {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
    );
  } catch {
    return false;
  }
}

async function gunzipUint8(gzBytes) {
  const isGzip = gzBytes.length >= 2 && gzBytes[0] === 0x1f && gzBytes[1] === 0x8b;
  if (!isGzip) return gzBytes;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is unavailable in this browser.');
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(gzBytes);
  writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

export class OfflineSmartInkEngine {
  constructor() {
    this._worker = null;
    this._workerLang = null;
    this._bundledEngData = null;
  }

  async _loadBundledEngData() {
    if (this._bundledEngData) return this._bundledEngData;
    const url = new URL('./tesseract/eng.traineddata.gz', window.location.href).href;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error('Built-in English OCR pack could not be loaded.');
    }
    const gzBytes = new Uint8Array(await resp.arrayBuffer());
    const rawData = await gunzipUint8(gzBytes);
    this._bundledEngData = rawData;
    // Best-effort persist to IndexedDB for instant subsequent loads
    try {
      await putStoredPack({
        code: 'eng',
        data: rawData,
        sizeBytes: rawData.byteLength,
        downloadedAt: Date.now(),
      });
    } catch {
      // Non-fatal if IndexedDB is unavailable
    }
    return rawData;
  }

  async getAllPackStatuses() {
    const results = {};
    for (const pack of LANGUAGE_PACKS) {
      try {
        const rec = await getStoredPack(pack.code);
        if (rec) {
          results[pack.code] = { installed: true, sizeBytes: rec.sizeBytes };
        } else if (pack.code === 'eng') {
          results[pack.code] = { installed: true, bundled: true };
        } else {
          results[pack.code] = { installed: false };
        }
      } catch {
        results[pack.code] = pack.code === 'eng' ? { installed: true, bundled: true } : { installed: false };
      }
    }
    return results;
  }

  async isPackInstalled(code) {
    if (code === 'eng') return true;
    try {
      const rec = await getStoredPack(code);
      return Boolean(rec && rec.data);
    } catch {
      return false;
    }
  }

  async downloadPack(code, onProgress) {
    const url = `${PACK_CDN_BASE}/${code}/4.0.0_best_int/${code}.traineddata.gz`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Download failed (${resp.status}). Check internet connection.`);
    }

    const total = Number(resp.headers.get('Content-Length')) || 0;
    const reader = resp.body?.getReader?.();
    let gzBytes;

    if (reader) {
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) {
          onProgress?.(Math.min(95, Math.round((received / total) * 95)));
        }
      }
      gzBytes = new Uint8Array(received);
      let offset = 0;
      for (const c of chunks) {
        gzBytes.set(c, offset);
        offset += c.length;
      }
    } else {
      gzBytes = new Uint8Array(await resp.arrayBuffer());
    }

    onProgress?.(97);
    const rawData = await gunzipUint8(gzBytes);
    await putStoredPack({
      code,
      data: rawData,
      sizeBytes: rawData.byteLength,
      downloadedAt: Date.now(),
    });
    onProgress?.(100);
    return rawData.byteLength;
  }

  async removePack(code) {
    if (this._worker && this._workerLang === code) {
      await this._terminateWorker();
    }
    await deleteStoredPack(code);
  }

  async _terminateWorker() {
    if (this._worker) {
      try {
        await this._worker.terminate();
      } catch {
        // Ignore termination errors
      }
      this._worker = null;
      this._workerLang = null;
    }
  }

  async resolvePreferredInstalledLang(uiLang = 'en') {
    const map = { en: 'eng', ml: 'mal', ar: 'ara' };
    const preferred = map[uiLang] || 'eng';
    if (await this.isPackInstalled(preferred)) return preferred;
    for (const p of LANGUAGE_PACKS) {
      if (await this.isPackInstalled(p.code)) return p.code;
    }
    return 'eng';
  }

  async _getPackBytes(langCode) {
    try {
      const rec = await getStoredPack(langCode);
      if (rec?.data) return rec.data;
    } catch {
      // Fall through to bundled English check
    }
    if (langCode === 'eng') {
      return await this._loadBundledEngData();
    }
    return null;
  }

  /**
   * Recognizes handwritten ink inside a bounding box on the inkCanvas using cached offline language pack.
   */
  async recognizeInkBounds(inkCanvas, bounds, uiLang = 'en', isDarkBg = false) {
    const langCode = await this.resolvePreferredInstalledLang(uiLang);
    const packData = await this._getPackBytes(langCode);
    if (!packData) {
      const err = new Error('NO_PACK_INSTALLED');
      err.code = 'NO_PACK_INSTALLED';
      throw err;
    }

    // Prepare high-contrast black-on-white crop canvas for Tesseract accuracy
    const dpr = Number(inkCanvas.dataset?.dpr) || 1;
    const pad = 18;
    const w = Math.max(40, Math.round(bounds.w + pad * 2));
    const h = Math.max(40, Math.round(bounds.h + pad * 2));
    const scaleUp = w < 280 ? 2 : 1.5;

    const crop = document.createElement('canvas');
    crop.width = Math.round(w * scaleUp);
    crop.height = Math.round(h * scaleUp);
    const ctx = crop.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, crop.width, crop.height);
    ctx.save();
    ctx.scale(scaleUp, scaleUp);
    if (isDarkBg) {
      ctx.filter = 'invert(1) contrast(1.4)';
    }
    ctx.drawImage(
      inkCanvas,
      Math.max(0, bounds.x * dpr),
      Math.max(0, bounds.y * dpr),
      Math.max(1, bounds.w * dpr),
      Math.max(1, bounds.h * dpr),
      pad,
      pad,
      bounds.w,
      bounds.h
    );
    ctx.restore();

    const text = await this.recognizeCanvas(crop, langCode, packData);
    crop.width = 0;
    crop.height = 0;
    return { text: text.trim(), langCode };
  }

  async recognizeCanvas(canvas, langCode, cachedData = null) {
    const packData = cachedData || (await this._getPackBytes(langCode));
    if (!packData) {
      const err = new Error('NO_PACK_INSTALLED');
      err.code = 'NO_PACK_INSTALLED';
      throw err;
    }

    if (!this._worker || this._workerLang !== langCode) {
      await this._terminateWorker();
      const { createWorker } = await import('tesseract.js');
      const baseHref = window.location.href;
      const workerPath = new URL('./tesseract/worker.min.js', baseHref).href;
      const coreFile = supportsWasmSimd()
        ? './tesseract/tesseract-core-simd-lstm.wasm.js'
        : './tesseract/tesseract-core-lstm.wasm.js';
      const corePath = new URL(coreFile, baseHref).href;

      this._worker = await createWorker([{ code: langCode, data: packData }], 1, {
        workerPath,
        corePath,
        workerBlobURL: false,
        cacheMethod: 'none',
        gzip: false,
      });
      this._workerLang = langCode;
    }

    const { data } = await this._worker.recognize(canvas);
    return data?.text || '';
  }
}
