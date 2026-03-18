# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.4] - 2026-03-15

### Changed

- **Protocol v3**: metadata (filename, file size, SHA-256) is now embedded in every QR frame instead of separate metadata frames, ensuring reliable transfer even when frames are missed
- Default QR transfer frame rate changed to 2 FPS and block size to 250 bytes for more reliable camera scanning

### Added

- Text message sharing across all transfer methods (QR, WebRTC, Web Share) with File/Text toggle
- TextInputArea component with multi-line input, live character count, and 100K character limit
- TextResultView component for inline text display with Copy to Clipboard, Download as File, and Share actions
- Protocol FLAG_TEXT (bit 0 of flags byte) for text content type discrimination in QR frames
- ShareService.shareText() and ShareService.copyToClipboard() methods
- Web Share Target support for receiving shared text from other apps
- i18n translation keys for text sharing UI in English, French, and Arabic
- Adjustable frame rate slider (1–30 FPS) in QR sender view
- Adjustable block size slider (50–1000 bytes) in QR sender view
- Transfer speed (throughput) and elapsed time display in QR code receiver view
- Build hash (git short commit) displayed next to version number in header and About page

### Fixed

- QR transfer: filename missing and file size incorrect on receiver due to metadata frames not being scanned
- QR transfer: integrity falsely reported as corrupted because SHA-256 was not received before decoding completed
- QR transfer corruption: force LT codec (pure JS) in QR workers to prevent codec mismatch when sender and receiver have different WASM support
- LT fountain codec baseSeed mismatch between encoder and decoder causing data corruption and hash verification failures

## [0.1.3] - 2026-03-04

### Fixed

- TURN server add button not showing new entry in WebRTC settings

## [0.1.2] - 2026-03-04

### Added

- ICE server configuration (STUN/TURN) in WebRTC settings for networks with AP isolation (e.g. guest WiFi on mesh routers)
- Default Google STUN servers for NAT traversal
- TURN server support with URL, username, and credential fields
- TOML import/export support for ICE server configuration

## [0.1.1] - 2026-03-04

### Added

- Version number displayed in the header next to the app title
- Visual separation of file transfer modes (Share, QR Code, WebRTC) on the landing page with labeled sub-groups
- TOML import/export for all application settings (theme, language, WebRTC) via Settings page
- Theme preference now persists across page reloads via localStorage
- Configurable WebRTC signaling strategies: enable/disable strategies, reorder priority, edit per-strategy relay URLs, and choose between parallel race or sequential fallback connection mode
- WebRTC Settings page (`/#/settings/webrtc`) with connection mode selector, strategy toggles with reorder buttons, and per-strategy relay URL editor
- Settings link from main Settings page to WebRTC Settings
- Multi-strategy signaling fallback for WebRTC peer discovery: parallel race across Nostr relays, BitTorrent trackers, and MQTT brokers
- Strategy adapter layer (`src/webrtc/strategies.ts`) with static imports for Nostr/Torrent and dynamic import for MQTT
- UI displays active signaling strategies during connection and which strategy succeeded
- Send (Share) mode: dedicated file sharing via native Web Share API dialog, supporting one or more files
- Internationalization (i18n) with EN/FR translations and auto-detection from browser language
- Language selector in Settings (Auto/English/Français) with localStorage persistence
- Share/send actions for created QR codes (Web Share API, QR transfer, WebRTC)
- Share/send actions for scanned QR content (Web Share API, QR transfer, WebRTC)
- In-app user guide with Mermaid diagrams for workflow visualization
- Multi-file transfer support for both QR and WebRTC modes
- QR mode: multiple files are bundled into a zip archive and transferred as a single stream
- WebRTC mode: files are sent sequentially with per-file progress and "File X of Y" counter
- QR receiver auto-detects zip bundles and shows individual file downloads
- WebRTC receiver shows individual file list with download buttons for batch transfers
- Zip bundle utility (`src/zip/bundle.ts`) using fflate for bundling/unbundling

### Fixed

- Reduce block size for small payloads to satisfy Wirehair k>=2 requirement (fixes "Wirehair encode failed with code 2" for short content)

### Changed

- GuideView uses shared i18n locale signal instead of its own language detection
- WebRTC signaling uses parallel multi-strategy race (Nostr + Torrent + MQTT) instead of Nostr-only
- Migrate WebRTC signaling from PeerJS to Trystero (Nostr relays) for decentralized, NAT-friendly peer discovery
- Replace Peer ID with short 6-character Room ID for simpler QR codes
- Room ID used as password for SDP encryption
- QR frame protocol v2: embed `compressedSize` and `compressionId` in every frame header (19-byte header) so the decoder can initialize from any data frame, inspired by CAScad's self-contained fountain frame design
- Metadata frames now only carry filename, fileSize, and sha256 (for UI display and integrity verification); they are no longer required for decoder initialization

### Removed

- PeerJS Server settings (host/port/path/secure) from Settings page
- TURN Server settings (url/username/credential) from Settings page
- Manual STUN/TURN configuration (handled automatically by Trystero)

## [0.1.0] - 2026-03-02

### Added

- QR code file transfer with animated QR codes and fountain codes (Wirehair WASM + LT fallback)
- WebRTC peer-to-peer file transfer with PeerJS signaling and 4-digit confirmation code
- Binary frame protocol with 14-byte header, metadata frames, and SHA-256 integrity verification
- Compression service using fflate with incompressible data detection
- Three encoding presets: High Speed (v25/L/15fps), Balanced (v20/M/12fps), High Reliability (v15/Q/8fps)
- QR code generation (lean-qr) and scanning (@undecaf/zbar-wasm)
- Web Workers for encode and decode pipelines (off main thread)
- Preact UI with @preact/signals for reactive state management
- Hash-based SPA router with six routes
- Dark/light theme with auto-detection and manual toggle
- Settings panel for PeerJS server and TURN server configuration
- Web Share API integration with feature detection and fallback
- Web Share Target manifest configuration
- PWA manifest with SVG and PNG icons (192px, 512px)
- Service Worker with cache-first offline strategy
- Bun build script with worker, SW, CSS, and WASM bundling
- Single-file HTML packaging script
- GitHub Actions CI workflow with type-check, tests, build
- GitHub Pages deployment on push to main
- Accessibility audit: ARIA labels, roles, live regions, keyboard navigation, WCAG AA contrast
- AGPL-3.0-or-later license
- Security policy (SECURITY.md)
- 68 tests covering crypto, compression, frame protocol, fountain codecs, QR renderer, WebRTC, share service, and E2E roundtrip
