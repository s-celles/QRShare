# QRShare

![QRShare](assets/QRShare.png)

Air-gapped peer-to-peer file transfer via animated QR codes with fountain codes.

## Features

- **QR Code Scanner** -- Scan any QR code with your camera and view its decoded content. URLs are displayed as clickable links. Scanned content can be shared, copied, or forwarded via QR/WebRTC. Includes camera device selection, resolution display, and scan metadata.
- **QR Code Creator** -- Generate QR codes from arbitrary text with full control over QR version (1–40) and error correction level (L/M/Q/H). Live preview, real-time capacity display, PNG download, and one-tap sharing via Web Share API, QR transfer, or WebRTC.
- **Native Share** -- Send one or more files via the native share dialog (Web Share API). Works with any app that supports receiving shared files (messaging apps, email, cloud storage, etc.).
- **QR Code Transfer** -- Send files between devices using animated QR codes. No internet connection required -- works completely air-gapped.
- **WebRTC Transfer** -- Direct peer-to-peer file transfer over WebRTC DataChannel with 4-digit confirmation code for security verification.
- **Fountain Codes** -- Rateless erasure coding (Wirehair WASM with pure-JS LT fallback) ensures reliable transfer even with missed frames.
- **Internationalization** -- Full EN/FR interface with auto-detection from browser language and manual selection in Settings.
- **In-App User Guide** -- Bilingual (EN/FR) user guide rendered in-app with Mermaid diagrams for workflow visualization.
- **Progressive Web App** -- Install on any device, works offline after first load.
- **Web Share Integration** -- Share received files, created QR codes, and scanned content directly to other apps using the Web Share API.
- **Dark/Light Theme** -- Automatic theme detection with manual override.
- **SHA-256 Verification** -- End-to-end integrity verification of transferred files.
- **Single-File Distribution** -- Package the entire app into a single self-contained HTML file.

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Run tests
bun test

# Type check
bun run typecheck

# Production build
bun run build

# Package as single HTML file
bun run package
```

## How It Works

### QR Utilities

- **Scan QR Code** -- Point your camera at any QR code to decode it. The app detects URLs and displays them as clickable links; other content is shown as text with a copy-to-clipboard button. Camera parameters (device, resolution) and scan metadata are always visible.
- **Create QR Code** -- Type or paste text into the editor to generate a QR code in real time. Adjust QR version and error correction level directly. A capacity meter shows payload size versus maximum. Download the result as a PNG.

### Share Mode (Native)

1. Select one or more files (drop or browse)
2. The native share dialog opens, letting you send files to any compatible app (messaging, email, cloud storage)
3. No setup required -- uses the browser's built-in Web Share API

### QR Code Mode (Air-Gapped)

1. **Sender** selects a file and encoding preset (High Speed / Balanced / High Reliability)
2. The file is compressed, split into blocks, and encoded using fountain codes
3. Encoded blocks are serialized into a binary frame protocol and rendered as animated QR codes
4. **Receiver** scans the QR animation with their camera
5. Fountain codes allow reconstruction even if some frames are missed
6. File integrity is verified via SHA-256 hash

### WebRTC Mode (P2P)

1. **Receiver** creates a room and displays its 6-character Room ID as a QR code
2. **Sender** scans or enters the Room ID to join the room and establish a WebRTC connection
3. Both devices display a 4-digit confirmation code to verify the connection
4. File is transferred over a WebRTC DataChannel with automatic chunking
5. SHA-256 verification confirms file integrity

## Architecture

- **Preact + Signals** -- Lightweight reactive UI framework
- **Web Workers** -- Encode and decode pipelines run off the main thread
- **Binary Frame Protocol** -- 19-byte self-contained header with version, metadata hash, block count, compressed size, compression ID, symbol ID
- **Compression** -- fflate (deflate) with automatic incompressible data detection
- **QR Generation** -- lean-qr in byte mode with three quality presets
- **QR Scanning** -- @undecaf/zbar-wasm for real-time decoding
- **WebRTC** -- Trystero (Nostr relays) for decentralized signaling, binary transfer over DataChannel
- **i18n** -- Custom lightweight translation system with signal-based locale, flat key-value dictionaries, parameterized strings, auto-detection + localStorage persistence
- **Mermaid** -- Dynamic CDN loading for diagram rendering in the user guide (theme-aware)

## Encoding Presets

| Preset | QR Version | ECC Level | Max Payload | Default FPS |
|--------|-----------|-----------|-------------|-------------|
| High Speed | 25 | L | 1,273 bytes | 15 |
| Balanced | 20 | M | 666 bytes | 12 |
| High Reliability | 15 | Q | 292 bytes | 8 |

## Technology Stack

- **Runtime**: [Bun](https://bun.sh)
- **UI**: [Preact](https://preactjs.com) + [@preact/signals](https://github.com/preactjs/signals)
- **QR Generation**: [lean-qr](https://github.com/nicktomlin/lean-qr)
- **QR Scanning**: [@undecaf/zbar-wasm](https://github.com/niclas-nickleby/zbar-wasm)
- **Fountain Codes**: [wirehair-wasm](https://github.com/nicktomlin/wirehair-wasm) + pure-JS LT fallback
- **Compression**: [fflate](https://github.com/101arrowz/fflate)
- **WebRTC**: [Trystero](https://github.com/dmotz/trystero) (Nostr strategy)
- **Language**: TypeScript (strict mode)

## Releasing a New Version

1. **Bump the version** in `package.json` and `src/version.ts`
2. **Update `CHANGELOG.md`**: move entries from `[Unreleased]` into a new `[X.Y.Z] - YYYY-MM-DD` section
3. **Run checks**:
   ```bash
   bun test
   bun run build
   ```
4. **Commit** the version bump:
   ```bash
   git add package.json src/version.ts CHANGELOG.md
   git commit -m "chore: release vX.Y.Z"
   ```
5. **Tag** the release:
   ```bash
   git tag vX.Y.Z
   ```
6. **Push** commit and tag:
   ```bash
   git push && git push --tags
   ```
7. **(Optional) Create a GitHub Release** from the tag:
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag
   ```

## License

[GPL-3.0-or-later](LICENSE)
