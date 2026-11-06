/**
 * Opening a paste-board session without leaking it (REQ-PASTE-007): joins can take
 * seconds, and the user may leave, unmount the view or click twice meanwhile. A
 * `JoinGate` lets one join run at a time and cancels it; `openBoardSession` checks
 * after every step and tears down anything created for a cancelled join.
 */
import { PasteBoard, type PasteRoom } from "./board";
import { secretToCode } from "./code";
import { createAuthor, deriveRoomKeys, type RoomKeys } from "./keys";
import { joinPasteNetwork } from "./network";

export class JoinGate {
  private current = 0;
  private running = false;

  /** A token for a new join, or null while another join is running. */
  begin(): number | null {
    if (this.running) return null;
    this.running = true;
    return ++this.current;
  }

  isCurrent(token: number): boolean {
    return this.running && token === this.current;
  }

  /** The join finished (successfully or not). */
  end(token: number): void {
    if (token === this.current) this.running = false;
  }

  /** Abandons the running join (leave, unmount). */
  cancel(): void {
    this.current++;
    this.running = false;
  }
}

export interface BoardSession {
  board: PasteBoard;
  code: string;
  /** Destroys the board and leaves every signaling room. */
  close: () => Promise<void>;
}

type Join = (keys: RoomKeys) => Promise<{ room: PasteRoom; leave: () => Promise<void> }>;

/** Null when the join was cancelled meanwhile (everything created is torn down). */
export async function openBoardSession(
  secret: Uint8Array,
  opts: { isCurrent: () => boolean; join?: Join; autoTick?: boolean },
): Promise<BoardSession | null> {
  const keys = await deriveRoomKeys(secret);
  const author = await createAuthor();
  if (!opts.isCurrent()) return null;
  const net = await (opts.join ?? joinPasteNetwork)(keys);
  if (!opts.isCurrent()) {
    await net.leave();
    return null;
  }
  const board = new PasteBoard(net.room, { keys, author: author.key, autoTick: opts.autoTick });
  return {
    board,
    code: secretToCode(secret),
    close: async () => {
      board.destroy();
      await net.leave();
    },
  };
}
