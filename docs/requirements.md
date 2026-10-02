# Requirements Specification

- Status: v1, reconstructed from the code and tests of QRShare 0.5.0 (2026-10-02)
- Notation: [EARS](https://alistairmavin.com/ears/) (Easy Approach to Requirements Syntax)
- Prioritisation: MoSCoW — **M**ust / **S**hould / **C**ould / **W**on't (this time)
- **Since**: the release that introduced the behaviour (see the [changelog](https://github.com/s-celles/QRShare/blob/main/CHANGELOG.md)); *Unreleased* = on `main`, not yet released; — = not implemented
- Traceability: code and tests cite requirements by ID (`REQ-AREA-NNN`); a test checks that every cited ID is defined here

EARS templates used:

| Type | Template |
|------|----------|
| Ubiquitous | The system shall &lt;response&gt;. |
| Event-driven | When &lt;trigger&gt;, the system shall &lt;response&gt;. |
| State-driven | While &lt;state&gt;, the system shall &lt;response&gt;. |
| Unwanted | If &lt;condition&gt;, then the system shall &lt;response&gt;. |
| Optional | Where &lt;feature&gt;, the system shall &lt;response&gt;. |

Identifiers are stable: a requirement that is dropped keeps its ID (marked W), and
new requirements take the next free number of their area. Gaps in the numbering
are reserved ranges.

## 1. Vision

QRShare moves text and files between two devices **without a server of its own**,
entirely in the browser, as an installable Progressive Web App. Its preferred
channels are **air-gapped**: animated QR codes with fountain codes, and
experimental CIMBAR colour barcodes, from one screen to one camera. When a
network is acceptable, it also offers direct WebRTC peer-to-peer transfers,
nearby-device discovery and live collaborative editing. It also scans and creates
ordinary QR codes (text, URLs, Wi-Fi, contacts).

## 2. Platform and application shell (PLT)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-PLT-001 | M | 0.1.0 | The system shall run entirely in the browser as a static single-page application written in TypeScript with strict type checking. |
| REQ-PLT-002 | M | 0.1.0 | The system shall not send the content being transferred to any server operated for QRShare; network transfers shall go directly between the peers. |
| REQ-PLT-003 | M | 0.1.0 | The system shall be installable as a Progressive Web App, with a web app manifest (name QRShare, standalone display, SVG, 192 px and 512 px icons) and a service worker. |
| REQ-PLT-004 | M | 0.1.0 | When the service worker installs, the system shall precache the application shell, the manifest, the icons and the CIMBAR runtime files. |
| REQ-PLT-005 | M | 0.1.0 | While the device is offline, the system shall start from the cache and serve hashed assets cache-first and other files network-first with a cache fallback. |
| REQ-PLT-006 | S | 0.4.0 | The system shall give the service worker a cache name that changes with every build, so that browsers and installed apps detect each new version. |
| REQ-PLT-007 | S | 0.4.0 | When a new version has been activated for a page that an older version was serving, the system shall show a banner that offers to reload now or later. |
| REQ-PLT-008 | S | 0.4.1 | The system shall not show the new-version banner on the first visit, when the service worker installs for the first time. |
| REQ-PLT-009 | S | 0.4.0 | When the application comes back to the foreground, the system shall check for a new version. |
| REQ-PLT-010 | M | 0.1.0 | The system shall route views through the URL fragment (`#/path?query`) and shall show the home screen for an unknown path. |
| REQ-PLT-011 | M | 0.1.0 | The system shall run QR encoding and decoding pipelines in Web Workers, off the main thread. |
| REQ-PLT-012 | M | 0.1.0 | The system shall build with Bun into `dist/`, with content-hashed script and style names. |
| REQ-PLT-013 | C | 0.1.0 | The system shall be packageable as a single HTML file holding the main script, the styles and the icon, served next to the Web Workers and WebAssembly runtimes of the build. |
| REQ-PLT-014 | M | 0.1.0 | When a commit reaches the `main` branch, the system shall be type-checked, tested, built and deployed to GitHub Pages. |
| REQ-PLT-015 | M | 0.1.4 | The system shall show its version and build (git short commit) next to its name in the header. |
| REQ-PLT-016 | M | 0.5.0 | The system shall be distributed under the BSD-3-Clause license, bundled third-party components keeping their own licences (libcimbar: MPL-2.0). |

## 3. User interface (UI)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-UI-001 | M | 0.1.0 | The system shall offer light and dark themes and an Auto preference that follows the system setting, Auto being the default. |
| REQ-UI-002 | S | 0.4.0 | When the user activates the header theme button, the system shall cycle the preference Auto → Light → Dark → Auto. |
| REQ-UI-003 | S | 0.4.0 | While the preference is Auto, the system shall follow changes of the system light/dark setting without a reload. |
| REQ-UI-004 | M | 0.1.1 | The system shall keep the theme preference across visits (local storage). |
| REQ-UI-005 | M | 0.1.1 | The system shall group the home screen actions into QR utilities and file transfer modes (share, animated QR, CIMBAR, WebRTC), with a smart scanner and a transfer preparation as the first actions. |
| REQ-UI-006 | S | 0.4.0 | The system shall use the visual style of Progressive Web Office (palette, header bar with a brand badge, bordered buttons, cards with a coloured edge per action kind, high-visibility focus ring). |
| REQ-UI-007 | M | 0.1.0 | The system shall provide ARIA labels and roles, live regions for progress and status, keyboard operation and WCAG AA contrast. |
| REQ-UI-008 | M | 0.1.0 | The system shall offer a Back action on every sub-page that returns to the home screen. |
| REQ-UI-009 | S | 0.4.0 | When the user activates the version next to the name, the system shall open the About window. |

## 4. Internationalisation (I18N)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-I18N-001 | M | 0.1.1 | The system shall provide its interface in English, French and Arabic. |
| REQ-I18N-002 | M | 0.1.1 | While the language preference is Auto, the system shall use the browser language (Arabic, French, otherwise English). |
| REQ-I18N-003 | M | 0.1.1 | When the user picks a language in Settings, the system shall apply it at once and keep it across visits. |
| REQ-I18N-004 | M | 0.1.4 | While the interface is in Arabic, the system shall lay out the page right-to-left. |
| REQ-I18N-005 | M | 0.1.1 | If a text has no translation in the active language, then the system shall show the English text. |

## 5. Settings and configuration (SET)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-SET-001 | M | 0.1.1 | The system shall provide a Settings page for language, theme, local discovery and a link to the WebRTC settings. |
| REQ-SET-002 | S | 0.1.1 | When the user exports the settings, the system shall download a `qrshare-config.toml` file holding the theme, the language and the WebRTC settings (mode, strategies, relay URLs, STUN servers and TURN servers). |
| REQ-SET-003 | S | 0.1.1 | When the user imports a settings file, the system shall apply the theme, language and WebRTC settings it contains, using defaults for missing or invalid values and ignoring unknown keys. |
| REQ-SET-004 | S | 0.1.1 | If an imported settings file cannot be parsed, then the system shall show an error and keep the current settings. |
| REQ-SET-005 | M | 0.2.0 | The system shall read TURN servers written as a TOML array of tables (`[[webrtc.ice.turn]]`), so that an export imports back without loss. |

## 6. About window and documentation (DOC)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-DOC-001 | S | 0.4.0 | When the user opens About, the system shall show a window with the logo and description, version (linked to the changelog), commit (linked to the source), build date, licence, whether the app is installed and whether it works offline. |
| REQ-DOC-002 | S | 0.4.0 | The system shall show in the About window a QR code of the application address, and shall show it full screen when the user activates it. |
| REQ-DOC-003 | S | 0.4.0 | When the user selects Copy details in the About window, the system shall copy the version, build, address, browser, language, installed and offline states for a bug report. |
| REQ-DOC-004 | S | 0.4.0 | The system shall link from the About window to the documentation, the requirements, the source code, the changelog and the issue tracker, and shall show a privacy note, credits and a disclaimer. |
| REQ-DOC-005 | S | 0.1.1 | The system shall show the user guide in the app, in English or French according to the interface language. |
| REQ-DOC-006 | S | Unreleased | The system shall show every page of the `docs/` folder in the app (`#/docs`), with an index, a page menu, tables, code and Mermaid diagrams. |
| REQ-DOC-007 | S | Unreleased | When the user follows a link between documentation pages, the system shall stay in the app; external links shall open in a new tab. |
| REQ-DOC-008 | S | Unreleased | Where a documentation address names a language (`&lang=`) or a section (`&section=`), the system shall show that translation and scroll to that heading, headings having GitHub-compatible anchors. |
| REQ-DOC-009 | S | Unreleased | If a documentation page has no translation in the interface language, then the system shall show the English page with a note. |
| REQ-DOC-010 | C | 0.1.1 | If the Mermaid library cannot be loaded, then the system shall leave the diagram source as text. |

## 7. QR scanning (SCAN)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-SCAN-001 | M | 0.1.1 | When the user starts the scanner, the system shall open the rear camera and decode QR codes in real time with zbar-wasm, stopping the camera at the first decoded code. |
| REQ-SCAN-002 | S | 0.1.1 | Where the device has several cameras, the system shall let the user choose the camera and shall show the actual camera resolution. |
| REQ-SCAN-003 | M | 0.1.1 | If camera access is refused, then the system shall show an explanatory message. |
| REQ-SCAN-004 | M | 0.1.1 | When a decoded code is a web address, the system shall show it as a link opening in a new tab; other content shall be shown as text. |
| REQ-SCAN-005 | S | 0.3.0 | When a decoded code is an address of this QRShare instance, the system shall offer to open it in the app. |
| REQ-SCAN-006 | M | 0.1.1 | When content has been scanned, the system shall offer to copy it, share it, show it as a static QR code, or send it by animated QR or WebRTC. |
| REQ-SCAN-007 | S | 0.4.0 | When the user starts the smart scanner, the system shall ask for consent, then route to the animated QR receiver for a QRShare transfer frame, to the CIMBAR receiver for a CIMBAR frame, and to the QR scanner for any other code. |
| REQ-SCAN-008 | S | 0.3.0 | Where a scanner address carries `autostart=1`, the system shall start the camera without a further action. |
| REQ-SCAN-009 | M | 0.1.1 | When the user leaves a scanning view, the system shall stop the camera. |

## 8. QR code creation (CREATE)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-CREATE-001 | M | 0.1.1 | When the user types text, the system shall render its QR code in byte mode in real time. |
| REQ-CREATE-002 | M | 0.1.1 | The system shall let the user choose the error correction level (L, M, Q, H; default M) and either an automatic version (smallest that fits) or a manual version from 1 to 40. |
| REQ-CREATE-003 | M | 0.1.1 | The system shall show the payload size against the capacity of the chosen version and level (ISO/IEC 18004 byte-mode table). |
| REQ-CREATE-004 | M | 0.1.1 | If the payload exceeds the capacity, then the system shall show a warning and render no code. |
| REQ-CREATE-005 | M | 0.1.1 | When a code has been created, the system shall offer to download it as PNG, share it, or send it by animated QR or WebRTC. |
| REQ-CREATE-006 | S | 0.4.0 | The system shall offer Wi-Fi and contact templates that build the payload from form fields, escaping special characters. |
| REQ-CREATE-007 | S | 0.4.0 | When text handed to the creator is a Wi-Fi or contact payload, the system shall pre-fill the matching template. |
| REQ-CREATE-008 | S | 0.4.0 | Where the payload is a Wi-Fi network, the system shall offer a printable sign with the code, the network name, the password and the security type. |

## 9. Structured QR content (STRUCT)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-STRUCT-001 | S | 0.4.0 | The system shall build and parse Wi-Fi payloads (`WIFI:S:…;T:WPA/WEP/nopass;P:…;H:true;;`), including escaped characters. |
| REQ-STRUCT-002 | S | 0.4.0 | The system shall build and parse contact cards in MECARD and vCard 3.0 formats. |
| REQ-STRUCT-003 | S | 0.4.0 | When scanned or received text is a Wi-Fi payload, the system shall show a Wi-Fi card with the network name, security, a hidden password that can be revealed, a copy button and a connect link. |
| REQ-STRUCT-004 | S | 0.4.0 | When scanned or received text is a contact card, the system shall show a contact card with call, e-mail and web links and a Save contact action that downloads a `.vcf` file. |
| REQ-STRUCT-005 | S | 0.4.0 | When scanned text is a QRShare identity, the system shall show its name and fingerprint and offer to add it as a trusted contact. |
| REQ-STRUCT-006 | S | 0.4.0 | The system shall let the user switch between the structured card and the raw text. |
| REQ-STRUCT-007 | S | Unreleased | When scanned or received text is a FIDO hybrid sign-in code (`FIDO:/` followed by digits encoding the CTAP 2.2 hybrid data), the system shall show a passkey card with the request (sign in or create a passkey) and the code's creation time, explaining that the code must be scanned by the phone holding the passkey, near the computer. |
| REQ-STRUCT-008 | S | Unreleased | If a passkey code was created more than five minutes earlier, then the system shall warn that it has most likely expired. |
| REQ-STRUCT-009 | S | Unreleased | The system shall not offer to copy, share, save or send on a passkey code, and shall warn the user never to forward it to another person or device. |
| REQ-STRUCT-010 | C | Unreleased | Where the operating system handles passkey codes, the system shall offer to hand the scanned code to it. |
| REQ-STRUCT-011 | S | Unreleased | If a code starting with `FIDO:/` is not a well-formed hybrid code, then the system shall show it as plain text. |

## 10. Encryption, identity and integrity (SEC)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-SEC-001 | M | 0.1.0 | The system shall compute the SHA-256 of every transferred file and report on reception whether it matches. |
| REQ-SEC-002 | M | 0.1.0 | If the received data does not match its SHA-256, then the system shall warn that the data may be corrupted. |
| REQ-SEC-003 | S | 0.4.0 | Where the user sets a password, the system shall encrypt the static QR content, the animated QR stream or the WebRTC transfer with AES-256-GCM under a key derived by PBKDF2-SHA-256 (100,000 iterations, random salt and IV). |
| REQ-SEC-004 | S | 0.4.0 | When an encrypted payload is received, the system shall ask for the password, with a reveal toggle, and decrypt in the browser. |
| REQ-SEC-005 | S | 0.4.0 | If the password is wrong or the encrypted payload has been altered, then the system shall refuse to decrypt and say so. |
| REQ-SEC-006 | S | 0.4.0 | The system shall create on first use a device identity made of an ECDSA P-256 signing key pair and an ECDH P-256 key pair, kept in local storage, with a short fingerprint of the public key. |
| REQ-SEC-007 | S | 0.4.0 | The system shall show the device identity as a QR code and keep a list of trusted contacts that can be added by scanning, removed, exported and imported as JSON. |
| REQ-SEC-008 | C | 0.4.0 | Where a trusted contact is chosen as recipient, the system shall encrypt the animated QR stream for that contact with an ECDH-derived AES-256-GCM key and the receiver shall decrypt it without a password. |
| REQ-SEC-009 | S | 0.4.0 | When a nearby device sends a transfer offer, the system shall sign it with the device identity and the receiver shall show whether the signature is verified and the sender is a trusted contact. |

## 11. Transfer preparation (SEND)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-SEND-001 | S | 0.3.0 | The system shall let the sender prepare a transfer of text (up to 100,000 characters) or of one or more files (up to 50 MB in total). |
| REQ-SEND-002 | S | 0.3.0 | The system shall apply a transfer policy: air-gapped only (no WebRTC, no system share), prefer air-gapped (the default), or any mode. |
| REQ-SEND-003 | S | 0.3.0 | The system shall recommend a mode from the content and the policy: a static QR code for text up to 2,331 bytes, otherwise animated QR unless the policy is any mode, otherwise WebRTC; CIMBAR shall be offered but never recommended. |
| REQ-SEND-004 | S | 0.4.0 | The system shall never offer a static QR code for a file. |
| REQ-SEND-005 | S | 0.3.0 | When the sender has chosen a mode, the system shall first show an invitation QR code that opens QRShare on the matching receive screen, and shall start the transfer only when the sender confirms that the receiver is ready. |
| REQ-SEND-006 | S | 0.3.0 | Where the transfer chooser address carries text (`#/send?data=…&policy=…`), the system shall prepare that text for transfer under that policy. |
| REQ-SEND-007 | M | 0.1.1 | When several files are sent as one transfer, the system shall bundle them in a QRShare ZIP archive, and the receiver shall list each file with its own download. |
| REQ-SEND-008 | S | 0.3.0 | Where CIMBAR is considered, the system shall offer it only for content up to about 33 MB. |

## 12. Animated QR transfer (QRX)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-QRX-001 | M | 0.1.0 | When the sender starts a transfer, the system shall compress the content (raw deflate, kept uncompressed when that is not smaller), encode it with a fountain code and show the symbols as an endless animation of QR codes. |
| REQ-QRX-002 | M | 0.1.0 | The system shall offer three presets: High Speed (up to version 25, ECC L), Balanced (version 20, ECC M; the default) and High Reliability (version 15, ECC Q). |
| REQ-QRX-003 | S | 0.1.4 | The system shall let the sender adjust the frame rate (1 to 30 frames per second) and the block size (50 to 1,000 bytes) during the transfer. |
| REQ-QRX-004 | M | 0.1.4 | The system shall make every frame self-contained (protocol version 3: header with content hash, block count (saturating at 65,535; the exact count follows from the compressed size and block size), block size, compressed size, compression and symbol identifiers, followed by file size, full SHA-256 and file name), so that reception can start from any frame. |
| REQ-QRX-005 | M | 0.1.0 | The system shall rebuild the received content from any sufficient set of distinct frames, whatever their order and whichever frames were missed. |
| REQ-QRX-006 | M | 0.1.0 | If a frame is unreadable, of an unknown protocol version, a duplicate or from another transfer, then the system shall ignore it on reception. |
| REQ-QRX-007 | M | 0.1.4 | While receiving, the system shall show progress, transfer speed (average, instant and a speed graph) and elapsed time. |
| REQ-QRX-008 | M | 0.1.4 | The system shall use the same pure-JavaScript LT fountain code on both sides of a QR transfer, so that devices with and without WebAssembly interoperate. |
| REQ-QRX-009 | M | 0.1.1 | The system shall split small payloads into at least two source blocks. |
| REQ-QRX-010 | M | 0.1.0 | When reception completes, the system shall stop the camera, verify the content and offer to download or share it, with a summary of size, duration and speed. |
| REQ-QRX-011 | M | 0.1.0 | If the sender selects a file larger than 50 MB, or files totalling more, then the system shall refuse them with an explanatory message. |

## 13. CIMBAR transfer (CIMBAR)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-CIMBAR-001 | C | 0.4.0 | The system shall send content as animated CIMBAR colour barcodes with the bundled, unmodified libcimbar v0.6.7c WebAssembly runtime, in its own views and workers. |
| REQ-CIMBAR-002 | C | 0.4.0 | The system shall label CIMBAR as experimental and recommend animated QR as the fallback. |
| REQ-CIMBAR-003 | C | 0.4.0 | The system shall let the user choose the CIMBAR mode (B, Bm, Bu) and the frame rate (5 to 20 frames per second). |
| REQ-CIMBAR-004 | C | 0.4.0 | While receiving CIMBAR, the system shall show progress, received bytes, speed, elapsed time and detected frames. |
| REQ-CIMBAR-005 | C | 0.4.0 | The system shall carry the SHA-256 of the content with a CIMBAR transfer and report on reception whether it matches. |
| REQ-CIMBAR-006 | C | 0.4.0 | If the browser lacks OffscreenCanvas, then the system shall report that CIMBAR sending is unavailable. |

## 14. Text sharing (TEXT)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-TEXT-001 | M | 0.1.4 | The system shall let the user send a text message, instead of a file, by animated QR, WebRTC and system share. |
| REQ-TEXT-002 | M | 0.1.4 | The system shall limit text messages to 100,000 characters and show a live character count. |
| REQ-TEXT-003 | M | 0.1.4 | The system shall mark text transfers so that the receiver shows the text inline with Copy, Download and Share actions instead of a file download. |
| REQ-TEXT-004 | M | 0.1.4 | The system shall preserve any Unicode text (accents, emoji, CJK, right-to-left scripts, line breaks). |

## 15. WebRTC transfer (RTC)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-RTC-001 | M | 0.1.1 | When a receiver opens WebRTC reception, the system shall create a room with a random six-character identifier and show it as a QR code and as text that can be copied or shared. |
| REQ-RTC-002 | M | 0.1.1 | When the sender scans or types the room identifier, the system shall join the room through serverless signalling (trystero) and connect the peers directly. |
| REQ-RTC-003 | M | 0.1.0 | When the peers are connected, the system shall show both users the same four-digit confirmation code. |
| REQ-RTC-004 | M | 0.1.1 | The system shall send each file with its name, size, type and SHA-256, and several files in sequence with a "file X of Y" counter. |
| REQ-RTC-005 | M | 0.1.4 | While transferring, the system shall show progress and speed. |
| REQ-RTC-006 | M | 0.1.1 | The system shall offer the Nostr, BitTorrent and MQTT signalling strategies, joined in parallel (the default) or one after another, and shall show which one connected. |
| REQ-RTC-007 | M | 0.1.1 | The system shall let the user enable, order and configure the relay addresses of each strategy and reset them to the defaults. |
| REQ-RTC-008 | M | 0.1.2 | The system shall let the user configure STUN servers and TURN servers (address, user name, credential) and shall pass them to every connection. |
| REQ-RTC-009 | M | 0.1.1 | If the peers do not connect within 30 seconds (10 seconds per strategy in sequential mode), then the system shall stop and report a failure. |
| REQ-RTC-010 | M | 0.1.1 | If the peer disconnects during a transfer, then the system shall report it. |
| REQ-RTC-011 | S | 0.1.1 | Where the address carries a room (`room=`, `offer=` or `peer=`), the system shall join it without scanning. |
| REQ-RELY-002 | M | 0.2.0 | When the two peers have joined through different signalling strategies, the system shall make both converge on the same strategy, whatever the join order. |
| REQ-RELY-006 | M | 0.2.0 | If the agreed strategy has not been announced within one second, then the system shall make the following peer fall back to its first strategy that is still alive. |
| REQ-RELY-007 | M | 0.2.0 | If a peer leaves a strategy before agreement, then the system shall mark that strategy dead without reporting an error. |
| REQ-RELY-008 | M | 0.2.0 | Where a single strategy is enabled, the system shall connect through it without negotiation. |
| REQ-RELY-012 | M | 0.2.0 | The system shall register the strategy announcement on every room as soon as it is created, under an action name of at most 12 bytes. |
| REQ-RELY-020 | M | 0.2.0 | When a WebRTC connection fails, the system shall classify the failure into a stable, translated diagnosis (relay likely required, TURN not working, peer unreachable, peer dropped, peer left, no strategy available, wrong room) with a confidence level, using a side-effect-free classifier. |
| REQ-RELY-021 | M | 0.2.0 | If the peer never joined and no network probe has run, then the system shall report the diagnosis as uncertain. |
| REQ-RELY-022 | M | 0.2.0 | When the peer never joined, the system shall diagnose a broken TURN server before a missing STUN response, and a missing STUN response without TURN as "relay likely required". |
| REQ-RELY-023 | M | 0.2.0 | When the peer left, the system shall diagnose "peer dropped" if the connection had failed and "peer left" otherwise. |
| REQ-RELY-040 | M | 0.2.0 | When the user tests the ICE servers, the system shall gather candidates for up to 10 seconds and report whether STUN answers, whether TURN is configured and whether it returns a relay address. |
| REQ-RELY-042 | M | 0.2.0 | The system shall probe ICE servers with standard W3C WebRTC interfaces only. |
| REQ-RELY-043 | M | 0.2.0 | The system shall probe exactly the ICE server list that a real connection would use. |
| REQ-RELY-045 | M | 0.2.0 | The system shall always close the probe connection, including after a timeout or an error. |
| REQ-RELY-046 | S | 0.2.0 | The system shall let tests substitute the peer connection used by the probe. |
| REQ-RELY-047 | M | 0.2.0 | The system shall run the ICE probe only after a failed connection, never in advance. |
| REQ-RELY-050 | M | 0.2.0 | The system shall ship no default TURN server. |
| REQ-RELY-051 | M | 0.2.0 | The system shall ship default STUN servers. |
| REQ-RELY-052 | S | 0.2.0 | When a failure suggests that a relay is required or that TURN is not working, the system shall offer a shortcut to the WebRTC settings and a collapsed block of connection details. |
| REQ-RELY-070 | M | 0.2.0 | The system shall compute strategy agreement with a pure function that does not change its input. |
| REQ-RELY-072 | M | 0.2.0 | The system shall make both peers agree when their announcements race over several rooms. |

## 16. Local discovery (DISC)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-DISC-001 | S | 0.4.0 | While local discovery is on, the system shall join a shared discovery room (`qrshare-local-discovery-v1`) on every enabled signalling strategy. |
| REQ-DISC-002 | S | 0.4.0 | The system shall describe the device by a peer identifier, an editable device name (default "&lt;browser&gt; on &lt;system&gt;") and a device type (desktop, mobile, tablet). |
| REQ-DISC-003 | S | 0.4.0 | While discovery is active, the system shall announce the device and send a heartbeat every 10 seconds. |
| REQ-DISC-004 | S | 0.4.0 | If no message has been received from a nearby device for 25 seconds, then the system shall remove it from the list. |
| REQ-DISC-005 | S | 0.4.0 | When the user sends to a nearby device, the system shall send it a transfer offer with the file name, size, content type and, where available, hash and encryption flag. |
| REQ-DISC-006 | S | 0.4.0 | When a transfer offer arrives, the system shall let the user accept or decline it. |
| REQ-DISC-007 | S | 0.4.0 | When an offer is accepted, the system shall carry the payload over a dedicated WebRTC room named after the offer. |
| REQ-DISC-008 | S | 0.4.0 | If an offer receives no answer within 30 seconds, then the system shall treat it as declined. |
| REQ-DISC-010 | S | 0.4.0 | While discovery is on, the system shall show a Nearby Devices card on the home screen. |
| REQ-DISC-011 | S | 0.4.0 | The system shall show each nearby device with its type icon, name, online status, fingerprint or trusted-contact mark, and a Send button. |
| REQ-DISC-012 | S | 0.4.0 | When the user selects Send on a nearby device, the system shall open the file picker and send the offer. |
| REQ-DISC-013 | S | 0.4.0 | When an offer arrives, the system shall show a prompt with the sender, file name and size, and whether the sender is verified. |
| REQ-DISC-020 | S | 0.4.0 | The system shall let the user set discovery to off (the default), passive (listen only) or active (announce). |
| REQ-DISC-021 | S | 0.4.0 | The system shall let the user edit the device name. |
| REQ-DISC-022 | S | 0.4.0 | When discovery is turned off, the system shall leave the discovery room and clear the nearby devices and offers. |
| REQ-DISC-030 | S | 0.4.0 | The system shall translate the discovery interface into English, French and Arabic. |

## 17. Collaborative editing (COLLAB)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-COLLAB-004 | S | 0.2.0 | When collaborative editing starts, the system shall reuse the already connected WebRTC room, without reconnecting. |
| REQ-COLLAB-005 | S | 0.2.0 | When either peer starts collaborative editing, the system shall open the shared editor on both devices. |
| REQ-COLLAB-010 | S | 0.2.0 | The system shall hold the shared text in a CRDT document (Yjs) so that both copies converge. |
| REQ-COLLAB-011 | S | 0.2.0 | When the local user edits the text, the system shall send the change to the peer as a minimal update. |
| REQ-COLLAB-012 | S | 0.2.0 | The system shall not send back to the network an update received from it. |
| REQ-COLLAB-013 | S | 0.2.0 | When both users edit concurrently, including the same region, the system shall merge the edits without losing any. |
| REQ-COLLAB-014 | S | 0.2.0 | The system shall converge to the same text on both devices whatever the order in which updates arrive. |
| REQ-COLLAB-015 | S | 0.2.0 | The system shall mirror the shared text into the editor reactively. |
| REQ-COLLAB-021 | S | 0.2.0 | When a peer joins or reconnects, the system shall exchange state vectors and send only the missing changes, version history included. |
| REQ-COLLAB-031 | S | 0.2.0 | If the peer leaves while editing, then the system shall keep the editor usable and show the peer as offline instead of failing. |
| REQ-COLLAB-032 | S | 0.2.0 | When the peer comes back during editing, the system shall show it as online and resynchronise. |
| REQ-COLLAB-033 | S | 0.4.0 | The system shall show who is in the session, each participant with a friendly compound name and a matching colour kept across visits. |
| REQ-COLLAB-040 | S | 0.2.0 | When a user saves a version with a non-empty label, the system shall add it to a version history shared with the peer. |
| REQ-COLLAB-041 | S | 0.2.0 | The system shall order versions by a logical (Lamport) clock with the site identifier as tie-break, never by wall-clock time, and shall keep the history append-only without duplicates. |
| REQ-COLLAB-042 | S | 0.2.0 | The system shall store a full snapshot of the text in each version. |
| REQ-COLLAB-043 | S | 0.4.0 | The system shall show each version with its label, author and logical time. |
| REQ-COLLAB-046 | S | 0.2.0 | When a user restores a version, the system shall apply it as a new edit, so that both devices converge on it. |
| REQ-COLLAB-050 | S | 0.2.0 | When the user exports a version as QR, the system shall send its text through the animated QR text transfer, labelled as a one-way snapshot. |
| REQ-COLLAB-051 | S | 0.2.0 | The system shall warn when the text exceeds 100,000 characters, like text sharing, without blocking input. |
| REQ-COLLAB-060 | S | 0.2.0 | The system shall keep the document and its version history in IndexedDB per room, so that a reload rejoins the same session. |
| REQ-COLLAB-063 | S | 0.2.0 | If IndexedDB is unavailable, then the system shall keep working without persistence. |
| REQ-COLLAB-070 | M | 0.2.0 | The system shall carry collaboration only over the encrypted peer-to-peer channel, with no additional server or secret. |
| REQ-COLLAB-080 | C | 0.4.0 | The system shall provide the collaboration engine as an interface-independent package (`@scelles/collab`) that other applications can use with the same protocol. |
| REQ-COLLAB-090 | C | Unreleased | The system shall let applications sync a shared document between devices without a network, by exchanging binary frames (hello, state vector, update) over any channel such as animated QR codes, as specified in the [offline sync protocol](collab-sync-protocol.md). |
| REQ-COLLAB-091 | C | Unreleased | Where a peer has been trusted through a signed hello frame, the system shall require its Ed25519 signature on every later frame and reject the frame otherwise. |
| REQ-COLLAB-092 | C | Unreleased | If a received sync frame is oversized, malformed, of an unknown version or type, or carries an invalid signature, then the system shall reject it before decoding its content and log the reason. |
| REQ-COLLAB-093 | C | Unreleased | When a sync update is received, the system shall apply it to an isolated copy first and change the document only after the application has validated that copy and the user has accepted it. |
| REQ-COLLAB-094 | C | Unreleased | The system shall log every received sync frame with its sender, trust, size and result (applied, unchanged, refused, rejected). |

## 18. System sharing and app handoff (SHARE)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-SHARE-001 | M | 0.1.1 | Where the browser supports the Web Share API, the system shall share one or more files, or a text, through the native share dialog. |
| REQ-SHARE-002 | M | 0.1.4 | If the native share dialog is unavailable for text, then the system shall copy the text to the clipboard instead. |
| REQ-SHARE-003 | M | 0.1.1 | If the user cancels the share dialog, then the system shall not report an error. |
| REQ-SHARE-004 | M | 0.1.1 | The system shall offer to share received files, created codes and scanned content to other applications. |
| REQ-HANDOFF-001 | S | 0.4.0 | When another application shares a file or a text with QRShare (Web Share Target), the system shall open the transfer chooser with that file, or the QR sender with that text. |
| REQ-HANDOFF-002 | S | 0.4.0 | When an application opens `#/send?handoff=1`, the system shall announce that it is ready to its opener, accept one file from it, confirm reception and open the transfer chooser, sending nothing before the user picks a mode. |
| REQ-HANDOFF-003 | S | 0.4.0 | If a handoff message is malformed, comes from a window other than the opener, or carries more than 200 MB, then the system shall ignore it. |
| REQ-HANDOFF-004 | S | 0.4.0 | Where the receive screen was opened with a `return` web address, the system shall offer an Open in &lt;host&gt; button that delivers the received file to that address's origin only. |
| REQ-HANDOFF-005 | S | 0.4.0 | The system shall advertise the handoff protocol versions and optional features it supports in its web app manifest (`qrshare_handoff.versions`, `qrshare_handoff.features`). |
| REQ-HANDOFF-006 | S | Unreleased | Where an application hands a file over with a send mode (`mode=animated-qr`, `cimbar`, `webrtc` or `share`, protocol version 2), the system shall go straight to that mode once the file is received, when the policy allows it, instead of showing the chooser. |
| REQ-HANDOFF-007 | S | Unreleased | Where the receive screen was opened with `reply=opener` (protocol version 2), when the user selects Open in &lt;host&gt;, the system shall post the received file back to the window that opened QRShare, to the origin of the `return` address only, and fall back to opening a new window if that window is gone. |
| REQ-HANDOFF-008 | S | 0.4.0 | If no file arrives within 30 seconds of the handoff, or no answer within 60 seconds of an Open in &lt;host&gt; delivery, then the system shall report a timeout. |

## 19. Not planned for now (W)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-PLAN-001 | W | — | The system shall keep a local history of sent and received transfers. |
| REQ-PLAN-002 | W | — | When the user drops a file anywhere on the home screen, the system shall open the sender with it. |
| REQ-PLAN-003 | W | — | When the user pastes an image or text into the sender, the system shall use it as the content. |
| REQ-PLAN-004 | W | — | The system shall export an animated QR transfer as GIF or video. |
| REQ-PLAN-005 | W | — | Where WebRTC is used, the system shall add application-level end-to-end encryption based on the device identities. |
| REQ-PLAN-006 | W | — | The system shall broadcast a transfer to several receivers in one room. |

See the [roadmap](https://github.com/s-celles/QRShare/blob/main/ROADMAP.md) for the ideas behind these entries.

## 20. Known deviations

None known. The deviations found while rebuilding this specification were fixed
in the next release (*Unreleased*):

- **REQ-SEC-008** — contact encryption failed end to end: identity QR codes
  carried no encryption key, and the receiver read the sender fingerprint with
  its padding. Identity codes made before the fix carry no encryption key:
  scan the contact's identity again to update it.
- **REQ-QRX-004** — the 16-bit block count wrapped around for large transfers;
  it now saturates.
- **REQ-QRX-003** — the frame rate chosen before starting was ignored.
- **REQ-RTC-004** — a file handed over from another view was announced as
  `image/png`.
- **REQ-I18N-001 / REQ-I18N-005** — 70 Arabic texts were missing, and some keys
  existed in no language, so their identifiers were shown; the vCard and file
  previews had hard-coded labels.
- **REQ-PLT-013** — the packaging script claimed to inline the WebAssembly
  runtimes; the requirement and the documentation now describe what it does.
- **REQ-DISC-001 / REQ-DISC-020** — the original discovery specification named
  the room `qrshare-discovery-v1` and enabled discovery by default; this
  specification adopts the code's `qrshare-local-discovery-v1` and off by default.
