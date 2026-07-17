import type { StrategyName } from "./strategies";

/**
 * Deterministic strategy agreement between two peers.
 *
 * In `parallel` mode both peers join every enabled strategy at once. Previously
 * each side independently adopted the first strategy whose `onPeerJoin` fired and
 * left the other rooms — with no negotiation. When two strategies completed within
 * the same short window the two peers could settle on *different* strategies, each
 * tearing down the room the other had kept, and both died with "Peer disconnected"
 * right after an apparently successful connection.
 *
 * The fix is not to wait longer, it is to make exactly one peer decide. Trystero's
 * `selfId` is a single module-level id shared across every strategy, so comparing
 * the two ids elects a leader with no round trip — the same idiom trystero itself
 * uses to break offer collisions. The leader adopts its own first-joined strategy
 * and announces it; the follower adopts whatever it is told.
 *
 * This module is pure: no timers, signals, rooms or `Date.now()`. The coordinator
 * (`StrategyAgreement`) owns all of those and merely applies the effects returned
 * here. See `.claude/specs/webrtc-reliability.md`.
 */

/**
 * The slice of a trystero `Room` the agreement layer needs. The concrete `Room`
 * satisfies this structurally; tests supply a lightweight mock. Mirrors the
 * `CollabRoom` precedent in `src/collab/session.ts`.
 */
export interface AgreementRoom {
  makeAction: <T extends string>(
    namespace: string,
  ) => [
    (data: T, ...rest: never[]) => unknown,
    (fn: (data: T, peerId: string) => void) => void,
    ...unknown[],
  ];
  onPeerJoin: (fn: (peerId: string) => void) => void;
  onPeerLeave: (fn: (peerId: string) => void) => void;
  leave: () => void;
}

/** Cancels a scheduled callback. */
export type CancelFn = () => void;
export type Schedule = (fn: () => void, ms: number) => CancelFn;

export type AgreementRole = "leader" | "follower";

export interface AgreementState {
  /** This peer's trystero `selfId`. */
  readonly selfId: string;
  /** Learned from the first `peer-join`; the remote peer id is the same on every strategy. */
  readonly remotePeerId: string | null;
  /** Strategies the remote peer joined, in observation order. */
  readonly joined: readonly StrategyName[];
  /** Strategies whose peer left before any agreement — no longer viable. */
  readonly dead: readonly StrategyName[];
  /** The agreed strategy, once decided. */
  readonly decided: StrategyName | null;
}

export type AgreementEvent =
  | { type: "peer-join"; strategy: StrategyName; peerId: string }
  | { type: "peer-leave"; strategy: StrategyName; peerId: string }
  | { type: "announcement"; strategy: StrategyName }
  | { type: "grace-elapsed" };

export type AgreementEffect =
  | { type: "announce"; strategy: StrategyName }
  | { type: "activate"; strategy: StrategyName };

/**
 * Elect the leader from the two peer ids alone — no round trip, and both sides
 * compute complementary answers from the same pair of strings.
 *
 * On the (practically impossible) identical-id tie both sides become followers and
 * resolve through the grace fallback rather than both claiming leadership.
 */
export function resolveAgreementRole(selfId: string, remotePeerId: string): AgreementRole {
  return selfId < remotePeerId ? "leader" : "follower";
}

export function initAgreementState(selfId: string): AgreementState {
  return { selfId, remotePeerId: null, joined: [], dead: [], decided: null };
}

/** The role, once the remote peer id is known. */
export function agreementRole(state: AgreementState): AgreementRole | null {
  return state.remotePeerId === null
    ? null
    : resolveAgreementRole(state.selfId, state.remotePeerId);
}

/** First joined strategy that has not since died. */
function firstLive(state: AgreementState): StrategyName | null {
  return state.joined.find((s) => !state.dead.includes(s)) ?? null;
}

const none = (state: AgreementState) => ({ state, effects: [] as AgreementEffect[] });

export function reduceAgreement(
  state: AgreementState,
  event: AgreementEvent,
): { state: AgreementState; effects: AgreementEffect[] } {
  switch (event.type) {
    case "peer-join": {
      const joined = state.joined.includes(event.strategy)
        ? state.joined
        : [...state.joined, event.strategy];
      // A strategy that comes back is viable again.
      const dead = state.dead.filter((s) => s !== event.strategy);
      const next: AgreementState = {
        ...state,
        remotePeerId: state.remotePeerId ?? event.peerId,
        joined,
        dead,
      };

      // Already agreed: later joins are just losing rooms awaiting teardown.
      if (next.decided !== null) return none(next);

      if (agreementRole(next) !== "leader") {
        // Follower: never adopt from our own ordering — wait to be told.
        return none(next);
      }

      // Leader: adopt our first-joined strategy, announce it, then activate.
      // The announcement travels on the room we keep, which is never torn down.
      return {
        state: { ...next, decided: event.strategy },
        effects: [
          { type: "announce", strategy: event.strategy },
          { type: "activate", strategy: event.strategy },
        ],
      };
    }

    case "announcement": {
      // Idempotent: a repeated or late announcement cannot re-decide.
      if (state.decided !== null) return none(state);
      return {
        state: { ...state, decided: event.strategy },
        effects: [{ type: "activate", strategy: event.strategy }],
      };
    }

    case "peer-leave": {
      // Post-agreement leaves are the service's business (`resolvePeerLeave`).
      if (state.decided !== null) return none(state);
      // Pre-agreement: the strategy is no longer viable. Never an error — this is
      // the expected shape of the leader tearing down the rooms it did not pick.
      const dead = state.dead.includes(event.strategy)
        ? state.dead
        : [...state.dead, event.strategy];
      return none({ ...state, dead });
    }

    case "grace-elapsed": {
      // The remote peer may be in `sequential` mode or an older build and will
      // never announce. Rather than stall until the connection timeout, fall back
      // to our own first *live* join. Safe: `onPeerJoin` requires both peers in
      // that room, and a sequential peer is only ever in one room at a time, so at
      // most one strategy can connect and there is nothing to disagree about.
      if (state.decided !== null) return none(state);
      const pick = firstLive(state);
      if (pick === null) return none(state);
      return {
        state: { ...state, decided: pick },
        effects: [{ type: "activate", strategy: pick }],
      };
    }
  }
}

