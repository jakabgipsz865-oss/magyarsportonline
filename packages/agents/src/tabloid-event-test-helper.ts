import type { TabloidEventIdentity } from "@magyarsportonline/shared";
export function memoryEvents() {
  const events = new Map<string, TabloidEventIdentity>();
  const locks = new Map<string, Promise<unknown>>();
  return {
    events,
    async withTabloidLock<T>(key: string, work: () => Promise<T>): Promise<T> {
      const previous = locks.get(key) ?? Promise.resolve();
      const next = previous.catch(() => {}).then(work);
      locks.set(key, next);
      return next;
    },
    async getTabloidEvent(id: string) {
      return events.get(id) ?? null;
    },
    async listTabloidEvents(baseKey: string) {
      return [...events]
        .filter(([id, e]) => id === e.canonicalRawId && e.baseKey === baseKey)
        .map(([, e]) => e);
    },
    async saveTabloidEvent(id: string, e: TabloidEventIdentity) {
      events.set(id, structuredClone(e));
    },
  };
}
