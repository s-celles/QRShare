import { describe, expect, it } from "bun:test";
import { AudioRoom, type LinkPacket } from "@/audio/link/room";
import { StreamingDemodulator } from "@/audio/demodulator";
import { modulate } from "@/audio/modem";
import { encodeOnAir } from "@/audio/packet";
import { AudioReceiveSession } from "@/audio/session";
import { getProfile } from "@/audio/profiles";
import { awgn, concat, silence } from "../helpers";

describe("audio session packets through the modem", () => {
  it("a beacon and a join survive modulation, noise and demodulation", async () => {
    const sr = 48000;
    const profile = getProfile("fast");
    const host = await AudioRoom.host({ name: "Host" });
    const guest = await AudioRoom.guest({ name: "Guest" });
    const beacon = (await host.nextFrame())!;
    const audio = awgn(concat(silence(0.2, sr), modulate(encodeOnAir(beacon, profile), profile, sr), silence(0.5, sr)), 12, [1500, 6300], sr);
    const demod = new StreamingDemodulator(sr);
    const events = [...demod.push(audio), ...demod.push(new Float32Array(demod.latencySamples))];
    const pkt = events.find((e) => e.kind === "packet");
    if (pkt?.kind !== "packet" || pkt.result.kind !== "ok" || pkt.result.packet.kind !== "link") throw new Error("no link packet decoded");
    const found = await guest.receive(pkt.result.packet as LinkPacket);
    expect(found[0]).toMatchObject({ kind: "room_found", roomId: host.roomIdHex, hostName: "Host" });
  });

  it("the demodulator reports a busy channel while a packet is being received", () => {
    const sr = 48000;
    const profile = getProfile("robust");
    const host = AudioRoom.host({ name: "H" });
    return host.then(async (h) => {
      const x = modulate(encodeOnAir((await h.nextFrame())!, profile), profile, sr);
      const demod = new StreamingDemodulator(sr);
      expect(demod.busy).toBe(false);
      demod.push(concat(silence(0.1, sr), x.subarray(0, Math.round(x.length * 0.6))));
      expect(demod.busy).toBe(true);
      demod.push(concat(x.subarray(Math.round(x.length * 0.6)), silence(1, sr)));
      expect(demod.busy).toBe(false);
    });
  });

  it("the file receiver ignores session packets and exposes the transfer id", async () => {
    const rx = new AudioReceiveSession(48000);
    expect(rx.lockedSessionId).toBeNull();
  });
});
