import type { AccountVaultRecord, AppState, CachedAssetEntry } from '../types/pappo';
import { planCacheEviction } from '../utils/meshRouter';
import {
  readEmbeddedSnapshotFromDom,
  readOpfsLiveSnapshot,
  shouldHydrateEmbeddedSnapshot,
  writeLinkedLocalAppFile,
  writeOpfsLiveSnapshot,
  type PappoPortableSnapshot,
} from './selfContainedApp';

const DB_NAME = 'pappo_hybrid_vault_v1';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const STORE_CACHE = 'cache_meta';
const STORE_BLOBS = 'cache_blobs';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
        if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
        if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function kvPut<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      tx.objectStore(STORE_KV).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    return;
  }
  try {
    localStorage.setItem(`pappo_kv:${key}`, JSON.stringify(value));
  } catch {
    // ignore storage quota errors gracefully
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_KV, 'readonly');
      const req = tx.objectStore(STORE_KV).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    });
  }
  try {
    const raw = localStorage.getItem(`pappo_kv:${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function kvDel(keys: string[]): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const store = tx.objectStore(STORE_KV);
      for (const k of keys) store.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  for (const k of keys) {
    try {
      localStorage.removeItem(`pappo_kv:${k}`);
    } catch {
      // ignore
    }
  }
}

export async function loadAccountsMap(): Promise<Record<string, AccountVaultRecord>> {
  return (await kvGet<Record<string, AccountVaultRecord>>('__accounts')) || {};
}

export async function saveAccountsMap(accounts: Record<string, AccountVaultRecord>): Promise<void> {
  await kvPut('__accounts', accounts);
  await kvPut('__last_saved_at', Date.now());
}

export async function loadAccountState(handle: string): Promise<AppState | null> {
  return kvGet<AppState>(`acct:${handle}`);
}

export async function saveAccountState(handle: string, state: AppState): Promise<void> {
  await kvPut(`acct:${handle}`, state);
  await kvPut('__last_saved_at', Date.now());
}

export async function buildFullPortableSnapshot(
  overrideActiveHandle?: string | null
): Promise<PappoPortableSnapshot> {
  const accounts = await loadAccountsMap();
  const states: Record<string, AppState> = {};
  for (const h of Object.keys(accounts)) {
    const st = await loadAccountState(h);
    if (st) states[h] = st;
  }
  const activeHandle =
    overrideActiveHandle !== undefined
      ? overrideActiveHandle
      : await kvGet<string>('__active_session');
  return {
    v: 2,
    exportedAt: Date.now(),
    activeHandle: activeHandle || null,
    accounts,
    states,
  };
}

export async function restorePortableSnapshot(snapshot: PappoPortableSnapshot): Promise<void> {
  await kvPut('__accounts', snapshot.accounts || {});
  for (const [h, st] of Object.entries(snapshot.states || {})) {
    await kvPut(`acct:${h}`, st);
  }
  if (snapshot.activeHandle && snapshot.accounts[snapshot.activeHandle]) {
    await kvPut('__active_session', snapshot.activeHandle);
  }
  await kvPut('__last_saved_at', snapshot.exportedAt || Date.now());
  await writeOpfsLiveSnapshot(snapshot);
}

export async function hydrateLocalVaultFromEmbeddedOrOpfs(): Promise<{
  hydratedFrom: 'none' | 'opfs' | 'embedded';
}> {
  const localAccounts = await loadAccountsMap();
  const localLastSavedAt = (await kvGet<number>('__last_saved_at')) || 0;

  const embedded = readEmbeddedSnapshotFromDom();
  const opfs = await readOpfsLiveSnapshot();

  // Pick whichever source is newest when local IndexedDB is empty or older
  const candidates: Array<{ src: 'opfs' | 'embedded'; snap: PappoPortableSnapshot }> = [];
  if (opfs) candidates.push({ src: 'opfs', snap: opfs });
  if (embedded) candidates.push({ src: 'embedded', snap: embedded });
  candidates.sort((a, b) => b.snap.exportedAt - a.snap.exportedAt);

  for (const c of candidates) {
    if (shouldHydrateEmbeddedSnapshot(c.snap, localAccounts, localLastSavedAt)) {
      await restorePortableSnapshot(c.snap);
      return { hydratedFrom: c.src };
    }
  }
  return { hydratedFrom: 'none' };
}

export async function syncLiveLocalSnapshot(
  activeHandle?: string | null
): Promise<{ savedAt: number; opfsSaved: boolean; fileSaved: boolean }> {
  const snapshot = await buildFullPortableSnapshot(activeHandle);
  const opfsSaved = await writeOpfsLiveSnapshot(snapshot);
  const fileSaved = await writeLinkedLocalAppFile(snapshot);
  return { savedAt: snapshot.exportedAt, opfsSaved, fileSaved };
}

export async function hashClientSecret(secret: string, salt: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(`${salt}:${secret}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381;
  for (const ch of `${salt}:${secret}`) {
    h = (h * 33) ^ ch.charCodeAt(0);
  }
  return `fb_${h >>> 0}`;
}

export function generateSaltHex(bytes = 12): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateRecoveryCredentials(): { recoveryKey: string; recoveryCodes: string[] } {
  const seg = () => {
    const a = new Uint8Array(2);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  };
  const recoveryKey = `PAPPO-${seg()}-${seg()}-${seg()}`;
  const recoveryCodes = Array.from({ length: 6 }, () => `${seg()}${seg().slice(0, 2)}`);
  return { recoveryKey, recoveryCodes };
}

/* ---------- Protected Temporary Media Cache (LRU, separate from account posts/messages) ---------- */

export async function putMediaCache(
  assetId: string,
  blob: Blob | string,
  quality: CachedAssetEntry['quality'],
  limitMb: number
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const bytes = typeof blob === 'string' ? blob.length : blob.size;
  const mime = typeof blob === 'string' ? 'text/plain' : blob.type || 'application/octet-stream';
  const entry: CachedAssetEntry = {
    assetId,
    quality,
    bytes,
    mime,
    lastAccessed: Date.now(),
    expiresAt: Date.now() + 72 * 3600 * 1000,
  };

  await new Promise<void>((resolve) => {
    const tx = db.transaction([STORE_CACHE, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_CACHE).put(entry, assetId);
    tx.objectStore(STORE_BLOBS).put(blob, assetId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });

  await enforceCacheLimit(limitMb);
}

export async function getMediaCache(assetId: string): Promise<Blob | string | null> {
  const db = await openDb();
  if (!db) return null;

  const meta = await new Promise<CachedAssetEntry | null>((resolve) => {
    const tx = db.transaction(STORE_CACHE, 'readonly');
    const req = tx.objectStore(STORE_CACHE).get(assetId);
    req.onsuccess = () => resolve((req.result as CachedAssetEntry) ?? null);
    req.onerror = () => resolve(null);
  });
  if (!meta) return null;
  if (meta.expiresAt > 0 && meta.expiresAt <= Date.now()) {
    await deleteMediaCacheIds([assetId]);
    return null;
  }

  const data = await new Promise<Blob | string | null>((resolve) => {
    const tx = db.transaction(STORE_BLOBS, 'readonly');
    const req = tx.objectStore(STORE_BLOBS).get(assetId);
    req.onsuccess = () => resolve((req.result as Blob | string) ?? null);
    req.onerror = () => resolve(null);
  });

  if (data) {
    meta.lastAccessed = Date.now();
    const tx = db.transaction(STORE_CACHE, 'readwrite');
    tx.objectStore(STORE_CACHE).put(meta, assetId);
  }
  return data;
}

export async function listMediaCacheMeta(): Promise<CachedAssetEntry[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_CACHE, 'readonly');
    const req = tx.objectStore(STORE_CACHE).getAll();
    req.onsuccess = () => resolve((req.result as CachedAssetEntry[]) || []);
    req.onerror = () => resolve([]);
  });
}

export async function deleteMediaCacheIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction([STORE_CACHE, STORE_BLOBS], 'readwrite');
    const cm = tx.objectStore(STORE_CACHE);
    const cb = tx.objectStore(STORE_BLOBS);
    for (const id of ids) {
      cm.delete(id);
      cb.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function enforceCacheLimit(limitMb: number): Promise<number> {
  const entries = await listMediaCacheMeta();
  const plan = planCacheEviction(entries, limitMb);
  if (plan.evictIds.length) {
    await deleteMediaCacheIds(plan.evictIds);
  }
  return plan.totalBytesAfter;
}

export async function clearTemporaryMediaCache(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction([STORE_CACHE, STORE_BLOBS], 'readwrite');
    tx.objectStore(STORE_CACHE).clear();
    tx.objectStore(STORE_BLOBS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function getCacheStats(): Promise<{ count: number; totalBytes: number }> {
  const entries = await listMediaCacheMeta();
  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  return { count: entries.length, totalBytes };
}
