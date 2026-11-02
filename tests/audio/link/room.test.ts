import { describe, expect, it } from "bun:test";
import { AudioRoom, TIMING, type RoomEvent, type LinkPacket } from "@/audio/link/room";
import { fingerprint, generateKeyPair } from "@/audio/link/crypto";
import { parseAudioPacket } from "@/audio/packet";
import { prng } from "../helpers";

/** A shared medium: every frame reaches every other node unless dropped. */
class Sim {
  t = 0;
  readonly nodes: AudioRoom[] = [];
  readonly events = new Map<AudioRoom, RoomEvent[]>();
  private readonly rand: () => number;
  constructor(seed = 1, public loss = 0, public drop: (from: AudioRoom, to: AudioRoom) => boolean = () => false) {
    this.rand = prng(seed);
  }
  opts(name: string) {
    return { name, now: () => this.t, random: prng(this.nodes.length + 100) };
  }
  add(room: AudioRoom): AudioRoom {
    this.nodes.push(room);
    this.events.set(room, []);
    return room;
  }
  ev(room: AudioRoom) {
    return this.events.get(room)!;
  }
  async step(): Promise<void> {
    for (const node of this.nodes) {
      this.ev(node).push(...node.tick());
      if (!node.hasDue()) continue;
      const frame = await node.nextFrame();
      if (!frame) continue;
      const parsed = parseAudioPacket(frame);
      if (parsed.kind !== "ok" || parsed.packet.kind !== "link") throw new Error("bad frame");
      for (const other of this.nodes) {
        if (other === node || this.rand() < this.loss || this.drop(node, other)) continue;
        this.ev(other).push(...(await other.receive(parsed.packet as LinkPacket)));
      }
    }
    this.t += 100;
  }
  async until(cond: () => boolean, maxMs = 120_000): Promise<boolean> {
    const end = this.t + maxMs;
    while (this.t < end) {
      if (cond()) return true;
      await this.step();
    }
    return cond();
  }
}

async function connect(sim: Sim, host: AudioRoom, guest: AudioRoom): Promise<void> {
  expect(await sim.until(() => sim.ev(guest).some((e) => e.kind === "room_found"))).toBe(true);
  const found = sim.ev(guest).find((e) => e.kind === "room_found");
  if (found?.kind !== "room_found") throw new Error();
  expect(found.roomId).toBe(host.roomIdHex!);
  guest.join(found.roomId);
  expect(await sim.until(() => guest.state === "member")).toBe(true);
}

const messages = (evs: RoomEvent[]) => evs.filter((e): e is Extract<RoomEvent, { kind: "message" }> => e.kind === "message");
const lastDelivery = (evs: RoomEvent[], rseq: number) =>
  [...evs].reverse().find((e): e is Extract<RoomEvent, { kind: "delivery" }> => e.kind === "delivery" && e.rseq === rseq);

describe("audio session: joining (REQ-ALS-001..004)", () => {
  it("a guest finds the room, joins it, and both show the same code and members", async () => {
    const sim = new Sim();
    const host = sim.add(await AudioRoom.host({ ...sim.opts("Swift Crimson Falcon"), profileIndex: 1 }));
    const guest = sim.add(await AudioRoom.guest(sim.opts("Calm Jade Otter")));
    await connect(sim, host, guest);
    expect(guest.profileIndex).toBe(1);
    expect(guest.verificationCode).toMatch(/^\d{4}$/);
    expect(guest.verificationCode).toBe(host.verificationCode);
    // Names propagate (the guest's through its first presence).
    expect(await sim.until(() => host.memberViews().some((m) => m.name === "Calm Jade Otter"))).toBe(true);
    expect(guest.memberViews().map((m) => m.name).sort()).toEqual(["Calm Jade Otter", "Swift Crimson Falcon"]);
    expect(guest.memberViews().find((m) => m.host)?.name).toBe("Swift Crimson Falcon");
    expect(await host.filePassword()).toBe(await guest.filePassword());
  });

  it("joins despite 40% packet loss (join and welcome repeated)", async () => {
    const sim = new Sim(7, 0.4);
    const host = sim.add(await AudioRoom.host(sim.opts("Host")));
    const guest = sim.add(await AudioRoom.guest(sim.opts("Guest")));
    await connect(sim, host, guest);
    expect(guest.verificationCode).toBe(host.verificationCode);
  });

  it("refuses a welcome that lists another key for this device (REQ-ALS-005)", async () => {
    const sim = new Sim();
    const host = sim.add(await AudioRoom.host(sim.opts("Host")));
    const guest = sim.add(await AudioRoom.guest(sim.opts("Guest")));
    expect(await sim.until(() => sim.ev(guest).some((e) => e.kind === "room_found"))).toBe(true);
    guest.join(host.roomIdHex!);
    // Simulate a device in the middle: the host recorded another key for the guest's id.
    expect(await sim.until(() => (host as unknown as { members: Map<number, unknown> }).members.size === 2)).toBe(true);
    const intruder = await generateKeyPair();
    const entry = (host as unknown as { members: Map<number, { fp: Uint8Array }> }).members.get(guest.selfId)!;
    entry.fp = await fingerprint(intruder.publicRaw);
    expect(await sim.until(() => sim.ev(guest).some((e) => e.kind === "security_warning"), 30_000)).toBe(true);
    expect(guest.state).not.toBe("member");
  });

  it("ignores its own echo and other rooms (REQ-ALS-007)", async () => {
    const sim = new Sim();
    const host = sim.add(await AudioRoom.host(sim.opts("Host")));
    const other = sim.add(await AudioRoom.host(sim.opts("Other host")));
    const guest = sim.add(await AudioRoom.guest(sim.opts("Guest")));
    expect(await sim.until(() => sim.ev(guest).filter((e) => e.kind === "room_found").length === 2)).toBe(true);
    guest.join(host.roomIdHex!);
    expect(await sim.until(() => guest.state === "member")).toBe(true);
    // Own frame fed back: ignored.
    const frame = await guest.nextFrame();
    if (frame) {
      const p = parseAudioPacket(frame);
      if (p.kind === "ok" && p.packet.kind === "link") expect(await guest.receive(p.packet)).toEqual([]);
    }
    expect(other.memberViews().length).toBe(1);
    expect(host.memberViews().length).toBe(2);
  });
});

