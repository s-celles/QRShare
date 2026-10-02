# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Encryption for a trusted contact did not work.** Identity QR codes carried no encryption key, so a contact added by scanning could never be chosen, and the receiver looked the sender up with a padded fingerprint, so decryption always failed. Identity codes now carry the encryption key and the fingerprint is read correctly; contacts added before must be scanned again
- QR transfers ignored the frame rate chosen before pressing Start, and the 16-bit block count of their frames wrapped around for large files (it now saturates; receivers were not affected)
- A file handed to the WebRTC sender from another screen was always announced as a PNG image; files now keep their type
- Some labels showed raw identifiers (`receiver.downloaded`, `receiver.instantSpeed`, the contact encryption options); 70 texts were missing in Arabic; the vCard preview had French labels and the file preview English ones. A test now checks that every language has every text the code uses
- The single-file package was described as self-contained although its workers and WebAssembly runtimes stay separate files; the script, the documentation and the requirements now say so

### Added

- **Requirements specification** (`docs/requirements.md`), rebuilt from the code and tests in EARS notation like Progressive Web Office's: 197 requirements in 17 areas with MoSCoW priorities and the release that introduced each one, the requirement IDs already cited in the code kept, and a list of known deviations between code and specification. It is shown in the in-app documentation and linked from the About window (**Requirements**); a test checks that every requirement ID cited in code and tests is defined, unique and written in an EARS pattern
- The offline sync protocol of the collaboration core (`docs/collab-sync-protocol.md`) is part of the in-app documentation and of the requirements (REQ-COLLAB-090 to 094)

### Changed

- The README's documentation links open the pages in the app (`https://s-celles.github.io/QRShare/#/docs?page=…`); a page address can force a language (`&lang=fr`) and jump to a section (`&section=…`, GitHub-style heading anchors)

### Fixed

- Placeholders such as `<app>` or `<host>` in the documentation were hidden as unknown HTML tags; they are shown as text

### Added

- **In-app documentation** (`#/docs`, book icon in the header): an index of all the pages of `docs/` and each page rendered in the app, with a side menu, links between pages that stay in the app, tables, code and Mermaid diagrams; pages not yet translated are shown in English with a note. `#/guide` (the **?** button) still opens the user guide
- New documentation pages, moved out of the README: **How QRShare works** (features, transfer modes, encoding presets), **Architecture** (building blocks, technology stack) and **Development** (commands, writing documentation, releasing), plus a `docs/README.md` index

### Changed

- The README is now short: what QRShare is, a link to the app, highlights, links to the documentation and a quick start
- Documentation is rendered with marked (already used for file previews) instead of a minimal home-made converter

## [0.5.0] - 2026-10-01

### Changed

- QRShare is now licensed under the **BSD-3-Clause** license instead of AGPL-3.0-or-later (including the `@scelles/collab` core); releases up to 0.4.1 remain available under AGPL-3.0-or-later. The vendored libcimbar runtime keeps its own MPL-2.0 license

## [0.4.1] - 2026-10-01

### Added

- A book icon in the header opens the documentation (on GitHub, in a new tab)

### Fixed

- The "new version available" banner no longer appears on the very first visit, when the service worker installs for the first time

## [0.4.0] - 2026-10-01

### Added

- **App handoff** (protocol version 1): other web applications can hand a file to QRShare with `#/send?handoff=1` and `postMessage`, and get received files back through an **Open in <host>** button when they open the receive screen with a `return` URL; messages are accepted only from the opener and files are posted only to the expected origin
- The transfer chooser (`#/send`) accepts files as well as text; the single static QR code stays reserved for text

