/**
 * Captnz Board — Open Recent Files & Projects Manager
 * Stores the last 8 opened files (.cboard, .pdf, .pptx, images).
 * - Tauri desktop (.exe): stores native file path for direct disk reopening.
 * - Browser / GitHub Pages: caches lightweight snapshots in IndexedDB for offline reopening.
 */

const META_KEY = 'captnz_recent_files_v1';
const MAX_RECENTS = 8;
const SNAPSHOT_DB = 'captnz_recent_snapshots_db';
const SNAPSHOT_STORE = 'snapshots';
const MAX_WEB_SNAPSHOT_BYTES = 20 * 1024 * 1024; // 20 MB cap per browser snapshot

function openSnapshotDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SNAPSHOT_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSnapshot(id, payload) {
  const db = await openSnapshotDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE).put({ id, ...payload });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadRecentSnapshot(id) {
  try {
    const db = await openSnapshotDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
      const req = tx.objectStore(SNAPSHOT_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function deleteSnapshot(id) {
  try {
    const db = await openSnapshotDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export function getRecentFiles() {
  try {
    const raw = localStorage.getItem(META_KEY);
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveRecentList(list) {
  localStorage.setItem(META_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
}

export async function recordRecentFile({ name, kind, path = null, bytes = null, dataUrl = null }) {
  if (!name || !kind) return;
  const list = getRecentFiles();
  const matchIdx = list.findIndex((item) => (path ? item.path === path : item.name === name && item.kind === kind));
  const id = matchIdx >= 0 ? list[matchIdx].id : `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  if (matchIdx >= 0) {
    list.splice(matchIdx, 1);
  }

  const entry = {
    id,
    name,
    kind, // 'cboard' | 'pdf' | 'ppt' | 'image'
    path: path || null,
    updatedAt: Date.now(),
    hasSnapshot: false,
  };

  if (!path && (bytes || dataUrl)) {
    const approxSize = bytes ? bytes.byteLength || bytes.length || 0 : dataUrl ? dataUrl.length : 0;
    if (approxSize <= MAX_WEB_SNAPSHOT_BYTES) {
      try {
        await saveSnapshot(id, { kind, name, bytes: bytes ? new Uint8Array(bytes) : null, dataUrl });
        entry.hasSnapshot = true;
      } catch {
        // Non-fatal if browser quota is full
      }
    }
  }

  list.unshift(entry);
  const removed = list.slice(MAX_RECENTS);
  for (const old of removed) {
    await deleteSnapshot(old.id);
  }
  saveRecentList(list.slice(0, MAX_RECENTS));
}

export async function removeRecentFile(id) {
  const list = getRecentFiles().filter((item) => item.id !== id);
  saveRecentList(list);
  await deleteSnapshot(id);
}

export async function clearRecentFiles() {
  const list = getRecentFiles();
  saveRecentList([]);
  for (const item of list) {
    await deleteSnapshot(item.id);
  }
}

export function formatRelativeTime(ts) {
  const diffSec = Math.max(0, Math.floor((Date.now() - (ts || Date.now())) / 1000));
  if (diffSec < 60) return 'Just now';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}
