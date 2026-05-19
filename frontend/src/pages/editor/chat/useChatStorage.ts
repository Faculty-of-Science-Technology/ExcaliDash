import { useCallback, useMemo, useRef } from 'react';
import type { ChatMessage, ChatThread } from './ChatTypes';

const DB_VERSION = 1;

const openDb = (drawingId: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(`excalidash-chat-${drawingId}`, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('threads')) {
        db.createObjectStore('threads', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('messages')) {
        const ms = db.createObjectStore('messages', { keyPath: 'id' });
        ms.createIndex('byThread', 'threadId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const idbGet = <T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | undefined> =>
  new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });

const idbGetAll = <T>(store: IDBObjectStore | IDBIndex, query?: IDBKeyRange): Promise<T[]> =>
  new Promise((resolve, reject) => {
    const req = query ? store.getAll(query) : store.getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });

const idbPut = (store: IDBObjectStore, value: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

const idbDelete = (store: IDBObjectStore, key: IDBValidKey): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

// ─── Main hook ────────────────────────────────────────────────────────────────

export const useChatStorage = (drawingId: string) => {
  const dbRef = useRef<IDBDatabase | null>(null);

  const getDb = useCallback(async (): Promise<IDBDatabase> => {
    if (dbRef.current) return dbRef.current;
    const db = await openDb(drawingId);
    dbRef.current = db;
    return db;
  }, [drawingId]);

  // ── Threads ────────────────────────────────────────────────────────────────

  const getThreads = useCallback(async (): Promise<ChatThread[]> => {
    const db = await getDb();
    const tx = db.transaction('threads', 'readonly');
    const all = await idbGetAll<ChatThread>(tx.objectStore('threads'));
    // Sort: default thread first, then by createdAt asc
    return all.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.createdAt - b.createdAt;
    });
  }, [getDb]);

  const ensureMainThread = useCallback(async (): Promise<void> => {
    const db = await getDb();
    const tx = db.transaction('threads', 'readwrite');
    const store = tx.objectStore('threads');
    const existing = await idbGet<ChatThread>(store, 'main');
    if (!existing) {
      await idbPut(store, {
        id: 'main',
        name: 'Main',
        createdAt: Date.now(),
        isDefault: true,
      } satisfies ChatThread);
    }
  }, [getDb]);

  const addThread = useCallback(async (thread: ChatThread): Promise<void> => {
    const db = await getDb();
    const tx = db.transaction('threads', 'readwrite');
    await idbPut(tx.objectStore('threads'), thread);
  }, [getDb]);

  const deleteThread = useCallback(async (threadId: string): Promise<void> => {
    if (threadId === 'main') return; // safety — never delete main
    const db = await getDb();
    // Delete thread + all its messages
    const tx = db.transaction(['threads', 'messages'], 'readwrite');
    await idbDelete(tx.objectStore('threads'), threadId);
    const msgStore = tx.objectStore('messages');
    const index = msgStore.index('byThread');
    const range = IDBKeyRange.only(threadId);
    const msgs = await idbGetAll<ChatMessage>(index, range);
    for (const m of msgs) {
      await idbDelete(msgStore, m.id);
    }
  }, [getDb]);

  // ── Messages ───────────────────────────────────────────────────────────────

  const getMessage = useCallback(async (id: string): Promise<ChatMessage | undefined> => {
    const db = await getDb();
    const tx = db.transaction('messages', 'readonly');
    return idbGet<ChatMessage>(tx.objectStore('messages'), id);
  }, [getDb]);

  const getMessages = useCallback(async (threadId: string): Promise<ChatMessage[]> => {
    const db = await getDb();
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('byThread');
    const msgs = await idbGetAll<ChatMessage>(index, IDBKeyRange.only(threadId));
    return msgs.sort((a, b) => a.timestamp - b.timestamp);
  }, [getDb]);

  const addMessage = useCallback(async (message: ChatMessage): Promise<void> => {
    const db = await getDb();
    const tx = db.transaction('messages', 'readwrite');
    await idbPut(tx.objectStore('messages'), message);
  }, [getDb]);

  const clearThread = useCallback(async (threadId: string): Promise<void> => {
    const db = await getDb();
    const tx = db.transaction('messages', 'readwrite');
    const msgStore = tx.objectStore('messages');
    const index = msgStore.index('byThread');
    const msgs = await idbGetAll<ChatMessage>(index, IDBKeyRange.only(threadId));
    for (const m of msgs) {
      await idbDelete(msgStore, m.id);
    }
  }, [getDb]);

  return useMemo(() => ({
    getThreads,
    ensureMainThread,
    addThread,
    deleteThread,
    getMessage,
    getMessages,
    addMessage,
    clearThread,
  }), [getThreads, ensureMainThread, addThread, deleteThread, getMessage, getMessages, addMessage, clearThread]);
};
