import { describe, expect, it } from "bun:test";
import { DEFAULT_OTS_CALENDARS, MAX_CALENDAR_RESPONSE, isAllowedCalendar, stampDigest, upgradeProof } from "@/paste/ots/calendar";
import { parseOtsFile, proofSummary, serializeOtsFile } from "@/paste/ots/file";
import { FX, fixture, hex, unhex } from "./fixtures";

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource));
const ALICE = "https://alice.btc.calendar.opentimestamps.org";
const FINNEY = "https://finney.calendar.eternitywall.com";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  }) as typeof fetch;
  return { fn, calls };
}

const ok = (bytes: Uint8Array) => new Response(bytes as BodyInit, { status: 200 });

describe("REQ-PASTE-081 stamping", () => {
  it("submits only the blinded 32-byte digest, as a CORS-simple request", async () => {
    const id = await sha256(new TextEncoder().encode("statement"));
    const nonce = new Uint8Array(16).fill(7);
    const { fn, calls } = fakeFetch(() => Promise.reject(new TypeError("offline")));
    await expect(stampDigest(id, { fetch: fn, nonce, calendars: [ALICE] })).rejects.toThrow();
    expect(calls.length).toBe(1);
    const { url, init } = calls[0];
    expect(url).toBe(`${ALICE}/digest`);
    expect(init.method).toBe("POST");
    const body = init.body as Uint8Array;
    expect(body.length).toBe(32);
    expect(hex(body)).not.toBe(hex(id));
    expect(hex(body)).toBe(hex(await sha256(new Uint8Array([...id, ...nonce]))));
    const headers = new Headers(init.headers);
    expect([...headers.keys()].sort()).toEqual(["accept", "content-type"]);
    expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(headers.get("accept")).toBe("application/vnd.opentimestamps.v1");
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("builds the same proof as the reference library for a fixed nonce", async () => {
    const statement = unhex(FX.stampStatementHex);
    const id = await sha256(statement);
    const responses: Record<string, Uint8Array> = { [`${ALICE}/digest`]: fixture("stamp-response-0.bin"), [`${FINNEY}/digest`]: fixture("stamp-response-1.bin") };
    const { fn, calls } = fakeFetch((url, init) => {
      expect(hex(init.body as Uint8Array)).toBe(FX.stampRootHex);
      return ok(responses[url]);
    });
    const result = await stampDigest(id, { fetch: fn, nonce: unhex(FX.stampNonceHex), calendars: [ALICE, FINNEY] });
    expect(calls.length).toBe(2);
    expect(result.succeeded.sort()).toEqual([ALICE, FINNEY]);
    expect(hex(serializeOtsFile(result.file))).toBe(hex(fixture("stamp-golden.ots")));
  });

  it("REQ-PASTE-083 keeps a proof held by a single calendar and fails when none answers", async () => {
    const id = await sha256(unhex(FX.stampStatementHex));
    const one = fakeFetch((url) => (url.startsWith(ALICE) ? ok(fixture("stamp-response-0.bin")) : new Response("no", { status: 500 })));
    const single = await stampDigest(id, { fetch: one.fn, nonce: unhex(FX.stampNonceHex), calendars: [ALICE, FINNEY] });
    expect(single.succeeded).toEqual([ALICE]);
    expect(single.failed).toEqual([FINNEY]);
    expect(proofSummary(single.file).calendars).toEqual([ALICE]);

    const none = fakeFetch(() => new Response("no", { status: 503 }));
    await expect(stampDigest(id, { fetch: none.fn, calendars: [ALICE, FINNEY] })).rejects.toThrow(/calendar/i);
  });

  it("gives up after the timeout", async () => {
    const id = new Uint8Array(32);
    const hang = fakeFetch(
      (_url, init) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const started = Date.now();
    await expect(stampDigest(id, { fetch: hang.fn, calendars: [ALICE], timeoutMs: 50 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("rejects oversize and malformed answers", async () => {
    const id = await sha256(unhex(FX.stampStatementHex));
    const big = fakeFetch(() => ok(new Uint8Array(MAX_CALENDAR_RESPONSE + 1)));
    await expect(stampDigest(id, { fetch: big.fn, calendars: [ALICE] })).rejects.toThrow();
    const junk = fakeFetch(() => ok(new Uint8Array([0x42])));
    await expect(stampDigest(id, { fetch: junk.fn, calendars: [ALICE] })).rejects.toThrow();
  });

  it("uses the default calendars, all on the allow-list", () => {
    expect(DEFAULT_OTS_CALENDARS).toEqual(["https://a.pool.opentimestamps.org", "https://b.pool.opentimestamps.org", FINNEY]);
    for (const c of DEFAULT_OTS_CALENDARS) expect(isAllowedCalendar(c)).toBe(true);
  });
});

describe("REQ-PASTE-090 / REQ-PASTE-091 upgrading", () => {
  it("grafts the calendar's Bitcoin branch and drops that pending attestation", async () => {
    const file = await parseOtsFile(fixture("pending.txt.ots"));
    const target = `${FX.upgradeUri}/timestamp/${FX.upgradeCommitmentHex}`;
    const { fn, calls } = fakeFetch((url, init) => {
      expect(init.method ?? "GET").toBe("GET");
      if (url === target) return ok(fixture("upgrade.bin"));
      // a pending calendar answers 404 without CORS headers: fetch rejects
      return Promise.reject(new TypeError("Failed to fetch"));
    });
    const result = await upgradeProof(file, { fetch: fn });
    expect(result.changed).toBe(true);
    expect(result.upgraded).toEqual([FX.upgradeUri]);
    expect(hex(serializeOtsFile(result.file))).toBe(FX.completePrunedHex);
    expect(proofSummary(result.file).status).toBe("bitcoin");
    // the other allow-listed calendars stay pending
    expect(result.pending.sort()).toEqual([ALICE, FINNEY]);
    // a calendar outside the allow-list is shown but never contacted
    expect(result.skipped).toEqual(["https://btc.calendar.catallaxy.com"]);
    expect(calls.some((c) => c.url.includes("catallaxy"))).toBe(false);
    expect(calls.length).toBe(3);
  });

  it("leaves the proof unchanged when nothing is ready", async () => {
    const bytes = fixture("pending.txt.ots");
    const { fn } = fakeFetch(() => new Response("Pending confirmation in Bitcoin blockchain", { status: 404 }));
    const result = await upgradeProof(await parseOtsFile(bytes), { fetch: fn });
    expect(result.changed).toBe(false);
    expect(hex(serializeOtsFile(result.file))).toBe(hex(bytes));
  });

  it("only allows the exact https hosts of the calendars in use", () => {
    for (const host of ["alice.btc.calendar.opentimestamps.org", "bob.btc.calendar.opentimestamps.org", "finney.calendar.eternitywall.com", "a.pool.opentimestamps.org", "b.pool.opentimestamps.org"]) {
      expect(isAllowedCalendar(`https://${host}`)).toBe(true);
      expect(isAllowedCalendar(`https://${host}/`)).toBe(true);
    }
    for (const bad of [
      "https://x0.calendar.opentimestamps.org",
      "https://x.btc.calendar.opentimestamps.org",
      "https://evil.pool.opentimestamps.org",
      "https://x.calendar.eternitywall.com",
      "http://alice.btc.calendar.opentimestamps.org",
      "https://evil.example",
      "https://calendar.opentimestamps.org.evil.example",
      "https://alice.btc.calendar.opentimestamps.org:8443",
      "https://user@alice.btc.calendar.opentimestamps.org",
      "https://alice.btc.calendar.opentimestamps.org/x",
      "https://btc.calendar.catallaxy.com",
      "not a url",
    ]) {
      expect(isAllowedCalendar(bad)).toBe(false);
    }
  });
});
