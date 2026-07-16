# Live Collaborative Text Editing

QRShare can turn an established WebRTC connection into a **live, two-way
collaborative text editor**. After two peers connect and verify the confirmation
code, either peer can open a shared editor where local keystrokes propagate to the
remote peer and converge automatically — even when both people edit the same region
at the same time. Either peer can also save named versions and restore them.

## How it works

1. Connect over WebRTC as usual: the receiver mints a Room ID and shows it as a QR
   code; the sender scans it (or types the Room ID) and connects.
2. Both peers see the same 4-digit confirmation code (derived from the sorted peer
   IDs). Verify it matches — this is the human trust check.
3. Either peer presses **Start collaborative editing**. The other peer is signalled
   and joins the same shared document automatically.
4. Type. Every change is shared live; the character count updates continuously.

### Merge model (CRDT)

The shared document is a single [Yjs](https://docs.yjs.dev/) `Y.Doc` holding one
shared text type. Local edits are captured as binary Yjs update deltas and
broadcast over the existing trystero DataChannel through a dedicated `doc-update`
action; the remote peer applies them with `Y.applyUpdate`. Because Yjs is a CRDT,
peers converge to an identical document regardless of the order updates arrive, and
concurrent edits to the same region merge deterministically without losing anyone's
characters. No Yjs network provider (e.g. `y-webrtc`) is added — the CRDT rides the
DataChannel QRShare already establishes, which is DTLS-encrypted peer-to-peer.

### Late-join and reconnect

When a peer joins (or rejoins after a transient drop), a **state-vector handshake**
runs: the joining peer sends its Yjs state vector and each side replies with only
the update the other is missing (`Y.encodeStateAsUpdate(doc, remoteStateVector)`).
This brings a late or reconnected peer up to the current merged state, and the saved
version log is replayed as part of the resync.

### Named versions

Either peer can save the current document as a **named version**. Each entry is a
full document snapshot plus metadata:

```
{ id, label, snapshotBytes, siteId, lamport }
```

Versions are ordered by a per-peer logical **Lamport clock** with `siteId` as the
tie-breaker — never by wall-clock time, which is unreliable across two unsynchronized
devices. The version log is append-only and de-duplicated by `id`, so replays during
resync never double-count. Restoring a version replays its text as a normal edit that
both peers converge on; later versions are not deleted.

## Persistence across reload

The live document is persisted locally in **IndexedDB** (via the `y-indexeddb`
provider), keyed by Room ID, and the version log is stored alongside it. Reloading
the page restores the in-progress document and then resyncs with the peer, so a
refresh rejoins the same session instead of losing work. If IndexedDB is unavailable
in your browser, persistence degrades gracefully to a no-op and reloading loses the
current session.

## Snapshot export over QR (air-gapped)

Live two-way editing is **WebRTC-only** — the animated-QR channel is a one-way
optical medium and cannot carry realtime bidirectional edits. What the QR channel
*can* do is carry a **one-way snapshot**: each saved version has an **Export as QR**
action that sends the version's text through QRShare's existing QR text-sharing
pipeline. The editor states clearly that QR export is a snapshot, not a live channel.

## Security

- All collaborative traffic (document updates, version log, handshake) travels over
  the existing DTLS-encrypted trystero DataChannel. No new signaling secret or server
  is introduced.
- The 4-digit confirmation code remains the human trust check gating entry.
- Shared text is rendered as plain text (never interpreted as HTML), preventing
  injection through peer-supplied content.

## Notes and trade-offs

- **Bundle size:** Yjs (plus `y-indexeddb`) adds roughly 50–100 KB to the single
  `qrshare.html` payload. To keep the rest of the app lean, the Yjs-backed modules
  are **lazy-imported** and only evaluated when you open the `/collab` route.
- **Document size:** a soft limit of 100,000 characters is shown, consistent with
  one-shot text sharing. Because edits arrive concurrently from a peer, the limit is
  advisory — remote updates are never silently truncated (that would break
  convergence).
- **Peer leaves:** if your peer disconnects, your editor stays usable and your edits
  keep accumulating locally; when the peer returns, both sides resync and merge.
- **Scope:** v1 targets the two-peer case established by the QR handshake, and binds
  the `<textarea>` by diffing its value into the shared text on input. Full CRDT
  undo / time-travel and per-keystroke binding are out of scope for v1.
