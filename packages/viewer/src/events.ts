/** Minimal typed event emitter. Listener errors are isolated and reported via onError. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  constructor(private onError: (e: unknown) => void = (e) => console.error(e)) {}

  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as (payload: never) => void);
    return () => this.off(type, fn);
  }

  off<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): void {
    this.listeners.get(type)?.delete(fn as (payload: never) => void);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      try {
        (fn as (p: Events[K]) => void)(payload);
      } catch (e) {
        this.onError(e);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
