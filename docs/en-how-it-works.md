# How QRShare Works

QRShare moves text and files between devices without a server of its own. This
page gives an overview of the features, then walks through each transfer mode
step by step. For day-to-day use, see the [User Guide](en-user-guide.md).

## Features

- **QR Code Scanner** — Scan any QR code with your camera and view its decoded content. URLs are displayed as clickable links. Scanned content can be shared, copied, or forwarded via QR/WebRTC. The camera area disappears after reception.
- **QR Code Creator** — Generate QR codes from arbitrary text with full control over QR version (1–40) and error correction level (L/M/Q/H). Live preview, real-time capacity display, PNG download, and one-tap sharing via Web Share API, QR transfer, or WebRTC.
- **Guided Transfer Preparation** — Select text or one or more files, choose a network policy, let QRShare recommend a transport, then show the receiver an invitation QR code before sending the payload.
- **Native Share** — Send one or more files via the native share dialog (Web Share API). Works with any app that supports receiving shared files (messaging apps, email, cloud storage, etc.).
- **QR Code Transfer** — Send files between devices using animated QR codes. No internet connection required — works completely air-gapped.
- **CIMBAR Transfer (Experimental)** — High-speed air-gapped color-barcode transfer using libcimbar WASM. The browser decoder is beta, so standard animated QR remains the compatibility fallback.
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
- **Single-File Distribution** — Package the core app into a single self-contained HTML file. The experimental CIMBAR runtime remains a separate WASM asset and is available in the standard PWA build.

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
