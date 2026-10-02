# Architecture

QRShare is a static Progressive Web App: everything runs in the browser, and the
build output can be served from any static host (GitHub Pages in production). See
[How QRShare Works](en-how-it-works.md) for the transfer flows.

## Building Blocks

- **Preact + Signals** — Lightweight reactive UI framework
- **Web Workers** — Encode and decode pipelines run off the main thread
- **Binary Frame Protocol** — 19-byte self-contained header with version, metadata hash, block count, compressed size, compression ID, symbol ID
- **Compression** — fflate (deflate) with automatic incompressible data detection
- **QR Generation** — lean-qr in byte mode with three quality presets
- **QR Scanning** — @undecaf/zbar-wasm for real-time decoding
- **Experimental color barcode** — libcimbar v0.6.7c WASM encoder and beta web decoder
- **WebRTC** — Trystero (Nostr relays) for decentralized signaling, binary transfer over DataChannel
- **Collaboration** — Yjs documents synchronized over the WebRTC room; the engine lives in `src/collab/core` and is also published as the `@scelles/collab` package (see [Collaborative Editing](en-collaborative-editing.md))
- **i18n** — Custom lightweight translation system with signal-based locale, flat key-value dictionaries, parameterized strings, auto-detection + localStorage persistence
- **Service worker** — Precaches the app for offline use; its cache name changes with every build so installed copies notice new versions
- **Documentation** — The Markdown files in `docs/` are bundled into the app and rendered in-app with marked; Mermaid diagrams are loaded on demand from a CDN (theme-aware)

## Technology Stack

- **Runtime**: [Bun](https://bun.sh)
- **UI**: [Preact](https://preactjs.com) + [@preact/signals](https://github.com/preactjs/signals)
- **QR Generation**: [lean-qr](https://www.npmjs.com/package/lean-qr)
- **QR Scanning**: [@undecaf/zbar-wasm](https://www.npmjs.com/package/@undecaf/zbar-wasm)
- **Fountain Codes**: [wirehair-wasm](https://www.npmjs.com/package/wirehair-wasm) + pure-JS LT fallback
- **Experimental CIMBAR**: [libcimbar](https://github.com/sz3/libcimbar) v0.6.7c (MPL-2.0)
- **Compression**: [fflate](https://github.com/101arrowz/fflate)
- **WebRTC**: [Trystero](https://github.com/dmotz/trystero) (Nostr strategy)
- **Collaboration**: [Yjs](https://github.com/yjs/yjs) + y-protocols + y-indexeddb
- **Markdown**: [marked](https://github.com/markedjs/marked)
- **Language**: TypeScript (strict mode)
