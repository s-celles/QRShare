# How QRShare Works

QRShare moves text and files between devices without a server of its own. This
page gives an overview of the features, then walks through each transfer mode
step by step. For day-to-day use, see the [User Guide](en-user-guide.md).

## Features

- **QR Code Scanner** — Scan any QR code with your camera and view its decoded content. URLs are displayed as clickable links; Wi-Fi networks, contact cards, QRShare identities and passkey sign-in codes (`FIDO:/`) get a dedicated card. Scanned content can be shared, copied, or forwarded via QR/WebRTC. The camera area disappears after reception.
- **QR Code Creator** — Generate QR codes from arbitrary text with full control over QR version (1–40) and error correction level (L/M/Q/H). Live preview, real-time capacity display, PNG download, and one-tap sharing via Web Share API, QR transfer, or WebRTC.
- **Guided Transfer Preparation** — Select text or one or more files, choose a network policy, let QRShare recommend a transport, then show the receiver an invitation QR code before sending the payload.
- **App Handoff** — Other web apps, such as [Progressive Web Office](https://github.com/s-celles/progressive-web-office), hand files to QRShare and get received files back, without a network (see *Exchanging Files with Other Web Apps* in the [User Guide](en-user-guide.md)).
- **Native Share** — Send one or more files via the native share dialog (Web Share API). Works with any app that supports receiving shared files (messaging apps, email, cloud storage, etc.).
- **QR Code Transfer** — Send files between devices using animated QR codes. No internet connection required — works completely air-gapped.
- **CIMBAR Transfer (Experimental)** — High-speed air-gapped color-barcode transfer using libcimbar WASM. The browser decoder is beta, so standard animated QR remains the compatibility fallback.
- **Audio Transfer (Experimental)** — Air-gapped transfer of short texts and small files (up to 8 KB, best under 1 KB) as sound, from loudspeaker to microphone, with no network, camera or line of sight. Three profiles: Robust (about 22 B/s), Fast (about 53 B/s) and Ultrasonic (under Advanced, less reliable).
- **WebRTC Transfer** — Direct peer-to-peer file transfer over WebRTC DataChannel with a 4-digit confirmation code for security verification. See [Connectivity and TURN](en-connectivity-and-turn.md) when a direct connection fails.
- **Paste Board (Experimental)** — An anonymous, ephemeral room where participants share signed texts, Markdown, images and files over WebRTC, end-to-end encrypted, with optional OpenTimestamps proofs of existence and a Markdown/ZIP export. See *Paste Board* below and the [User Guide](en-user-guide.md).
- **Live Collaborative Editing** — Turn a WebRTC connection into a shared text editor with named versions. See [Collaborative Editing](en-collaborative-editing.md).
- **Fountain Codes** — Rateless erasure coding (Wirehair WASM with pure-JS LT fallback) ensures reliable transfer even with missed frames.
- **End-to-End Encryption** — Optional password protection (AES-256-GCM, PBKDF2-SHA256) of QR codes, animated QR streams and WebRTC transfers.
- **SHA-256 Verification** — End-to-end integrity verification of transferred files.
- **Internationalization** — English, French and Arabic interface with auto-detection from the browser language and manual selection in Settings.
- **In-App Documentation** — This documentation, readable inside the app (book icon in the header), with Mermaid diagrams.
- **Progressive Web App** — Install on any device, works offline after first load, and offers to reload when a new version is available.
- **Web Share Integration** — Share received files, created QR codes, and scanned content directly to other apps using the Web Share API.
- **Dark/Light Theme** — Automatic theme detection with manual override.
- **Single-File Packaging** — Package the main script, styles and icon into one HTML file (`qrshare.html`). The Web Workers and WebAssembly runtimes stay separate files, so the page must be served next to the files of `dist/` for QR and CIMBAR transfers. Audio transfer needs no separate file: its code runs in the main script and its capture worklet comes from an inline Blob URL.

## QR Utilities

- **Scan QR Code** — Point your camera at any QR code to decode it. The app detects URLs and displays them as clickable links; other content is shown as text with a copy-to-clipboard button. Once content is received, scanning stops and the camera area disappears.
- **Create QR Code** — Type or paste text into the editor to generate a QR code in real time. Adjust QR version and error correction level directly. A capacity meter shows payload size versus maximum. Download the result as a PNG.

## Share Mode (Native)

1. Select one or more files (drop or browse)
2. The native share dialog opens, letting you send files to any compatible app (messaging, email, cloud storage)
3. No setup required — uses the browser's built-in Web Share API

## Prepare a Transfer

1. The sender selects text or one or more files. Multiple files are bundled into a QRShare ZIP archive for transport.
2. Choose a policy: **Air-gapped only** excludes WebRTC, **Prefer air-gapped** recommends an optical mode while keeping network modes available, and **Any mode** may recommend WebRTC.
3. QRShare recommends a mode from the payload type, size, and policy. The sender may choose another mode that complies with the policy.
4. The sender first shows the invitation QR code to the receiver. It contains only a link that opens QRShare on the matching receive screen; it does not contain the file itself.
5. Once the receiver is ready, the sender starts the actual transfer.

Text can also enter the chooser through `#/send?data=...&policy=...`, where `policy` is `airgap`, `prefer-airgap`, or `any`. Because URLs have practical length limits, this route is intended for text; files remain local and are selected in **Prepare a transfer**.

## QR Code Mode (Air-Gapped)

1. The **sender** selects a file and encoding preset (High Speed / Balanced / High Reliability)
2. The file is compressed, split into blocks, and encoded using fountain codes
3. Encoded blocks are serialized into a binary frame protocol and rendered as animated QR codes
4. The **receiver** scans the QR animation with their camera
5. Fountain codes allow reconstruction even if some frames are missed
6. File integrity is verified via SHA-256 hash

### Encoding Presets

| Preset | QR Version | ECC Level | Max Payload | Default FPS |
|--------|-----------|-----------|-------------|-------------|
| High Speed | 25 | L | 1,273 bytes | 10 |
| Balanced | 20 | M | 666 bytes | 10 |
| High Reliability | 15 | Q | 292 bytes | 10 |

## WebRTC Mode (P2P)

1. The **receiver** creates a room and displays its 6-character Room ID as a QR code
2. The **sender** scans or enters the Room ID to join the room and establish a WebRTC connection
3. Both devices display a 4-digit confirmation code to verify the connection
4. The file is transferred over a WebRTC DataChannel with automatic chunking
5. SHA-256 verification confirms file integrity

## CIMBAR Mode (Experimental, Air-Gapped)

1. The sender selects a file or prepares one in QRShare
2. libcimbar compresses and fountain-encodes it into animated color barcodes
3. The receiver scans the animation with the beta browser decoder
4. Once reconstruction completes, the camera area disappears. Files can be downloaded or shared; received QRShare text gets the same copy, download, and share actions as other receivers.

The bundled runtime is libcimbar v0.6.7c under MPL-2.0. Files are limited to
approximately 33 MB after compression by the upstream protocol.

## Audio Mode (Experimental, Air-Gapped)

1. The sender selects a short text or a small file (up to 8 KB), optionally encrypted with a password
2. The content is hashed (SHA-256), compressed and fountain-encoded (Wirehair by default, LT for compatibility)
3. Each fountain symbol becomes one packet: a chirp preamble, a Reed-Solomon protected header, and a body protected by Reed-Solomon and CRC32, sent as multi-tone FSK through the loudspeaker; a metadata packet (the v3 frame header) is repeated every 8 data packets
4. The receiver listens with the microphone, detects the profile from the preamble, rejects damaged packets and rebuilds the content once it has enough symbols, then verifies the SHA-256

With a password the transfer is **sealed**: the metadata packet (file name,
real size, SHA-256, text flag, fountain parameters) is encrypted with
AES-256-GCM and authenticated together with the session id and the salt, the
fountain code carries the encrypted payload padded to 256-byte steps, and the
session id is random. The receiver detects a wrong password from the first
metadata packet and buffers data packets while the password is typed.

The modem is pure TypeScript with no dependency, and works at any sample rate
from 22.05 to 96 kHz. See the user guide for profiles, speeds and tips.

## Audio Sessions (Experimental, Air-Gapped)

1. The host announces a room with beacons (room id, public key, profile, name); a guest answers with a join request carrying its own P-256 public key
2. The host derives a pairwise key (ECDH + HKDF) and sends the group key and member list encrypted with it; every member shows a 4-digit code computed from the group key, the host key and the member list
3. Every session packet is then encrypted with AES-256-GCM under the group key, the clear header (room, sender, kind, counter) as associated data
4. Messages carry per-sender sequence numbers; presence packets acknowledge, for every member, the highest contiguous number received; unacknowledged messages are resent
5. A device transmits only after silence plus a random back-off; files travel as sealed transfers whose password derives from the group key

## Paste Board (Experimental, Network)

An anonymous, ephemeral room of signed pastes (text or Markdown, with images and
files), carried over WebRTC like the other network modes but with its own
end-to-end encryption and no storage anywhere.

**Keys.** Creating a board draws an 80-bit secret, shown as a 16-character
Crockford base32 code and in the link `#/paste?k=<code>`. HKDF-SHA256 (salt
`qrshare-paste-v1`) derives from it, under distinct labels, the trystero room id
(`room`), the trystero password that encrypts the SDP exchange (`signal`), the
AES-256-GCM content key (`content`) and a 16-byte room tag (`tag`). The secret
itself never leaves the device; relays only see a hash of the derived room id.
The board joins every configured signaling strategy at once with the app id
`qrshare-paste-v1`.

**Authors.** Each participant signs with an Ed25519 key generated for this board
only, kept in memory and never stored; it is unrelated to the device identity,
the contacts and local discovery. The displayed pseudonym and colour derive from
the SHA-256 of the public key, so names cannot be chosen or spoofed.

**Statement.** A paste is a binary statement — `QPST`, version, room tag, author
key, declared time (ms), format, the source in UTF-8 with LF line endings, then
for each attachment its SHA-256, size, declared type, sanitised name and image
size — signed with Ed25519. The paste id is the SHA-256 of the statement (the
signature excluded). Receivers check the encoding, the room tag and the
signature, and drop anything else.

**Frames and synchronisation.** Every frame is `[version][type][nonce 12][AES-256-GCM]`
with the 2-byte header as associated data. Control frames (`paste` action, at
most 64 KiB) exchange id inventories (`INV`/`WANT`), pastes (`ITEM`), proofs
(`PROOF`) and a digest of the held ids every 20 s (`DIGEST`), so peers that are
not directly connected still converge. Attachments travel on a separate action
(`pblob`), fetched by hash from the peer that sent the paste and then from other
holders, and accepted only when their SHA-256 and size match the signed list.
Size limits, duplicate frames (same nonce, e.g. through several strategies) and
per-peer budgets — frame count for control frames, bytes for pastes, proofs and
attachments — are checked before decryption; peers sending 5 invalid frames are
ignored. A peer asks for at most as many pastes as the board has free places, each
connected peer getting an equal share of them; a request left unanswered for 15 s
goes to another peer that advertised the paste (a slow or busy peer is not
penalised). Each requested id is answered once (not again within 15 s) within an
outbound byte budget. Attachment bytes count against the
board's 32 MiB only when they arrive, so pastes declaring attachments that are never
sent cannot fill the board. Residual risk: anyone holding the room code can create
keys at will, so the per-author caps do not stop a participant from filling the
500-paste board; the board then refuses new pastes but keeps the existing ones.

**Rendering.** Markdown is rendered by a dedicated renderer: raw HTML becomes
text, headings carry no id, code is never handed to Mermaid, only `http`, `https`
and `mailto` links stay clickable (new tab, no referrer), remote images become
link chips, and `attachment:<sha256>` references are resolved locally. The
output is then checked against an element and attribute allow-list; if the check
fails, the source is shown instead. How an attachment is shown depends only on
its magic bytes: raster images inline from a `blob:` URL, audio and video on
click, everything else as a download (`application/octet-stream`), because a
`blob:` URL shares the application's origin. An image is shown inline only when the
size read from its header is at most 2048 × 2048 pixels and equals the signed size,
and, for a GIF, its first frame lies within the logical screen (no decompression
bombs).

**Images.** On the author's device, images are decoded with their orientation,
downscaled to 2048 px at most, re-encoded through a canvas (WebP, else PNG or
JPEG), and scrubbed of any remaining JPEG APP/COM segment, PNG ancillary chunk
(other than `tRNS`, `gAMA`, `sRGB`) or WebP `EXIF`/`XMP `/`ICCP` chunk.

**Export.** The Markdown export lists pastes by declared time with a generated
header per paste; Markdown pastes are block quotes with raw HTML escaped, plain
text sits in a fence longer than any backtick run, so a paste cannot alter the
document's structure. The ZIP adds the attachments and, per paste, its
statement, signature and proof; each attachment is stored once, under the first
name it appears with. Exports are deterministic and never contain the room code or
keys; the statements in the ZIP do contain the one-way room tag, which links the
pastes of the same board.

**OpenTimestamps.** QRShare includes a small OpenTimestamps client (SHA-256,
append and prepend operations; pending and Bitcoin attestations), tested against
proofs produced by the reference client. To stamp a paste, it computes
`SHA-256(paste id ‖ random 16-byte nonce)` and POSTs only that digest to the
calendars `a.pool.opentimestamps.org`, `b.pool.opentimestamps.org` and
`finney.calendar.eternitywall.com` (CORS-simple requests, 10 s timeout). The
proof is a standard detached `.ots` file of `paste-<id>.statement`, so
`ots verify paste-<id>.statement.ots` works on it. Upgrading asks each pending
calendar on the allow-list — the exact hosts `alice.btc.calendar.opentimestamps.org`,
`bob.btc.calendar.opentimestamps.org`, `finney.calendar.eternitywall.com`,
`a.pool.opentimestamps.org` and `b.pool.opentimestamps.org` — for the completed
path; calendars named in a proof but outside the list are never contacted. Once a
calendar's path reaches a Bitcoin attestation, that calendar's pending attestation is
dropped (as `ots prune` does).

**Who shares proofs.** Only a paste's author shares a proof with the board. The
author's device merges each new proof with the one already shared and signs the
result with the author's session key — the key that signed the statement — over
`"qrshare-paste-proof-v1" ‖ room tag ‖ paste id ‖ SHA-256(.ots)`. Peers accept a
PROOF frame only with a valid signature of the paste's author (a strike otherwise),
merge it with the author's proof they hold as a plain union, never pruned, and relay
the signed frame unchanged, so it reaches peers not connected to the author. A
signed proof must also name only allow-listed calendars, carry no unknown attestation
or unsupported operation and stay within 16 KiB, 32 attestations, 8 calendars and 8
Bitcoin attestations; otherwise it is ignored (no strike: the relaying peer is not at
fault), and a union that would exceed the limits keeps the proof already held. Any
other participant can still stamp or upgrade a paste: that proof stays on their
device (shown as their own, merged with the author's for display, downloads and
exports) and is never sent. A Bitcoin attestation is shown as
*claimed, not verified* — in the board and in exports — until **Check in Bitcoin**
has matched its commitment with the block, and the pending calendars are shown next
to it: **Upgrade** stays available while an allow-listed calendar is pending. Check
results are dropped whenever the proof changes.

| Check | Where | Trust |
|---|---|---|
| Statement digest = paste id, signature, attachment hashes | in the browser, offline | none |
| Replaying the proof operations to each attestation | in the browser, offline | none |
| Pending attestation | — | a calendar's promise, not a proof |
| Commitment = Merkle root of block *h*, block time | in the browser, Esplora API (blockstream.info, then mempool.space) | the block explorer |
| Same, trust-minimised | `ots verify` with your own Bitcoin node | your node |

**Privacy.** Calendars receive a blinded digest, the IP address and the time of
the request; they cannot recover or confirm the content. Upgrades and the
explorer check reveal the IP address and the commitment or block height. The
room tag inside a statement links statements of the same board.