- **Local Network Peer Discovery**: Automatic zero-QR peer discovery on local Wi-Fi/LAN networks via WebRTC Trystero signaling, showing active nearby devices in `NearbyDevices` card with one-click direct transfer invitations (`TransferOfferModal`)
- End-to-End Encryption (E2EE) using **AES-256-GCM** and **PBKDF2-SHA256** (100,000 iterations) via browser-native Web Crypto API, allowing password-protection of static QR codes, animated QR streams, and WebRTC file/text transfers with original filename preservation upon decryption
- Receiver-side `EncryptedUnlockCard` for automatic password prompt, password reveal toggle, and secure in-browser decryption
- Native support for structured QR formats: Wi-Fi connection strings (`WIFI:S:...;`) and Contact cards (**MECARD** compact format and **vCard 3.0** standard format)
- Guided form templates in `CreatorView` for creating Wi-Fi networks and Contact cards with automatic escaping and capacity calculation
- Smart structured QR parser for `ScannerView` and `TextResultView` rendering interactive result cards (Wi-Fi password reveal, copy password, download `.vcf` contact file, call/email buttons)
- Printable Wi-Fi Guest Sign modal with print-optimized CSS layout for paper printing or badge creation
- Experimental CIMBAR air-gapped transport using native QRShare Preact views and workers backed directly by the libcimbar v0.6.7c WASM APIs, available as a separate send/receive mode with receiver invitation support

- Collaborative editing shows **who is here**, each participant with a friendly compound name (e.g. *Swift Crimson Falcon*) in a matching colour, and saved versions show their author
- The collaboration engine (document sync, version history, presence, local persistence) is now a UI-independent core in `src/collab/core`, also published as the `@scelles/collab` git dependency (`collab-dist` branch, built by the *Collab package* workflow on `collab-v*` tags) so other apps can share it

### Changed

