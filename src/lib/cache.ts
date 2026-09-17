import { createHash } from "node:crypto";

type Entry = { reply: string; at: number };

const MAX_ENTRIES = 40;
const store = new Map<string, Entry>();

export function cacheKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export function getCached(key: string): string | null {
  const hit = store.get(key);
  if (!hit) return null;
  store.delete(key);
  store.set(key, hit);
  return hit.reply;
}

export function setCached(key: string, reply: string): void {
  store.set(key, { reply, at: Date.now() });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}
