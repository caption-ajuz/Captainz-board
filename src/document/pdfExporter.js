/**
 * Captnz Board — High-Resolution Annotated PDF Exporter (jsPDF + Tauri Native Save)
 */

import { jsPDF } from 'jspdf';
import { isTauriRuntime } from './fileImporter.js';

export async function exportSessionToPdf(pageManager, inkEngine) {
  const pages = pageManager.pages;
  if (!pages.length) return false;

  // Export at crisp 1920x1080 (2x high-DPI scaling) matching the live aspect ratio
  const cssW = window.innerWidth || 1920;
  const cssH = window.innerHeight || 1080;
  const exportDpr = 2;

  const orientation = cssW >= cssH ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [cssW, cssH],
    compress: true,
  });

  const bgOff = document.createElement('canvas');
  bgOff.width = Math.round(cssW * exportDpr);
  bgOff.height = Math.round(cssH * exportDpr);

  const inkOff = document.createElement('canvas');
  inkOff.width = bgOff.width;
  inkOff.height = bgOff.height;
  const inkOffCtx = inkOff.getContext('2d');

  const merged = document.createElement('canvas');
  merged.width = bgOff.width;
  merged.height = bgOff.height;
  const mergedCtx = merged.getContext('2d');

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (i > 0) pdf.addPage([cssW, cssH], orientation);

    // 1. Render board background / PDF slide / Image
    await pageManager.renderPageBackground(page, bgOff, exportDpr);

    // 2. Render ink strokes at export DPR
    inkOffCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkOffCtx.clearRect(0, 0, inkOff.width, inkOff.height);
    inkOffCtx.setTransform(exportDpr, 0, 0, exportDpr, 0, 0);
    for (const stroke of page.strokes) {
      inkEngine.drawStroke(inkOffCtx, stroke);
    }

    // 3. Composite background + stamps + ink
    mergedCtx.setTransform(1, 0, 0, 1, 0, 0);
    mergedCtx.drawImage(bgOff, 0, 0);

    // Draw snipped stamps
    if (page.stamps && page.stamps.length > 0) {
      mergedCtx.save();
      mergedCtx.setTransform(exportDpr, 0, 0, exportDpr, 0, 0);
      for (const st of page.stamps) {
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            mergedCtx.drawImage(img, st.x, st.y, st.w, st.h);
            resolve();
          };
          img.onerror = resolve;
          img.src = st.dataUrl;
        });
      }
      mergedCtx.restore();
    }

    mergedCtx.setTransform(1, 0, 0, 1, 0, 0);
    mergedCtx.drawImage(inkOff, 0, 0);

    const imgData = merged.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, cssW, cssH, undefined, 'FAST');
  }

  // Release temporary 2x export offscreen buffers immediately
  bgOff.width = bgOff.height = 0;
  inkOff.width = inkOff.height = 0;
  merged.width = merged.height = 0;

  const defaultName = `CaptnzBoard_${new Date().toISOString().slice(0, 10)}.pdf`;

  if (isTauriRuntime()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const dest = await save({
      defaultPath: defaultName,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (!dest) return false;
    const arrayBuffer = pdf.output('arraybuffer');
    await invoke('write_file_bytes', {
      path: dest,
      bytes: Array.from(new Uint8Array(arrayBuffer)),
    });
    return true;
  }

  pdf.save(defaultName);
  return true;
}
