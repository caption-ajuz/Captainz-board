/**
 * Captnz Board — High-Resolution Annotated PDF Exporter (jsPDF + Tauri Native Save)
 */

import { jsPDF } from 'jspdf';
import { isTauriRuntime } from './fileImporter.js';
import { svgMarkupToDataUrl } from '../engine/lassoSnip.js';

function drawStickyNoteToCtx(ctx, st) {
  ctx.save();
  ctx.fillStyle = st.color || '#fef08a';
  ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(st.x, st.y, st.w, st.h, 8);
  } else {
    ctx.rect(st.x, st.y, st.w, st.h);
  }
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Header divider
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
  ctx.fillRect(st.x, st.y, st.w, 26);

  // Text lines
  ctx.fillStyle = '#1e293b';
  ctx.font = '500 14px "Segoe UI", system-ui, sans-serif';
  const pad = 12;
  const maxW = Math.max(40, st.w - pad * 2);
  const words = (st.text || '').split(/(\s+)/);
  let line = '';
  let y = st.y + 46;
  for (const token of words) {
    if (token === '\n') {
      ctx.fillText(line, st.x + pad, y, maxW);
      line = '';
      y += 20;
      continue;
    }
    const test = line + token;
    if (ctx.measureText(test).width > maxW && line.trim()) {
      ctx.fillText(line, st.x + pad, y, maxW);
      line = token.trimStart();
      y += 20;
    } else {
      line = test;
    }
    if (y > st.y + st.h - 10) break;
  }
  if (line && y <= st.y + st.h - 10) {
    ctx.fillText(line, st.x + pad, y, maxW);
  }
  ctx.restore();
}

function drawTextBoxToCtx(ctx, st) {
  ctx.save();
  const fontSize = st.fontSize || 22;
  ctx.fillStyle = st.color || '#111827';
  ctx.font = `600 ${fontSize}px "Segoe UI", "Noto Sans Malayalam", "Rachana", "Noto Sans Arabic", sans-serif`;
  ctx.direction = st.dir === 'rtl' ? 'rtl' : 'ltr';
  ctx.textAlign = st.dir === 'rtl' ? 'right' : 'left';
  const anchorX = st.dir === 'rtl' ? st.x + st.w - 10 : st.x + 10;
  const maxW = Math.max(40, st.w - 20);
  const lines = (st.text || '').split('\n');
  let y = st.y + fontSize + 10;
  for (const line of lines) {
    ctx.fillText(line, anchorX, y, maxW);
    y += Math.round(fontSize * 1.35);
    if (y > st.y + st.h) break;
  }
  ctx.restore();
}

export async function exportSessionToPdf(pageManager, inkEngine) {
  const pages = pageManager.pages;
  if (!pages.length) return false;

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

  const hlOff = document.createElement('canvas');
  hlOff.width = bgOff.width;
  hlOff.height = bgOff.height;
  const hlOffCtx = hlOff.getContext('2d');

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

    // 2. Render highlight & ink strokes onto separated layers at export DPR
    hlOffCtx.setTransform(1, 0, 0, 1, 0, 0);
    hlOffCtx.clearRect(0, 0, hlOff.width, hlOff.height);
    hlOffCtx.setTransform(exportDpr, 0, 0, exportDpr, 0, 0);

    inkOffCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkOffCtx.clearRect(0, 0, inkOff.width, inkOff.height);
    inkOffCtx.setTransform(exportDpr, 0, 0, exportDpr, 0, 0);

    for (const stroke of page.strokes) {
      if (stroke.tool === 'highlighter') {
        inkEngine.drawStroke(hlOffCtx, stroke, 1, { onDedicatedHighlightLayer: true });
      } else if (stroke.tool === 'eraser-pixel' || stroke.tool === 'palm-eraser') {
        inkEngine.drawStroke(hlOffCtx, stroke);
        inkEngine.drawStroke(inkOffCtx, stroke);
      } else {
        inkEngine.drawStroke(inkOffCtx, stroke);
      }
    }

    // 3. Composite background + behind-ink highlighter (multiply/screen) + stamps + ink
    mergedCtx.setTransform(1, 0, 0, 1, 0, 0);
    mergedCtx.fillStyle = '#ffffff';
    mergedCtx.fillRect(0, 0, merged.width, merged.height);
    mergedCtx.drawImage(bgOff, 0, 0);

    mergedCtx.save();
    mergedCtx.globalCompositeOperation = page.background === 'blackboard' ? 'screen' : 'multiply';
    mergedCtx.drawImage(hlOff, 0, 0);
    mergedCtx.restore();

    if (page.stamps && page.stamps.length > 0) {
      mergedCtx.save();
      mergedCtx.setTransform(exportDpr, 0, 0, exportDpr, 0, 0);
      for (const st of page.stamps) {
        if (st.kind === 'sticky') {
          drawStickyNoteToCtx(mergedCtx, st);
          continue;
        }
        if (st.kind === 'text') {
          drawTextBoxToCtx(mergedCtx, st);
          continue;
        }
        const src = st.svgMarkup ? svgMarkupToDataUrl(st.svgMarkup) : st.dataUrl;
        if (!src) continue;
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            mergedCtx.save();
            if (st.rot) {
              mergedCtx.translate(st.x + st.w / 2, st.y + st.h / 2);
              mergedCtx.rotate((st.rot * Math.PI) / 180);
              mergedCtx.drawImage(img, -st.w / 2, -st.h / 2, st.w, st.h);
            } else {
              mergedCtx.drawImage(img, st.x, st.y, st.w, st.h);
            }
            mergedCtx.restore();
            resolve();
          };
          img.onerror = resolve;
          img.src = src;
        });
      }
      mergedCtx.restore();
    }

    mergedCtx.setTransform(1, 0, 0, 1, 0, 0);
    mergedCtx.drawImage(inkOff, 0, 0);

    const imgData = merged.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, cssW, cssH, undefined, 'FAST');
  }

  bgOff.width = bgOff.height = 0;
  hlOff.width = hlOff.height = 0;
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
