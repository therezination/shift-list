// Photos attached to things to mention. They are shrunk to a sensible size and kept in the
// phone's IndexedDB (localStorage is far too small for images). Nothing is uploaded anywhere.

const DB = 'shiftlist-photos';
const STORE = 'photos';

let opening = null;
function db() {
  opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

function run(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const put = (id, blob) => run('readwrite', (s) => s.put(blob, id));
export const get = (id) => run('readonly', (s) => s.get(id));
export const remove = (id) => run('readwrite', (s) => s.delete(id));
export const keys = () => run('readonly', (s) => s.getAllKeys());

const urls = new Map();

// An object URL for showing the photo, or null if it is not on this phone.
export async function url(id) {
  if (urls.has(id)) return urls.get(id);
  const blob = await get(id).catch(() => null);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

// The photo as a file, for the share sheet.
export async function file(id, name) {
  const blob = await get(id).catch(() => null);
  return blob ? new File([blob], name, { type: blob.type || 'image/jpeg' }) : null;
}

// Deletes every stored photo that nothing refers to any more.
export async function sweep(keep) {
  const wanted = new Set(keep);
  for (const id of await keys()) {
    if (wanted.has(id)) continue;
    await remove(id);
    if (urls.has(id)) {
      URL.revokeObjectURL(urls.get(id));
      urls.delete(id);
    }
  }
}

// Shrinks a camera photo so the longest side is at most `max` pixels, as a JPEG.
export async function shrink(source, max = 1280, quality = 0.72) {
  const bmp = await createImageBitmap(source, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode the photo'))), 'image/jpeg', quality);
  });
}