- The About page is now an About window, modelled on the one of Progressive Web Office: logo and tagline, version (linked to the changelog), commit (linked to GitHub), build date, licence, whether the app is installed and works offline, the QR code of the app with its URL, links to the guide, source, changelog and issue tracker, a privacy note, and a **Copy details** button for bug reports; a click on its QR code shows it full screen, easier to scan from a distance, and the version next to the name in the header now opens it. It also links to the documentation (user guide, connectivity and TURN, collaborative editing) and credits the free software QRShare is built on
- When a new version is deployed, a banner offers to reload (**Reload** / **Later**), as in Progressive Web Office; the service worker now changes with every build, so browsers and installed apps actually notice new versions, and they check again when the app comes back to the foreground
- New visual style shared with [Progressive Web Office](https://s-celles.github.io/progressive-web-office/): same palette (light and dark), header bar with a brand badge, bordered buttons, start-screen cards with a coloured edge (blue to send, green to receive, orange for QR tools) and a high-visibility focus ring; the app icon (SVG and 192/512 PNG, now rendered from the SVG) uses the same blue; status colours now follow the theme instead of being fixed light-mode values
- The header theme button cycles between Auto (system), Light and Dark, like the Settings choice, instead of only switching between light and dark (which silently left the Auto mode)

### Fixed

- Files shared to QRShare through the Web Share Target were dropped on the way: the service worker now keeps the file and opens the transfer chooser with it
- The Web Share Target redirected to the domain root instead of the app's own scope when QRShare is served from a sub-path (as on GitHub Pages)
- In Auto mode, the theme now follows changes of the system light/dark setting while the app is open

## [0.3.0] - 2026-08-03

### Added

- A **Prepare a transfer** workflow lets the sender select text or one or more files, choose an air-gapped preference or constraint, and show the receiver a bootstrap QR code that opens QRShare directly in the matching receive view before the payload transfer begins
- URL-driven text transfer selection via `#/send?data=...&policy=...`, with static QR, animated QR, WebRTC, and system-share choices filtered and recommended according to the transfer policy
- Air-gapped transfer policies are enforced as constraints: WebRTC and system sharing are unavailable when `policy=airgap`, regardless of payload size
- Multiple files selected during transfer preparation are bundled using the existing QRShare ZIP format before sending

### Fixed

- **The collaborative editor's text area was far too narrow.** The `.collab-editor` textarea had no CSS rule, so it fell back to the browser's default width instead of filling the view. It now spans the full width, and the `/collab` view widens beyond the 960px app shell toward the viewport to give editing more room

## [0.2.0] - 2026-07-17

### Added

- **Live collaborative text editing** over an established WebRTC connection: after connecting and verifying the confirmation code, either peer can open a shared editor at `/collab` where edits propagate live and converge automatically
- Yjs CRDT (`Y.Doc` / `Y.Text`) wired directly onto the existing trystero DataChannel via new `doc-update`, `version`, and `sync` actions — no Yjs network provider added; concurrent same-region edits merge without data loss
- State-vector handshake for late-join and reconnect resync (`Y.encodeStateVector` / `Y.encodeStateAsUpdate`), including version-log replay
- Named document versions with restore, ordered by a per-peer logical (Lamport) clock with `siteId` tie-break (never wall-clock), append-only and de-duplicated by `id`
- Local persistence via `y-indexeddb` keyed by Room ID, so reloading rejoins the same session; degrades gracefully to a no-op (session lost on reload) when IndexedDB is unavailable
- "Export as QR" per saved version routes a snapshot's text through the existing one-way QR text pipeline (clearly labeled as a one-way snapshot, not a live channel)
- New `editing` WebRTC session state that keeps the room open; peer-leave during editing is a recoverable presence change instead of an error
- `collab.*` i18n keys in English, French, and Arabic; new `docs/en-collaborative-editing.md` documentation page
- `yjs` and `y-indexeddb` dependencies; the Yjs-backed modules are lazy-imported on the `/collab` route to limit the base bundle impact (~50–100 KB added to the single-file build)
- **Connection failures are now diagnosed instead of guessed at.** A failed WebRTC connection is classified into a stable, translated code — `relay-likely-required`, `turn-not-working`, `peer-unreachable`, `peer-dropped`, `peer-left-deliberately`, `no-strategy-initialized` — replacing the generic "Connection timed out. Make sure the receiver is still waiting", which was actively misleading when the real cause was a network needing a relay. Causes that cannot be confirmed from this device are labelled as such rather than asserted — including when the ICE probe itself times out, in which case a missing relay candidate is reported as inconclusive rather than as proof that the TURN server is broken
- **"Test ICE servers"** in WebRTC settings: runs a real ICE gathering round against the servers as configured and reports whether STUN is reachable, whether a TURN server is configured, and whether it actually returns a relay address — so a broken TURN setup is found before a transfer fails, not after
- An "Open WebRTC settings" shortcut on relay-related failures, and a collapsed "Connection details" block (candidates gathered, STUN/TURN results) shown on failure only
- `docs/en-connectivity-and-turn.md`: what STUN and TURN are, why symmetric NAT / mobile CGNAT / UDP-blocking firewalls break direct P2P, why QRShare deliberately ships no relay, and how to add your own (self-hosted coturn or a third-party provider, with the privacy trade-off stated)
- A guard test ensuring no TURN server can be added to the shipped defaults inadvertently

### Fixed

- **TURN servers configured through a TOML config file were silently dropped.** The TOML parser only recognised `[section]` headers, so the `[[webrtc.ice.turn]]` array-of-tables syntax — which the exporter itself writes — was ignored, and the `urls` / `username` / `credential` lines that followed leaked into the enclosing `[webrtc.ice]` table. Importing a config, or even round-tripping an exported one, lost every TURN server
- **Both peers could disconnect each other right after connecting.** In `parallel` mode each side independently adopted the first signaling strategy whose peer joined and left every other room, with no negotiation. When two strategies connected within the same short window the two peers could settle on *different* strategies, each tearing down the room the other had kept, and both failed with "Peer disconnected". Strategy selection is now deterministic: the two peer ids elect a leader with no round trip, the leader announces its choice over the channel it keeps, and no room is torn down before the agreement. A follower whose peer never announces (`sequential` mode, or an older build) falls back to its own first still-alive strategy after a short grace period
- **Configured TURN servers were silently ignored**, making connections fail on networks that require relaying (symmetric NAT, mobile CGNAT, UDP-blocking firewalls). Trystero spreads `rtcConfig` after its own `iceServers`, so the STUN-only `rtcConfig.iceServers` QRShare built overrode both the trystero defaults and the separately-passed `turnConfig`, and TURN never reached the `RTCPeerConnection`. STUN and TURN are now merged into a single `rtcConfig.iceServers` list with credentials preserved
- A TURN-only ICE configuration (no STUN) previously produced an empty `iceServers` list, removing every ICE server

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
