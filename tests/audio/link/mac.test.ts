import { describe, expect, it } from "bun:test";
import { LinkMac } from "@/audio/link/mac";

describe("LinkMac (REQ-ALS-020)", () => {
  it("never transmits while the channel is busy", () => {
    const mac = new LinkMac(() => 0);
    for (let t = 0; t < 5000; t += 50) expect(mac.update(t, true)).toBe(false);
  });

  it("waits for the guard time plus a random back-off after the channel goes quiet", () => {
    const mac = new LinkMac(() => 0.5, { guardMs: 400, maxBackoffMs: 1000 });
    mac.update(0, true);
    expect(mac.update(300, false)).toBe(false); // within guard
    expect(mac.update(500, false)).toBe(false); // back-off drawn: until 500 + 500
    expect(mac.update(900, false)).toBe(false);
    expect(mac.update(1000, false)).toBe(true);
  });

  it("gives up its turn when a signal appears during the back-off, and draws again", () => {
    const draws = [0.9, 0.1];
    const mac = new LinkMac(() => draws.shift() ?? 0, { guardMs: 400, maxBackoffMs: 1000 });
    mac.update(0, true);
    mac.update(500, false); // back-off until 1400
    expect(mac.update(1000, true)).toBe(false); // someone else speaks
    expect(mac.update(1500, false)).toBe(false); // guard again (until 1400 + … ), new draw 0.1 → 1500 + 100
    expect(mac.update(1700, false)).toBe(true);
  });

  it("stays quiet during and right after its own transmission", () => {
    const mac = new LinkMac(() => 0, { guardMs: 400, maxBackoffMs: 1000 });
    expect(mac.update(0, false)).toBe(false); // guard from start
    expect(mac.update(400, false)).toBe(true);
    mac.transmitted(400, 1200);
    expect(mac.update(1000, false)).toBe(false);
    expect(mac.update(1700, false)).toBe(false);
    expect(mac.update(2000, false)).toBe(true);
  });

  it("two stations with different draws do not pick the same instant", () => {
    const a = new LinkMac(() => 0.2);
    const b = new LinkMac(() => 0.7);
    let ta = -1;
    let tb = -1;
    for (let t = 0; t < 3000; t += 10) {
      if (ta < 0 && a.update(t, false)) ta = t;
      if (tb < 0 && b.update(t, false)) tb = t;
    }
    expect(ta).toBeGreaterThan(0);
    expect(tb - ta).toBeGreaterThan(300);
  });
});
