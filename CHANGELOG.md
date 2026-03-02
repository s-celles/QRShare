# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- GPL-3.0-or-later license
- Security policy (SECURITY.md)
- 68 tests covering crypto, compression, frame protocol, fountain codecs, QR renderer, WebRTC, share service, and E2E roundtrip
