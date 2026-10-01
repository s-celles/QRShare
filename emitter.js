/** A minimal typed event emitter (no framework dependency). */
export class Emitter {
    handlers = new Map();
    on(event, fn) {
        let set = this.handlers.get(event);
        if (!set)
            this.handlers.set(event, (set = new Set()));
        set.add(fn);
        return () => set.delete(fn);
    }
    emit(event, value) {
        for (const fn of this.handlers.get(event) ?? [])
            fn(value);
    }
    clear() {
        this.handlers.clear();
    }
}
