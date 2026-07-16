import { describe, expect, it } from "bun:test";
import { CollabDoc } from "@/collab/doc";

describe("CollabDoc CRDT convergence", () => {
  it("converges two docs under out-of-order update delivery", () => {
    const a = new CollabDoc();
    const updates: Uint8Array[] = [];
    a.onUpdate((u) => updates.push(u));

    a.setText("Hello");
    a.setText("Hello World");
    a.setText("Hello brave World");

    const b = new CollabDoc();
    // Deliver the captured updates out of order (reversed).
    for (const u of [...updates].reverse()) {
      b.applyRemote(u);
    }

    expect(b.text).toBe("Hello brave World");
    expect(a.text).toBe(b.text);
  });

  it("represents the document as a single Y.Text and mirrors it into a signal", () => {
    const a = new CollabDoc();
    expect(a.docText.value).toBe("");
    a.setText("signal test");
    expect(a.docText.value).toBe("signal test");
    expect(a.text).toBe("signal test");
  });

  it("does not re-broadcast updates applied from a remote origin (no echo loop)", () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    const fromA: Uint8Array[] = [];
    a.onUpdate((u) => {
      fromA.push(u);
      b.applyRemote(u);
    });

    let bEchoes = 0;
    b.onUpdate(() => {
      bEchoes++;
    });

    a.setText("no echo please");

    expect(b.text).toBe("no echo please");
    // Applying A's update on B must not trigger B's local-update callback.
    expect(bEchoes).toBe(0);
  });

  it("transmits updates as binary Uint8Array", () => {
    const a = new CollabDoc();
    let captured: unknown = null;
    a.onUpdate((u) => {
      captured = u;
    });
    a.setText("binary");
    expect(captured).toBeInstanceOf(Uint8Array);
  });
});

describe("CollabDoc concurrent same-region edits", () => {
  it("merges concurrent inserts at the same index without losing characters", () => {
    const a = new CollabDoc();
    const b = new CollabDoc();

    // Seed both with identical base text.
    const seed: Uint8Array[] = [];
    a.onUpdate((u) => seed.push(u));
    a.setText("abc");
    for (const u of seed) b.applyRemote(u);
    expect(b.text).toBe("abc");

    // Now both edit the same region concurrently, before exchanging.
    const fromA: Uint8Array[] = [];
    const fromB: Uint8Array[] = [];
    a.onUpdate((u) => fromA.push(u));
    b.onUpdate((u) => fromB.push(u));

    a.setText("aXbc"); // A inserts X at index 1
    b.setText("aYbc"); // B inserts Y at index 1 concurrently

    // Exchange updates both directions.
    for (const u of fromA) b.applyRemote(u);
    for (const u of fromB) a.applyRemote(u);

    // Both converge and neither character is lost.
    expect(a.text).toBe(b.text);
    expect(a.text).toContain("X");
    expect(a.text).toContain("Y");
    expect(a.text.length).toBe(5); // aXYbc or aYXbc
  });
});