/** How long a follower waits for the leader's announcement before falling back. */
export const DECISION_GRACE_MS = 1_000;

const defaultSchedule: Schedule = (fn, ms) => {
  const h = setTimeout(fn, ms);
  return () => clearTimeout(h);
};

export interface StrategyAgreementOptions {
  /** This peer's trystero `selfId`. */
  selfId: string;
  rooms: { strategy: StrategyName; room: AgreementRoom }[];
  /** Called exactly once, with the agreed strategy and the room to keep. */
  onActivate: (strategy: StrategyName, room: AgreementRoom, peerId: string) => void;
  /** Injectable for tests; defaults to setTimeout. */
  schedule?: Schedule;
  graceMs?: number;
}

/**
 * Drives `reduceAgreement` over a set of joined rooms: wires each room's peer
 * events into the reducer and applies the effects it returns (announce / activate).
 *
 * Rooms are never torn down before an agreement is reached — that teardown was the
 * source of the mutual-disconnect race.
 */
export class StrategyAgreement {
  /** Trystero caps action names at 12 bytes. */
  static readonly ACTION = "strat";

  private state: AgreementState;
  private readonly senders = new Map<StrategyName, (data: string) => unknown>();
  private readonly rooms: { strategy: StrategyName; room: AgreementRoom }[];
  private readonly onActivate: StrategyAgreementOptions["onActivate"];
  private readonly schedule: Schedule;
  private readonly graceMs: number;
  private cancelGrace: CancelFn | null = null;
  private remotePeerId = "";
  private tornDown = false;
  private destroyed = false;

  constructor(opts: StrategyAgreementOptions) {
    this.state = initAgreementState(opts.selfId);
    this.rooms = opts.rooms;
    this.onActivate = opts.onActivate;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.graceMs = opts.graceMs ?? DECISION_GRACE_MS;

    // Register the announcement action on EVERY room up front: trystero drops
    // messages whose action type was never registered, and a peer may join at any
    // moment (`node_modules/trystero/src/room.js:225-230`).
    for (const { strategy, room } of this.rooms) {
      const [send, receive] = room.makeAction<string>(StrategyAgreement.ACTION);
      this.senders.set(strategy, send as (data: string) => unknown);
      receive((data, peerId) => {
        if (this.remotePeerId === "") this.remotePeerId = peerId;
        this.dispatch({ type: "announcement", strategy: data as StrategyName });
      });
      room.onPeerJoin((peerId) => {
        if (this.remotePeerId === "") this.remotePeerId = peerId;
        this.armGrace();
        this.dispatch({ type: "peer-join", strategy, peerId });
      });
      room.onPeerLeave((peerId) => {
        this.dispatch({ type: "peer-leave", strategy, peerId });
      });
    }
  }

  /** Only a follower ever needs this; arming it for both is harmless and simpler. */
  private armGrace(): void {
    if (this.cancelGrace || this.state.decided !== null || this.destroyed) return;
    this.cancelGrace = this.schedule(() => {
      this.dispatch({ type: "grace-elapsed" });
    }, this.graceMs);
  }

  private dispatch(event: AgreementEvent): void {
    if (this.destroyed) return;
    const { state, effects } = reduceAgreement(this.state, event);
    this.state = state;
    for (const effect of effects) this.apply(effect);
  }

  private apply(effect: AgreementEffect): void {
    if (effect.type === "announce") {
      this.senders.get(effect.strategy)?.(effect.strategy);
      return;
    }
    // activate
    this.clearGrace();
    const entry = this.rooms.find((r) => r.strategy === effect.strategy);
    if (!entry) return;
    this.onActivate(effect.strategy, entry.room, this.state.remotePeerId ?? this.remotePeerId);
    this.leaveOthers(effect.strategy);
  }

  private leaveOthers(keep: StrategyName): void {
    if (this.tornDown) return;
    this.tornDown = true;
    for (const { strategy, room } of this.rooms) {
      if (strategy !== keep) room.leave();
    }
  }

  private clearGrace(): void {
    this.cancelGrace?.();
    this.cancelGrace = null;
  }

  /** The strategy agreed with the remote peer, if any. */
  get decided(): StrategyName | null {
    return this.state.decided;
  }

  get role(): AgreementRole | null {
    return agreementRole(this.state);
  }

  /** Stop the protocol; does not leave rooms (the caller owns them). */
  destroy(): void {
    this.destroyed = true;
    this.clearGrace();
  }
}
