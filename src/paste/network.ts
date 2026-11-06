/**
 * Joins a paste board through every configured signaling strategy at once and
 * exposes them as one `PasteRoom` (REQ-PASTE-005, 007, 062): app id
 * `qrshare-paste-v1`, room id and password derived from the room secret, relays and
 * ICE servers from the WebRTC settings. A peer is connected while at least one
 * strategy room has it; receivers are idempotent, so frames are sent on every room.
 */
import type { PasteRoom } from "./board";
import { PASTE_APP_ID, type RoomKeys } from "./keys";

/** The part of a trystero room used here. */
export interface StrategyRoom {
  makeAction(namespace: string): unknown[];
  onPeerJoin(fn: (peerId: string) => void): void;
  onPeerLeave(fn: (peerId: string) => void): void;
  getPeers(): Record<string, unknown>;
  leave(): Promise<void> | void;
}

type Sender = (data: ArrayBuffer, target?: string | string[] | null) => unknown;
type Receive = (fn: (data: ArrayBuffer, peerId: string) => void) => void;

export function multiplexRooms(rooms: StrategyRoom[]): { room: PasteRoom; leave: () => Promise<void> } {
  const counts = new Map<string, number>();
  const joins = new Set<(peerId: string) => void>();
  const leaves = new Set<(peerId: string) => void>();
  const actions = new Map<string, ReturnType<PasteRoom["makeAction"]>>();
  for (const r of rooms) {
    r.onPeerJoin((peer) => {
      const n = (counts.get(peer) ?? 0) + 1;
      counts.set(peer, n);
      if (n === 1) joins.forEach((fn) => fn(peer));
    });
    r.onPeerLeave((peer) => {
      const n = (counts.get(peer) ?? 0) - 1;
      if (n > 0) counts.set(peer, n);
      else {
        counts.delete(peer);
        leaves.forEach((fn) => fn(peer));
      }
    });
  }
  const room: PasteRoom = {
    makeAction(namespace) {
      const known = actions.get(namespace);
      if (known) return known;
      const pairs = rooms.map((r) => ({ r, action: r.makeAction(namespace) as [Sender, Receive] }));
      const send = (data: ArrayBuffer, target?: string | null) =>
        Promise.all(
          pairs.map(({ r, action: [s] }) => {
            if (target && !(target in r.getPeers())) return undefined;
            return Promise.resolve(s(data, target ?? null)).catch(() => undefined);
          }),
        );
      const receive = (fn: (data: ArrayBuffer, peerId: string) => void) => pairs.forEach(({ action: [, r] }) => r(fn));
      const action: ReturnType<PasteRoom["makeAction"]> = [send, receive];
      actions.set(namespace, action);
      return action;
    },
    onPeerJoin: (fn) => void joins.add(fn),
    onPeerLeave: (fn) => void leaves.add(fn),
  };
  return {
    room,
    leave: async () => {
      joins.clear();
      leaves.clear();
      await Promise.all(rooms.map(async (r) => {
        try {
          await r.leave();
        } catch {
          /* already gone */
        }
      }));
    },
  };
}

/** Joins every configured strategy (browser only: needs WebRTC). */
export async function joinPasteNetwork(keys: RoomKeys): Promise<{ room: PasteRoom; leave: () => Promise<void>; strategies: string[] }> {
  const [{ buildRoomConfig, ensureMqttDefaults }, { getAdapter }, { buildJoinConfig }] = await Promise.all([
    import("@/webrtc/settings"),
    import("@/webrtc/strategies"),
    import("@/webrtc/service"),
  ]);
  await ensureMqttDefaults();
  const config = { ...buildRoomConfig(), appId: PASTE_APP_ID };
  const rooms: StrategyRoom[] = [];
  const strategies: string[] = [];
  for (const name of config.strategies ?? (["nostr", "torrent", "mqtt"] as const)) {
    try {
      const adapter = await getAdapter(name);
      const join = { ...buildJoinConfig(config, adapter, keys.roomId), password: keys.password };
      rooms.push(adapter.joinRoom(join, keys.roomId) as unknown as StrategyRoom);
      strategies.push(name);
    } catch (err) {
      console.warn(`[paste] strategy ${name} failed to join:`, err);
    }
  }
  if (!rooms.length) throw new Error("No signaling strategy could be joined");
  return { ...multiplexRooms(rooms), strategies };
}