describe("audio session: chat (REQ-ALS-010..016)", () => {
  async function pair(loss = 0, seed = 3) {
    const sim = new Sim(seed, loss);
    const host = sim.add(await AudioRoom.host(sim.opts("Host")));
    const guest = sim.add(await AudioRoom.guest(sim.opts("Guest")));
    await connect(sim, host, guest);
    return { sim, host, guest };
  }

  it("delivers messages both ways, acknowledged", async () => {
    const { sim, host, guest } = await pair();
    const r1 = guest.sendChat("Bonjour 👋");
    const r2 = host.sendChat("Salut !");
    expect(await sim.until(() => lastDelivery(sim.ev(guest), r1)?.status === "delivered" && lastDelivery(sim.ev(host), r2)?.status === "delivered")).toBe(true);
    expect(messages(sim.ev(host)).map((m) => m.text)).toEqual(["Bonjour 👋"]);
    expect(messages(sim.ev(guest)).map((m) => m.text)).toEqual(["Salut !"]);
    expect(messages(sim.ev(host))[0].name).toBe("Guest");
    expect(lastDelivery(sim.ev(guest), r1)).toMatchObject({ receivedBy: 1, total: 1 });
  });

  it("delivers every message exactly once with 30% loss", async () => {
    const { sim, host, guest } = await pair(0.3, 11);
    const sent = ["un", "deux", "trois", "quatre", "cinq"];
    const ids = sent.map((t) => guest.sendChat(t));
    expect(await sim.until(() => ids.every((r) => lastDelivery(sim.ev(guest), r)?.status === "delivered"), 300_000)).toBe(true);
    expect(messages(sim.ev(host)).map((m) => m.text).sort()).toEqual([...sent].sort());
  });

  it("marks a message failed after the retries when nobody answers (REQ-ALS-014)", async () => {
    const { sim, host, guest } = await pair();
    sim.drop = (from) => from === guest || from === host;
    const r = host.sendChat("hello?");
    expect(await sim.until(() => lastDelivery(sim.ev(host), r)?.status === "failed", (TIMING.maxSends + 2) * (TIMING.retryMs + 2000))).toBe(true);
  });

  it("shows a silent member as away (REQ-ALS-016)", async () => {
    const { sim, host, guest } = await pair();
    sim.drop = (from) => from === guest;
    await sim.until(() => false, TIMING.awayMs + 5000);
    expect(host.memberViews().find((m) => m.id === guest.selfId)?.away).toBe(true);
  });

  it("reports a leave and file-done messages (REQ-ALS-017, 032)", async () => {
    const { sim, host, guest } = await pair();
    guest.sendFileDone(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(await sim.until(() => sim.ev(host).some((e) => e.kind === "file_done"))).toBe(true);
    expect(sim.ev(host).find((e) => e.kind === "file_done")).toMatchObject({ from: guest.selfId, transferId: "deadbeef" });
    guest.leave();
    expect(await sim.until(() => sim.ev(host).some((e) => e.kind === "left"))).toBe(true);
    expect(host.memberViews().length).toBe(1);
  });
});

describe("audio session: several members", () => {
  it("three members share one code and every message reaches everyone", async () => {
    const sim = new Sim(5, 0.1);
    const host = sim.add(await AudioRoom.host(sim.opts("Host")));
    const a = sim.add(await AudioRoom.guest(sim.opts("Alice")));
    const b = sim.add(await AudioRoom.guest(sim.opts("Bob")));
    await connect(sim, host, a);
    await connect(sim, host, b);
    // The host broadcasts the new list: everyone converges on 3 members and one code.
    expect(await sim.until(() => [host, a, b].every((r) => r.memberViews().length === 3) && a.verificationCode === host.verificationCode && b.verificationCode === host.verificationCode)).toBe(true);
    const r = a.sendChat("hello all");
    expect(await sim.until(() => lastDelivery(sim.ev(a), r)?.status === "delivered", 200_000)).toBe(true);
    expect(lastDelivery(sim.ev(a), r)).toMatchObject({ receivedBy: 2, total: 2 });
    expect(messages(sim.ev(host)).map((m) => m.text)).toEqual(["hello all"]);
    expect(messages(sim.ev(b)).map((m) => m.text)).toEqual(["hello all"]);
  });
});
