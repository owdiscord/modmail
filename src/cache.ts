interface CacheEntry<T> {
  value: T;
  expiry: number;
}

export function createCache<T>(ttl_ms: number) {
  const store = new Map<string, CacheEntry<T>>();

  function get(key: string): T | null {
    const entry = store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      store.delete(key);
      return null;
    }

    return entry.value;
  }

  function set(key: string, value: T): void {
    store.set(key, { value, expiry: Date.now() + ttl_ms });
  }

  function del(key: string): void {
    store.delete(key);
  }

  function clear() {
    store.clear();
  }

  return {
    get,
    set,
    del,
    clear,
  };
}
