// The Codes tab's storage. With a PIN the entries are encrypted on the phone (PBKDF2 -> AES-GCM)
// and only decrypted in memory while the tab is unlocked. Without a PIN they are stored as plain
// text. Nothing here is ever sent anywhere.

export const VKEY = 'shiftlist.vault';
const ITERATIONS = 310000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Encryption needs a secure page (https or localhost).
export const canLock = () => !!(globalThis.crypto && globalThis.crypto.subtle);

let items = [];
let key = null; // CryptoKey while unlocked with a PIN
let salt = null;
let opened = false;

function stored() {
  try {
    return JSON.parse(localStorage.getItem(VKEY));
  } catch {
    return null;
  }
}

async function derive(pin, saltBytes) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// 'new' (never set up), 'locked', or 'open'.
export function status() {
  if (opened) return 'open';
  const raw = stored();
  if (!raw) return 'new';
  if (raw.mode === 'plain') {
    items = raw.items || [];
    opened = true;
    return 'open';
  }
  return 'locked';
}

export const hasPin = () => !!key || stored()?.mode === 'locked';
export const list = () => items;

export async function save() {
  if (key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(items)));
    localStorage.setItem(VKEY, JSON.stringify({ mode: 'locked', salt: b64(salt), iv: b64(iv), data: b64(data) }));
  } else {
    localStorage.setItem(VKEY, JSON.stringify({ mode: 'plain', items }));
  }
}

// Sets, changes (new pin) or removes (null) the PIN, keeping the entries. Also the first-time setup.
export async function setPin(pin) {
  if (pin) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    key = await derive(pin, salt);
  } else {
    key = null;
    salt = null;
  }
  opened = true;
  await save();
}

export async function unlock(pin) {
  const raw = stored();
  if (!raw || raw.mode !== 'locked') return false;
  try {
    const s = unb64(raw.salt);
    const k = await derive(pin, s);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(raw.iv) }, k, unb64(raw.data));
    items = JSON.parse(dec.decode(plain));
    key = k;
    salt = s;
    opened = true;
    return true;
  } catch {
    return false;
  }
}

export function lock() {
  if (!key) return;
  items = [];
  key = null;
  salt = null;
  opened = false;
}

export function erase() {
  localStorage.removeItem(VKEY);
  items = [];
  key = null;
  salt = null;
  opened = false;
}

// For backups: the stored form, still encrypted if there is a PIN.
export const exportRaw = () => stored();

export function importRaw(raw) {
  erase();
  if (raw && (raw.mode === 'plain' || raw.mode === 'locked')) localStorage.setItem(VKEY, JSON.stringify(raw));
}
