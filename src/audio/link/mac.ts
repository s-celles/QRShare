/**
 * Medium access for audio sessions (REQ-ALS-020): listen before talking.
 * A station transmits only after the channel has been quiet for `guardMs` and a
 * random back-off has elapsed; a signal during the back-off cancels the turn and
 * a new back-off is drawn. Pure (injected random), driven by `update(now, busy)`.
 */
export interface MacOptions {
  readonly guardMs: number;
  readonly maxBackoffMs: number;
}

export class LinkMac {
  private quietSince = 0;
  private backoffUntil: number | null = null;
  private readonly opts: MacOptions;

  constructor(private readonly random: () => number = Math.random, opts: Partial<MacOptions> = {}) {
    this.opts = { guardMs: 400, maxBackoffMs: 1000, ...opts };
  }

  /** Returns true when the caller may start transmitting now. */
  update(now: number, busy: boolean): boolean {
    if (busy || now < this.quietSince) {
      if (busy) this.quietSince = now;
      this.backoffUntil = null;
      return false;
    }
    if (now - this.quietSince < this.opts.guardMs) return false;
    if (this.backoffUntil === null) this.backoffUntil = now + this.random() * this.opts.maxBackoffMs;
    return now >= this.backoffUntil;
  }

  /** Our own transmission occupies the channel from `now` for `durationMs`. */
  transmitted(now: number, durationMs: number): void {
    this.quietSince = now + durationMs;
    this.backoffUntil = null;
  }
}
