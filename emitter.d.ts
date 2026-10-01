/** A minimal typed event emitter (no framework dependency). */
export declare class Emitter<Events extends Record<string, unknown>> {
    private readonly handlers;
    on<K extends keyof Events>(event: K, fn: (value: Events[K]) => void): () => void;
    emit<K extends keyof Events>(event: K, value: Events[K]): void;
    clear(): void;
}
