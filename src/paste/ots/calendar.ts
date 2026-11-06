/**
 * OpenTimestamps calendar client (REQ-PASTE-081, 083, 090, 091).
 *
 * Stamping: root = SHA-256(file digest ‖ 16-byte nonce) is POSTed to every calendar
 * in parallel, so calendars never see the paste id. Requests are CORS-"simple"
 * (safelisted content type and Accept header only): calendars do not answer
 * preflights. Upgrading: GET {calendar}/timestamp/{commitment} for each pending
 * attestation whose calendar is on the allow-list; a calendar still pending answers
 * 404 without CORS headers, which `fetch` reports as a network error — both mean
 * "try later".
 */
import { MAX_OTS_BYTES, newOtsFile, serializeOtsFile, type OtsFile } from "./file";
import { addOp, allAttestations, cloneTimestamp, mergeTimestamp, parseTimestamp } from "./timestamp";
import { OtsError } from "./varint";

export const DEFAULT_OTS_CALENDARS: readonly string[] = [
  "https://a.pool.opentimestamps.org",
  "https://b.pool.opentimestamps.org",
  "https://finney.calendar.eternitywall.com",
];
/**
 * Exact hosts that may be contacted on Upgrade and named in shared proofs: the calendars
 * behind the default aggregators (whose pending attestations name alice/bob) and the
 * Eternity Wall calendar. No suffix matching: a proof could otherwise name any
 * subdomain of an operator's domain.
 */
export const ALLOWED_CALENDAR_HOSTS: ReadonlySet<string> = new Set([
  "alice.btc.calendar.opentimestamps.org",
  "bob.btc.calendar.opentimestamps.org",
  "finney.calendar.eternitywall.com",
  "a.pool.opentimestamps.org",
  "b.pool.opentimestamps.org",
]);
export const CALENDAR_TIMEOUT_MS = 10_000;
export const MAX_CALENDAR_RESPONSE = 10 * 1024;
const ACCEPT = "application/vnd.opentimestamps.v1";

export interface CalendarOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** https, no credentials or port, root path, host in `ALLOWED_CALENDAR_HOSTS`. */
export function isAllowedCalendar(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
  if (url.pathname !== "/" && url.pathname !== "") return false;
  if (uri.replace(/\/$/, "") !== `https://${url.hostname}`) return false;
  return ALLOWED_CALENDAR_HOSTS.has(url.hostname);
}

async function readLimited(response: Response, max: number): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (length > max) throw new OtsError("Calendar answer too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > max) throw new OtsError("Calendar answer too large");
  return bytes;
}

async function request(url: string, init: RequestInit, opts: CalendarOptions): Promise<Uint8Array> {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CALENDAR_TIMEOUT_MS);
  try {
    const response = await doFetch(url, {
      ...init,
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status !== 200) throw new OtsError(`Calendar answered ${response.status}`);
    return await readLimited(response, MAX_CALENDAR_RESPONSE);
  } finally {
    clearTimeout(timer);
  }
}

export interface StampResult {
  file: OtsFile;
  succeeded: string[];
  failed: string[];
}

/** Timestamps `digest` (the paste id). Throws when no calendar answers. */
export async function stampDigest(digest: Uint8Array, opts: CalendarOptions & { calendars?: readonly string[]; nonce?: Uint8Array } = {}): Promise<StampResult> {
  const nonce = opts.nonce ?? crypto.getRandomValues(new Uint8Array(16));
  const file = newOtsFile(digest);
  const root = await addOp(await addOp(file.timestamp, { kind: "append", arg: nonce }), { kind: "sha256" });
  const calendars = opts.calendars ?? DEFAULT_OTS_CALENDARS;
  const answers = await Promise.all(
    calendars.map(async (calendar) => {
      try {
        const body = await request(
          `${calendar.replace(/\/$/, "")}/digest`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: ACCEPT },
            body: root.msg as Uint8Array<ArrayBuffer>,
          },
          opts,
        );
        const stamp = await parseTimestamp(body, root.msg!);
        if (!allAttestations(stamp).length) throw new OtsError("Calendar answer without attestation");
        return { calendar, stamp };
      } catch {
        return { calendar, stamp: null };
      }
    }),
  );
  const succeeded: string[] = [];
  const failed: string[] = [];
  for (const { calendar, stamp } of answers) {
    if (stamp) {
      mergeTimestamp(root, stamp);
      succeeded.push(calendar);
    } else failed.push(calendar);
  }
  if (!succeeded.length) throw new OtsError("No calendar answered");
  return { file, succeeded, failed };
}

export interface UpgradeResult {
  file: OtsFile;
  changed: boolean;
  /** Calendars that supplied a completed path. */
  upgraded: string[];
  /** Allow-listed calendars still pending (or unreachable). */
  pending: string[];
  /** Calendars named by the proof but not on the allow-list: never contacted. */
  skipped: string[];
}

export async function upgradeProof(file: OtsFile, opts: CalendarOptions = {}): Promise<UpgradeResult> {
  const before = serializeOtsFile(file);
  const timestamp = cloneTimestamp(file.timestamp);
  const work = allAttestations(timestamp).flatMap((a) => (a.attestation.kind === "pending" && a.msg ? [{ uri: a.attestation.uri, node: a.node, msg: a.msg }] : []));
  const upgraded: string[] = [];
  const pending: string[] = [];
  const skipped: string[] = [];
  await Promise.all(
    work.map(async ({ uri, node, msg }) => {
      if (!isAllowedCalendar(uri)) {
        skipped.push(uri);
        return;
      }
      try {
        const hex = [...msg].map((b) => b.toString(16).padStart(2, "0")).join("");
        const body = await request(`${uri.replace(/\/$/, "")}/timestamp/${hex}`, { method: "GET", headers: { Accept: ACCEPT } }, opts);
        const stamp = await parseTimestamp(body, msg);
        if (!allAttestations(stamp).some((a) => a.attestation.kind === "bitcoin")) throw new OtsError("Not complete yet");
        mergeTimestamp(node, stamp);
        // the calendar supplied a Bitcoin path: drop its own pending attestation (as `ots prune`)
        node.attestations = node.attestations.filter((a) => !(a.kind === "pending" && a.uri === uri));
        upgraded.push(uri);
      } catch {
        pending.push(uri);
      }
    }),
  );
  let result: OtsFile = { digest: file.digest, timestamp };
  let after = serializeOtsFile(result);
  if (after.length > MAX_OTS_BYTES) {
    result = file;
    after = before;
  }
  const changed = after.length !== before.length || after.some((v, i) => v !== before[i]);
  return { file: result, changed, upgraded: changed ? upgraded : [], pending, skipped: [...new Set(skipped)] };
}
