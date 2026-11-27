/**
 * Captnz Board — Editable .cboard Project Format (Gzip-compressed JSON + embedded PDFs/Stamps/Notes)
 */

import { isTauriRuntime, loadPdfFromBytes } from './fileImporter.js';

function uint8ToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function compressGzip(bytes) {
  if (typeof CompressionStream === 'undefined') return bytes;
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}

async function decompressGzip(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Gzip decompression is not supported in this runtime.');
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

export async function serializeCboardBytes(pageManager) {
  const pdfDocs = {};
  for (const [id, entry] of pageManager.pdfDocs.entries()) {
    if (entry?.rawBytes) {
      pdfDocs[id] = uint8ToBase64(
        entry.rawBytes instanceof Uint8Array ? entry.rawBytes : new Uint8Array(entry.rawBytes)
      );
    }
  }

  const cleanPages = pageManager.pages.map((p) => {
    const copy = { ...p };
    delete copy._offscreenCanvas;
    delete copy._decodedImage;
    delete copy._layout;
    copy.redoStack = [];
    copy.thumbnail = null;
    copy.stamps = (p.stamps || []).map((st) => ({ ...st }));
    return copy;
  });

  const project = {
    format: 'captnz-board',
    version: 1,
    savedAt: Date.now(),
    currentIndex: pageManager.currentIndex,
    defaultBackground: pageManager.defaultBackground,
    pages: cleanPages,
    pdfDocs,
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(project));
  return await compressGzip(jsonBytes);
}

export async function loadCboardFromBytes(uint8Array, pageManager) {
  const bytes = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const rawJsonBytes = isGzip ? await decompressGzip(bytes) : bytes;
  const text = new TextDecoder().decode(rawJsonBytes);
  const data = JSON.parse(text);

  if (!data || data.format !== 'captnz-board' || !Array.isArray(data.pages) || data.pages.length === 0) {
    throw new Error('Invalid or corrupted .cboard project file.');
  }

  pageManager.releaseInactivePageBuffers(-1);
  pageManager.pdfDocs.clear();

  if (data.pdfDocs) {
    for (const [id, b64] of Object.entries(data.pdfDocs)) {
      const u8 = base64ToUint8(b64);
      const pdfDoc = await loadPdfFromBytes(u8);
      pageManager.pdfDocs.set(id, { pdfDoc, rawBytes: u8 });
    }
  }

  pageManager.defaultBackground = data.defaultBackground || 'white';
  pageManager.pages = data.pages.map((p) => ({
    ...p,
    strokes: Array.isArray(p.strokes) ? p.strokes : [],
    redoStack: [],
    stamps: Array.isArray(p.stamps) ? p.stamps : [],
    thumbnail: null,
  }));
  pageManager.currentIndex = Math.max(0, Math.min(data.currentIndex || 0, pageManager.pages.length - 1));
  pageManager.onPagesUpdated?.();
  pageManager.onPageChanged?.(pageManager.getCurrentPage(), pageManager.currentIndex);
  return true;
}

export async function saveCboardProject(pageManager) {
  const bytes = await serializeCboardBytes(pageManager);
  const defaultName = `CaptnzBoard_${new Date().toISOString().slice(0, 10)}.cboard`;

  if (isTauriRuntime()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const dest = await save({
      defaultPath: defaultName,
      filters: [{ name: 'Captnz Board Project', extensions: ['cboard'] }],
    });
    if (!dest) return null;
    await invoke('write_file_bytes', { path: dest, bytes: Array.from(bytes) });
    return { name: dest.split(/[\\/]/).pop(), path: dest, bytes };
  }

  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name: defaultName, path: null, bytes };
}

export async function pickAndOpenCboard(pageManager) {
  if (isTauriRuntime()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Captnz Board Project', extensions: ['cboard'] }],
    });
    if (!selected) return null;
    const filePath = Array.isArray(selected) ? selected[0] : selected;
    const bytes = new Uint8Array(await invoke('read_file_bytes', { path: filePath }));
    await loadCboardFromBytes(bytes, pageManager);
    return { name: filePath.split(/[\\/]/).pop(), path: filePath, bytes };
  }

  return await new Promise((resolve, reject) => {
    const input = document.getElementById('fallback-cboard-input');
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await loadCboardFromBytes(bytes, pageManager);
        resolve({ name: file.name, path: null, bytes });
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}
