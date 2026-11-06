import { describe, expect, it } from "bun:test";
import { JoinGate, openBoardSession } from "@/paste/session";
import { PasteMockNet } from "./mock";

const SECRET = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

function fakeJoin() {
  const left: number[] = [];
  let n = 0;
  let release: () => void = () => {};
  let started: () => void = () => {};
  const startedP = new Promise<void>((r) => (started = r));
  const gate = new Promise<void>((r) => (release = r));
  const join = async () => {
    const id = ++n;
    started();
    await gate;
    return { room: new PasteMockNet().room(`r${id}`), leave: async () => void left.push(id), strategies: ["fake"] };
  };
  return { join, left, release: () => release(), started: startedP, calls: () => n };
}

describe("REQ-PASTE-007 join and leave without leaking a session", () => {
  it("lets only one join run at a time", () => {
    const gate = new JoinGate();
    const t1 = gate.begin();
    expect(t1).not.toBeNull();
    expect(gate.begin()).toBeNull(); // double click
    gate.end(t1!);
    expect(gate.begin()).not.toBeNull();
  });

  it("tears down a session whose join was cancelled while connecting", async () => {
    const gate = new JoinGate();
    const net = fakeJoin();
    const token = gate.begin()!;
    const pending = openBoardSession(SECRET, { join: net.join, isCurrent: () => gate.isCurrent(token), autoTick: false });
    await net.started; // signaling rooms are being joined
    gate.cancel(); // the user left or the view unmounted
    net.release();
    expect(await pending).toBeNull();
    expect(net.left).toEqual([1]);
  });

  it("does not join at all when cancelled before the network step", async () => {
    const gate = new JoinGate();
    const net = fakeJoin();
    const token = gate.begin()!;
    const pending = openBoardSession(SECRET, { join: net.join, isCurrent: () => gate.isCurrent(token), autoTick: false });
    gate.cancel();
    net.release();
    expect(await pending).toBeNull();
    expect(net.calls()).toBe(0);
  });

  it("returns a live session when still current", async () => {
    const gate = new JoinGate();
    const net = fakeJoin();
    const token = gate.begin()!;
    const pending = openBoardSession(SECRET, { join: net.join, isCurrent: () => gate.isCurrent(token), autoTick: false });
    net.release();
    const session = await pending;
    expect(session?.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(session?.board.pastes()).toEqual([]);
    await session!.close();
    expect(net.left).toEqual([1]);
  });
});
