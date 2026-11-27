/**
 * Captnz Board — File Importer (PDF.js + Images + PPTX/PPT via Rust Tauri Bridge)
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

export async function loadPdfFromBytes(uint8Array) {
  const copy = new Uint8Array(uint8Array);
  const loadingTask = pdfjsLib.getDocument({ data: copy });
  return await loadingTask.promise;
}

export async function pickAndOpenPdf() {
  if (isTauriRuntime()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (!selected) return null;
    const filePath = Array.isArray(selected) ? selected[0] : selected;
    const bytes = await invoke('read_file_bytes', { path: filePath });
    const rawBytes = new Uint8Array(bytes);
    const pdfDoc = await loadPdfFromBytes(rawBytes);
    return { pdfDoc, rawBytes, name: filePath.split(/[\\/]/).pop(), path: filePath };
  }

  return await new Promise((resolve) => {
    const input = document.getElementById('fallback-pdf-input');
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const rawBytes = new Uint8Array(await file.arrayBuffer());
      const pdfDoc = await loadPdfFromBytes(rawBytes);
      resolve({ pdfDoc, rawBytes, name: file.name, path: null });
    };
    input.click();
  });
}

export async function pickAndOpenPpt() {
  if (isTauriRuntime()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'PowerPoint Presentation', extensions: ['pptx', 'ppt'] }],
    });
    if (!selected) return null;
    const filePath = Array.isArray(selected) ? selected[0] : selected;
    const name = filePath.split(/[\\/]/).pop();

    // 1. Try native LibreOffice / PowerPoint COM conversion to high-res PDF
    try {
      const pdfBytes = await invoke('convert_ppt_to_pdf', { inputPath: filePath });
      const rawBytes = new Uint8Array(pdfBytes);
      const pdfDoc = await loadPdfFromBytes(rawBytes);
      return { mode: 'pdf', pdfDoc, rawBytes, name, path: filePath };
    } catch {
      // 2. Fall back to built-in Rust PPTX XML + embedded media extractor
      if (filePath.toLowerCase().endsWith('.pptx')) {
        const slides = await invoke('extract_pptx_fallback', { inputPath: filePath });
        return { mode: 'fallback', slides, name, path: filePath };
      }
      throw new Error('Install LibreOffice or Microsoft PowerPoint to convert legacy .ppt files.');
    }
  }

  throw new Error('PPT/PPTX conversion requires the Captnz Board Windows desktop app.');
}

export async function pickAndImportImage() {
  if (isTauriRuntime()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (!selected) return null;
    const filePath = Array.isArray(selected) ? selected[0] : selected;
    const bytes = await invoke('read_file_bytes', { path: filePath });
    const ext = filePath.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const blob = new Blob([new Uint8Array(bytes)], { type: mime });
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, name: filePath.split(/[\\/]/).pop(), path: filePath };
  }

  return await new Promise((resolve) => {
    const input = document.getElementById('fallback-img-input');
    input.value = '';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const dataUrl = await blobToDataUrl(file);
      resolve({ dataUrl, name: file.name, path: null });
    };
    input.click();
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Opens a local file path directly (used by Windows "Open with Captnz Board" & CLI launches).
 */
export async function openFileFromPath(filePath) {
  if (!isTauriRuntime() || !filePath) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const name = filePath.split(/[\\/]/).pop() || filePath;
  const ext = name.split('.').pop()?.toLowerCase() || '';

  if (ext === 'cboard') {
    const bytes = await invoke('read_file_bytes', { path: filePath });
    return { kind: 'cboard', bytes: new Uint8Array(bytes), name };
  }

  if (ext === 'pdf') {
    const bytes = await invoke('read_file_bytes', { path: filePath });
    const rawBytes = new Uint8Array(bytes);
    const pdfDoc = await loadPdfFromBytes(rawBytes);
    return { kind: 'pdf', pdfDoc, rawBytes, name };
  }

  if (ext === 'pptx' || ext === 'ppt') {
    try {
      const pdfBytes = await invoke('convert_ppt_to_pdf', { inputPath: filePath });
      const rawBytes = new Uint8Array(pdfBytes);
      const pdfDoc = await loadPdfFromBytes(rawBytes);
      return { kind: 'ppt', mode: 'pdf', pdfDoc, rawBytes, name };
    } catch {
      if (ext === 'pptx') {
        const slides = await invoke('extract_pptx_fallback', { inputPath: filePath });
        return { kind: 'ppt', mode: 'fallback', slides, name };
      }
      throw new Error('Install LibreOffice or Microsoft PowerPoint to convert legacy .ppt files.');
    }
  }

  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    const bytes = await invoke('read_file_bytes', { path: filePath });
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const blob = new Blob([new Uint8Array(bytes)], { type: mime });
    const dataUrl = await blobToDataUrl(blob);
    return { kind: 'image', dataUrl, name };
  }

  return null;
}
