/** A minimal typed event emitter (no framework dependency). */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<(value: never) => void>>();

  on<K extends keyof Events>(event: K, fn: (value: Events[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn as (value: never) => void);
    return () => set!.delete(fn as (value: never) => void);
  }

  emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const fn of this.handlers.get(event) ?? []) (fn as (value: Events[K]) => void)(value);
  }

  clear(): void {
    this.handlers.clear();
  }
}
