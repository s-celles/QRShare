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
