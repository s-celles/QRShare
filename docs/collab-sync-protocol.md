# Offline sync protocol

The `offline` module of `@scelles/collab` lets several devices edit the same
document when at least one of them never connects to a network. The document
is a [Yjs](https://yjs.dev) CRDT: changes made independently always merge,
without a server to decide. Devices exchange short binary frames, through
animated QR codes shown by QRShare or any other channel (a file, a USB key).

Synchronization is asynchronous: it happens when two people meet, in a few
passes, and can be repeated or interrupted at any time.

## Frames

All integers are big-endian.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | Magic `QSYN` |
| 4 | 1 | Format version, `1` |
| 5 | 1 | Type (see below) |
| 6 | 1 | Flags: bit 0 compressed (raw deflate), bit 1 signed |
| 7 | 1 | Reserved, `0` |
| 8 | 16 | Document id (UUID) |
| 24 | 16 | Sender id: the first 16 bytes of the SHA-256 of its public key |
| 40 | 4 | Payload length *n* |
| 44 | *n* | Payload |
| 44 + *n* | 64 | Ed25519 signature of bytes 0 to 44 + *n*, when signed |

| Type | Value | Payload |
| --- | --- | --- |
| `HELLO` | 1 | Raw Ed25519 public key (32 bytes), then the device name in UTF-8 |
| `STATE_VECTOR` | 2 | Yjs state vector of the sender's copy |
| `UPDATE` | 3 | Yjs update: what the receiver lacks |
| `BLOB_REQUEST` | 4 | Reserved: SHA-256 digests of missing attachments |
| `BLOB` | 5 | Reserved: an attachment, after its SHA-256 digest |

A frame is checked in this order before anything is decompressed or parsed:
total size against the limit (4 MiB by default), magic, version, type,
flags, announced length against the limit and against the actual size. The
decompressed payload is limited too. Any failure rejects the whole frame
with an error code (`format`, `version`, `truncated`, `tooLarge`, `type`,
`signature`, `invalid`).

Frames are self-delimiting, so one transfer can carry several of them,
simply concatenated (`joinFrames`, `splitFrames`). `splitFrames` checks each
header and announced length, and the number of frames (8 by default),
before any frame is decoded.

## A complete sequence

Ana's laptop is offline; Bob's phone has the document too, with changes
made on the train. Both apps show and scan QR codes through QRShare.

1. **First meeting only: trust.** Each device shows a `HELLO` frame, signed
   by the key it carries; the other scans it, checks the signature and the
   sender id, and asks its user to trust "Ana" or "Bob". The public key is
   kept in the list of trusted peers.
2. **Ana pulls.** Ana's laptop shows a `STATE_VECTOR` frame (a few dozen
   bytes). Bob's phone scans it and shows an `UPDATE` frame with only the
   changes Ana lacks.
3. **Ana applies.** Ana's laptop scans the `UPDATE`, checks its signature
   against Bob's key, shows a summary (author, insertions, deletions,
   size) and, if Ana accepts, applies it to an isolated copy of the
   document, checks that copy, then applies it to the document.
4. **Bob pulls**, the same way in the other direction, if he wants Ana's
   changes.

With several frames per transfer, a full two-way sync takes three passes:
Ana shows `STATE_VECTOR`; Bob shows `UPDATE` (for Ana) and his own
`STATE_VECTOR`; Ana shows `UPDATE` (for Bob). A `HELLO` can travel in the
same transfers. A one-way pass is a single `UPDATE` computed against an
empty state vector: the whole document, which the receiver merges.

Every pass can be cancelled; nothing is applied until step 3 succeeds.
Replaying a pass changes nothing (Yjs updates are idempotent), and the
import is logged as `unchanged`.

## Import log

Each received frame is logged with its date, document, sender id and name,
trust, size and result: `applied`, `unchanged`, `refused` (by the user) or
`rejected` (with the reason).

## Threat model

Scanning a QR code is an input into a device that may otherwise be isolated
from any network. The protocol treats it as untrusted input.

**What is protected**

- The device against oversized or malformed input: sizes are checked before
  decoding, decoding errors reject the frame, and nothing received is
  executed or inserted as HTML by the module.
- The document against invalid updates: an update is applied to an isolated
  copy and validated by the app (for instance, against its document schema)
  before the document changes.
- Against impersonation of a known peer: once a peer is trusted, its frames
  must carry its valid signature, or they are rejected and logged.
- Against replay: applying an update twice has no effect.

**What is not protected**

- A trusted peer can send any change it is allowed to make, including
  deleting content. The version history of the app is the remedy, not the
  protocol.
- A frame from an unknown device is not authenticated: the app shows it as
  "unknown" and lets the user decide. The first `HELLO` exchange should be
  done in person.
- Confidentiality: frames are signed, not encrypted. Anyone who films the
  QR codes can read the changes. Encryption with a key shared through the
  `HELLO` exchange is possible future work.
- A lost device keeps its private key; remove it from the trusted peers of
  the other devices.
- Denial of service by a flood of frames: each frame is bounded, but the
  number of frames is not.
