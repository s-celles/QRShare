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
| REQ-PLT-004 | M | 0.1.0 | When the service worker installs, the system shall precache the application shell, the manifest, the icons (including the maskable and shortcut icons) and the CIMBAR runtime files. |
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
| REQ-PLT-017 | S | Unreleased | The system shall declare in its web app manifest a stable `id` equal to the deployed start URL path (`/QRShare/`), its scope, language and text direction, orientation `any`, categories, separate maskable 192 px and 512 px icons with the artwork inside the safe zone, wide and narrow labelled screenshots, and shortcuts to the scanner, the QR creator and the QR sender and receiver. |
| REQ-PLT-018 | S | Unreleased | The system shall open each launch of the installed app (shortcut, shared content, start) in a new window (`launch_handler` `navigate-new`), so that a transfer running in another window is never replaced. |

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
| REQ-DOC-001 | S | 0.4.0 | When the user opens About, the system shall show a window with the logo and description, version (linked to the changelog), commit (linked to the source), build date, author (linked to their GitHub profile), licence, whether the app is installed and whether it works offline. |
| REQ-DOC-002 | S | 0.4.0 | The system shall show in the About window a QR code of the application address, and shall show it full screen when the user activates it. |
| REQ-DOC-003 | S | 0.4.0 | When the user selects Copy details in the About window, the system shall copy the version, build, address, browser, language, installed and offline states for a bug report. |
| REQ-DOC-004 | S | 0.4.0 | The system shall link from the About window to the documentation, the requirements, the source code, the changelog and the issue tracker, and shall show a privacy note, credits and a disclaimer. |
| REQ-DOC-005 | S | 0.1.1 | The system shall show the user guide in the app, in English or French according to the interface language. |
| REQ-DOC-006 | S | 0.6.0 | The system shall show every page of the `docs/` folder in the app (`#/docs`), with an index, a page menu, tables, code and Mermaid diagrams. |
| REQ-DOC-007 | S | 0.6.0 | When the user follows a link between documentation pages, the system shall stay in the app; external links shall open in a new tab. |
| REQ-DOC-008 | S | 0.6.0 | Where a documentation address names a language (`&lang=`) or a section (`&section=`), the system shall show that translation and scroll to that heading, headings having GitHub-compatible anchors. |
| REQ-DOC-009 | S | 0.6.0 | If a documentation page has no translation in the interface language, then the system shall show the English page with a note. |
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
| REQ-STRUCT-007 | S | 0.6.0 | When scanned or received text is a FIDO hybrid sign-in code (`FIDO:/` followed by digits encoding the CTAP 2.2 hybrid data), the system shall show a passkey card with the request (sign in or create a passkey) and the code's creation time, explaining that the code must be scanned by the phone holding the passkey, near the computer. |
| REQ-STRUCT-008 | S | 0.6.0 | If a passkey code was created more than five minutes earlier, then the system shall warn that it has most likely expired. |
| REQ-STRUCT-009 | S | 0.6.0 | The system shall not offer to copy, share, save or send on a passkey code, and shall warn the user never to forward it to another person or device. |
| REQ-STRUCT-010 | C | 0.6.0 | Where the operating system handles passkey codes, the system shall offer to hand the scanned code to it. |
| REQ-STRUCT-011 | S | 0.6.0 | If a code starting with `FIDO:/` is not a well-formed hybrid code, then the system shall show it as plain text. |

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

## 13a. Audio transfer (AUD)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-AUD-001 | C | 0.6.0 | The system shall offer an experimental audio send mode, treated as an air-gapped mode. |
| REQ-AUD-002 | C | 0.6.0 | Where the content is at most 8 KiB, the system shall offer audio under every transfer policy; above 8 KiB it shall not offer it. |
| REQ-AUD-003 | C | 0.6.0 | The system shall recommend audio only when no camera is detected and the content is at most 1 KiB. |
| REQ-AUD-004 | C | 0.6.0 | Where audio is offered in the transfer chooser or the transfer preparation, the system shall describe it as suitable up to 1 KiB, or as slow above, with the estimated duration for the Robust profile. |
| REQ-AUD-005 | C | 0.6.0 | The system shall provide the routes `#/send/audio` and `#/receive/audio`. |
| REQ-AUD-006 | C | 0.6.0 | The system shall build the audio receiver invitation as `#/receive/audio?policy=<policy>`. |
| REQ-AUD-007 | C | 0.6.0 | When the user picks audio in the transfer chooser or the transfer preparation, the system shall hand the selected text or file to the audio sender. |
| REQ-AUD-008 | C | 0.6.0 | The system shall show an Audio (Experimental) group with send and receive actions on the home screen, after the CIMBAR group. |
| REQ-AUD-009 | C | 0.6.0 | The system shall label every audio screen and option as experimental. |
| REQ-AUD-010 | C | 0.6.0 | When the audio sender opens with handed-over content, the system shall preload it; otherwise it shall offer a file or text input. |
| REQ-AUD-011 | C | 0.6.0 | If the content to send by audio exceeds 8 KiB, then the system shall refuse it and suggest animated QR codes or CIMBAR. |
| REQ-AUD-012 | C | 0.6.0 | When content is loaded in the audio sender, the system shall hash, compress and fountain-encode it and show the compressed size, the number of blocks and the estimated minimum duration. |
| REQ-AUD-013 | C | 0.6.0 | The system shall let the sender choose the Robust (default) or Fast profile, and Ultrasonic under Advanced. |
| REQ-AUD-014 | C | 0.6.0 | When the user presses Play, the system shall start audio output, and not before. |
| REQ-AUD-015 | C | 0.6.0 | While playing, the system shall emit packets back to back, each with a new fountain symbol, until the user stops. |
| REQ-AUD-016 | C | 0.6.0 | While playing, the system shall send a metadata packet first and then after every 8 data packets. |
| REQ-AUD-017 | C | 0.6.0 | While playing, the system shall show the packets sent, the unique symbols sent against those needed, the elapsed time and the net bit rate. |
| REQ-AUD-018 | C | 0.6.0 | The system shall advise a media volume of 70–100%, devices 10–50 cm apart, a quiet room and no Bluetooth speaker. |
| REQ-AUD-019 | C | 0.6.0 | While playing, the system shall keep the screen awake where supported and ask for playback audio that ignores the silent switch where supported. |
| REQ-AUD-020 | C | 0.6.0 | When the user stops or leaves the audio sender, the system shall stop every scheduled sound and close the audio context. |
| REQ-AUD-021 | C | 0.6.0 | Where the user enables password encryption on the audio sender, the system shall encrypt the content with AES-256-GCM before sending it. |
| REQ-AUD-022 | C | Unreleased | Where the audio sender uses a password, the system shall encrypt the transfer metadata (file name, size, SHA-256, content type, fountain parameters) and use a random transfer identifier. |
| REQ-AUD-023 | C | Unreleased | Where the audio sender uses a password, the system shall pad the encrypted content to a multiple of 256 bytes. |
| REQ-AUD-024 | C | Unreleased | When the audio receiver detects an encrypted transfer without a password, the system shall ask for it and keep listening and buffering packets meanwhile. |
| REQ-AUD-025 | C | Unreleased | If the password does not decrypt the transfer metadata, then the system shall report a wrong password at once and accept a corrected one without restarting. |
| REQ-AUD-030 | C | 0.6.0 | When the user starts listening, the system shall open the microphone mono without echo cancellation, noise suppression or automatic gain control. |
| REQ-AUD-031 | C | 0.6.0 | If microphone access is denied or unavailable, then the system shall explain how to grant it. |
| REQ-AUD-032 | C | 0.6.0 | When the audio receiver is opened with `autostart=1`, the system shall start listening, or show a prominent tap-to-start button if the browser requires a gesture. |
| REQ-AUD-033 | C | 0.6.0 | While listening, the system shall show the input level and indicate too-quiet input, clipping and a detected signal. |
| REQ-AUD-034 | C | 0.6.0 | While listening, the system shall show the detected profile, decoded and rejected packets, unique symbols against those needed, the elapsed time and the effective rate. |
| REQ-AUD-035 | C | 0.6.0 | The system shall detect the sender's audio profile from the packet preamble. |
| REQ-AUD-036 | C | 0.6.0 | When the audio receiver hears its first valid packet, the system shall lock onto that transfer and ignore other transfers, but follow the same content re-sent with another profile or codec. |
| REQ-AUD-037 | C | 0.6.0 | When data packets arrive before the metadata, the system shall buffer up to 4096 of them and decode them once the metadata arrives. |
| REQ-AUD-038 | C | 0.6.0 | The system shall ignore duplicate and wrong-size audio symbols. |
| REQ-AUD-039 | C | 0.6.0 | When enough audio packets are received, the system shall rebuild, decompress and verify the content with SHA-256, then release the microphone. |
| REQ-AUD-040 | C | 0.6.0 | When an audio transfer completes, the system shall show the result like the other receivers: summary, text or file with preview, download, share, open in the calling app, unlock of encrypted content, and the hash warning. |
| REQ-AUD-050 | C | 0.6.0 | The system shall modulate audio as multi-tone FSK, each tone carrying 4 bits in its channel's band. |
| REQ-AUD-051 | C | 0.6.0 | The system shall define the Robust (1.5–6.3 kHz, 60 ms symbols), Fast (1.5–6.3 kHz, 30 ms symbols) and Ultrasonic (18.5–19.74 kHz, 2 tones at a time at half level since Unreleased, 75 ms symbols, less reliable) profiles. |
| REQ-AUD-052 | C | 0.6.0 | The system shall shape every symbol with a guard interval and raised-cosine edge ramps of at least 2 ms. |
| REQ-AUD-053 | C | 0.6.0 | The system shall start every audio packet with a tapered linear chirp unique to its profile. |
| REQ-AUD-054 | C | 0.6.0 | The system shall modulate packets deterministically with a peak amplitude of at most 0.9. |
| REQ-AUD-055 | C | 0.6.0 | The system shall detect preambles by gain-independent normalised correlation and decode tones with the Goertzel algorithm. |
| REQ-AUD-056 | C | 0.6.0 | The system shall work at sample rates from 22.05 to 96 kHz, between devices with different rates, Ultrasonic requiring at least 44.1 kHz. |
| REQ-AUD-057 | C | 0.6.0 | The system shall mark unreliable demodulated bytes as erasures for the error-correcting code. |
| REQ-AUD-070 | C | 0.6.0 | The system shall protect each audio packet with a Reed-Solomon coded header and a Reed-Solomon coded body ending with a CRC32. |
| REQ-AUD-071 | C | 0.6.0 | The system shall carry in each audio data packet the transfer id, a 16-bit symbol id and one fountain symbol. |
| REQ-AUD-072 | C | 0.6.0 | The system shall carry the transfer metadata in audio metadata packets as a protocol v3 frame header. |
| REQ-AUD-073 | C | 0.6.0 | If a file name is too long for an audio metadata packet, then the system shall shorten its stem on a character boundary and keep its extension. |
| REQ-AUD-074 | C | 0.6.0 | If an audio packet fails Reed-Solomon decoding or its CRC32, then the system shall count it as rejected and drop it. |
| REQ-AUD-075 | C | 0.6.0 | The system shall encode audio transfers with Wirehair by default and flag the codec in the metadata so the receiver uses the same one. |
| REQ-AUD-076 | C | 0.6.0 | If the receiver cannot load the codec flagged by the sender, then the system shall suggest choosing LT (compatibility) on the sender. |
| REQ-AUD-077 | C | 0.6.0 | The system shall keep at least two source blocks for small audio payloads by shrinking the block size. |
| REQ-AUD-078 | C | 0.6.0 | If an audio packet has an unknown version, then the system shall ignore it and log a warning. |
| REQ-AUD-090 | C | 0.6.0 | The system shall load the audio capture worklet from an inline source, adding no static file. |
| REQ-AUD-091 | C | 0.6.0 | If the audio worklet is unavailable, then the system shall capture with a ScriptProcessor instead. |
| REQ-AUD-092 | C | 0.6.0 | The system shall implement audio transfer with no new runtime dependency. |
| REQ-AUD-093 | C | 0.6.0 | The system shall demodulate one second of audio in less than 100 ms on the test machine. |
| REQ-AUD-110 | C | 0.6.0 | The system shall keep the audio modem, packet layer and sessions free of DOM and Web Audio dependencies. |
| REQ-AUD-111 | C | 0.6.0 | The system shall decode its own modulated packets exactly for every profile at 44.1 and 48 kHz. |
| REQ-AUD-112 | C | 0.6.0 | The system shall decode audio packets through noise, gain changes, offsets, reverberation and resampling in its loopback tests. |
| REQ-AUD-113 | C | 0.6.0 | The system shall rebuild a file sent through audio with 30% of the packets lost, with both codecs. |
| REQ-AUD-120 | C | 0.6.0 | The system shall provide the audio texts in English and French, Arabic showing them in English for now. |

## 13b. Audio sessions (ALS)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-ALS-001 | C | Unreleased | When the user creates an audio session, the system shall pick random room and member ids, a P-256 key pair, a group key and a name, and announce the session with beacons while it accepts members. |
| REQ-ALS-002 | C | Unreleased | While joining an audio session, the system shall list the sessions heard and, when the user picks one, repeat a join request until welcomed. |
| REQ-ALS-003 | C | Unreleased | When the host receives a join request, the system shall answer with the group key and member list encrypted with the key derived by ECDH P-256 and HKDF between host and joiner. |
| REQ-ALS-004 | C | Unreleased | The system shall show on every member the same 4-digit verification code, computed from the group key, the host public key and the member list. |
| REQ-ALS-005 | C | Unreleased | If a welcome lists a key for this device that is not its own, then the system shall refuse it and warn of a possible interception. |
| REQ-ALS-006 | C | Unreleased | When membership changes, the system shall broadcast the member list and update the verification code. |
| REQ-ALS-007 | C | Unreleased | The system shall ignore packets of other sessions and its own packets. |
| REQ-ALS-010 | C | Unreleased | The system shall encrypt every audio session packet after joining with AES-256-GCM under the group key, with a unique nonce and the clear header as associated data. |
| REQ-ALS-011 | C | Unreleased | The system shall send audio session chat messages of up to 180 UTF-8 bytes in one packet. |
| REQ-ALS-012 | C | Unreleased | The system shall number reliable session messages per sender and drop duplicates. |
| REQ-ALS-013 | C | Unreleased | The system shall acknowledge session messages with presence packets listing, per member, the highest contiguous message number received. |
| REQ-ALS-014 | C | Unreleased | If a session message is not acknowledged by every member, then the system shall resend it up to 6 times, then mark it as not delivered. |
| REQ-ALS-015 | C | Unreleased | The system shall show, per session message, how many members received it. |
| REQ-ALS-016 | C | Unreleased | When a session member has been silent for 75 seconds, the system shall show it as away. |
| REQ-ALS-017 | C | Unreleased | When the user leaves an audio session, the system shall send a leave message. |
| REQ-ALS-020 | C | Unreleased | The system shall transmit in an audio session only after the channel has been quiet for a guard time and a random back-off, giving up its turn when a signal appears. |
| REQ-ALS-030 | C | Unreleased | The system shall send a file in an audio session as a sealed transfer whose password derives from the group key. |
| REQ-ALS-031 | C | Unreleased | While sending a session file, the system shall pause after each metadata packet and stop once every member reported the file as received. |
| REQ-ALS-032 | C | Unreleased | When a member completes a session file, the system shall report it and show the file in the conversation. |
| REQ-ALS-040 | C | Unreleased | The system shall offer an experimental audio session screen with create and join, verification code, members, conversation with delivery marks, message input, file sending and leave. |
| REQ-ALS-042 | C | Unreleased | The system shall estimate the transmission time of a session message while it is typed, of a session file when it is sent, and of each profile on the session start screen. |
| REQ-ALS-041 | C | Unreleased | The system shall provide the audio session texts in English and French, Arabic showing them in English for now. |

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

## 16a. Paste board (PASTE)

| ID | Pri | Since | Requirement |
|----|-----|-------|-------------|
| REQ-PASTE-001 | C | Unreleased | When the user creates a board, the system shall generate a random 80-bit room secret and show it as a 16-character room code (Crockford base32, four groups of four) and as a QR code of the link `<app URL>#/paste?k=<code>`. |
| REQ-PASTE-002 | C | Unreleased | When the user enters a room code, or opens or scans a paste-board link, the system shall normalise the code (case, separators, `I/L→1`, `O→0`), reject it if malformed, and join the board. |
| REQ-PASTE-003 | C | Unreleased | When a paste-board link is opened, the system shall remove the secret from the address bar (`history.replaceState`) once it has been read. |
| REQ-PASTE-004 | C | Unreleased | The system shall derive, from the room secret only, the signaling room id, the signaling password, the content key and the room tag (HKDF-SHA256 with distinct labels), and shall never send the room secret itself over the network. |
| REQ-PASTE-005 | C | Unreleased | The system shall join the board through every configured signaling strategy at once, with the relays and ICE servers of the WebRTC settings and its own application id (`qrshare-paste-v1`). |
| REQ-PASTE-006 | C | Unreleased | While in a board, the system shall show the number of connected peers and the room code / QR code on demand. |
| REQ-PASTE-007 | C | Unreleased | When the user leaves the board, closes the page or cancels a join still connecting, the system shall leave every signaling room, revoke every `blob:` URL it created and drop the board, attachments, keys and proofs from memory, and shall run at most one join at a time. |
| REQ-PASTE-010 | C | Unreleased | When the user enters a board, the system shall generate a new non-extractable Ed25519 key pair kept in memory only, unrelated to the persistent identity, the contacts and the local-discovery fingerprint. |
| REQ-PASTE-011 | C | Unreleased | The system shall show each author as a pseudonym and colour derived from the fingerprint of its public key (not sent as free text), followed by the 8-hex-digit fingerprint. |
| REQ-PASTE-012 | C | Unreleased | When the user posts a paste, the system shall sign, with the session key, a statement made of the room tag, the public key, the timestamp read from the device clock, the format, the source text and the attachment list. |
| REQ-PASTE-013 | C | Unreleased | If a received paste has an invalid signature, a room tag other than this board's, or a malformed encoding, then the system shall drop it without showing it. |
| REQ-PASTE-014 | C | Unreleased | The system shall show each paste's declared timestamp labelled as declared by the author (from the author's device clock, unverified), together with the time this device received it. |
| REQ-PASTE-015 | C | Unreleased | If a declared timestamp is more than 5 minutes ahead of this device's clock, then the system shall flag the paste as dated in the future. |
| REQ-PASTE-016 | C | Unreleased | The system shall mark the user's own pastes as such. |
| REQ-PASTE-020 | C | Unreleased | The system shall let the author choose, per paste, plain text or Markdown (Markdown by default), and record the choice in the signed statement. |
| REQ-PASTE-021 | C | Unreleased | The system shall sign the source exactly as written: UTF-8 without BOM, line endings normalised to LF in the composer, no Unicode normalisation. |
| REQ-PASTE-022 | C | Unreleased | The system shall show plain-text pastes as preformatted text, keeping line breaks. |
| REQ-PASTE-023 | C | Unreleased | The system shall show Markdown pastes rendered, with a toggle between the rendered view and the source, and a "Copy source" action available in both views. |
| REQ-PASTE-024 | C | Unreleased | When rendering Markdown from a paste, the system shall show raw HTML as text and emit no element, attribute or URL scheme outside the allow-list of the design (no `script`, `style`, `iframe`, `object`, event-handler attributes, `style` attributes, heading ids or Mermaid blocks). |
| REQ-PASTE-025 | C | Unreleased | The system shall make links clickable only for `http:`, `https:` and `mailto:` URLs, opening them in a new tab with `rel="noopener noreferrer"` and `referrerpolicy="no-referrer"`, and shall show any other link (e.g. `javascript:`, `data:`, `blob:`, `file:`, relative or in-app addresses) as plain text. |
| REQ-PASTE-026 | C | Unreleased | The system shall never load a remote image automatically: a Markdown image whose source is not an `attachment:` reference shall be shown as a link chip naming the remote host, opened only on click as in REQ-PASTE-025. |
| REQ-PASTE-027 | C | Unreleased | If the sanitised output fails the allow-list check, then the system shall show the paste source instead of the rendered view. |
| REQ-PASTE-028 | C | Unreleased | The system shall offer a preview of the Markdown being written, through the same renderer. |
| REQ-PASTE-030 | C | Unreleased | The system shall let the author attach files with a file picker, by pasting from the clipboard and by drag and drop, and, in a Markdown paste, insert `![alt](attachment:<sha256>)` for an image and `[name](attachment:<sha256>)` for another file at the caret. |
| REQ-PASTE-031 | C | Unreleased | When the author attaches a PNG, JPEG, WebP or GIF image (detected from its bytes), the system shall decode it, apply its orientation, downscale it to at most 2048 px on the longest side, re-encode it (WebP, or PNG/JPEG where WebP encoding is unavailable; GIF keeps its first frame only), then remove any remaining metadata chunk, so that no EXIF, GPS, XMP, ICC profile or text chunk leaves the device. |
| REQ-PASTE-032 | C | Unreleased | The system shall attach SVG files and any other non-raster file unchanged, as files, never as images. |
| REQ-PASTE-033 | C | Unreleased | When the author attaches a file that is not re-encoded, the system shall warn that it may carry identifying metadata (e.g. PDF or office document author, camera data in videos) that the system does not remove. |
| REQ-PASTE-034 | C | Unreleased | The system shall identify an attachment by the SHA-256 of its bytes and list, in the signed statement, for each attachment its hash, size, declared MIME type, sanitised file name and, for images, width and height. |
| REQ-PASTE-035 | C | Unreleased | The system shall sanitise attachment file names: drop path components, control characters, bidirectional-override and invisible formatting characters and the characters `<>:"/\\|?*`, trim leading dots and trailing dots and spaces, avoid Windows reserved names, limit the name to 100 UTF-8 bytes keeping the extension, and fall back to `attachment`. |
| REQ-PASTE-036 | C | Unreleased | When a paste is accepted, the system shall request its missing attachments by hash from the peer that sent it, then from other peers holding the paste, and shall accept an attachment only if its SHA-256 and size match the signed list. |
| REQ-PASTE-037 | C | Unreleased | The system shall answer an attachment request only for hashes listed by a paste on its board. |
| REQ-PASTE-038 | C | Unreleased | The system shall keep attachments in memory only, encrypt them like every other frame (REQ-PASTE-060), and show an attachment that no connected peer can supply as unavailable. |
| REQ-PASTE-039 | C | Unreleased | The system shall decide how to show an attachment from its magic bytes only, never from the declared MIME type or the file name. |
| REQ-PASTE-040 | C | Unreleased | The system shall show inline, as `<img>` from a `blob:` URL typed with the sniffed MIME type, only attachments sniffed as PNG, JPEG, WebP or GIF whose header size is at most 2048 × 2048 pixels and equal to the size in the signed statement (for GIF, with a first frame within the logical screen), and shall show other images as download chips. |
| REQ-PASTE-041 | C | Unreleased | Where an attachment is sniffed as MP3, Ogg, WAV, WebM or MP4, the system shall show it as a download chip with a Play button that, on click, creates an `<audio>`/`<video controls>` element with `preload="none"` and no autoplay. |
| REQ-PASTE-042 | C | Unreleased | The system shall show every other attachment — including SVG, HTML, PDF, office documents, archives and executables — only as a download chip (icon, name, size, declared type, short hash), never rendered, previewed or opened in the application. |
| REQ-PASTE-043 | C | Unreleased | When the user downloads an attachment, the system shall save it from a `blob:` URL of type `application/octet-stream` with the sanitised name and the `download` attribute, and shall never navigate to or open an attachment `blob:` URL. |
| REQ-PASTE-044 | C | Unreleased | Where an attachment name has an executable or script extension (list in the design), the system shall show a warning on the chip and ask for confirmation before downloading. |
| REQ-PASTE-045 | C | Unreleased | If an `attachment:` reference in a paste is not in its signed list, then the system shall render it as a broken-reference placeholder; listed attachments that the text does not reference shall be shown below the paste. |
| REQ-PASTE-050 | C | Unreleased | The system shall keep the board and attachments in memory only and shall never write pastes, attachments, keys or proofs to localStorage, IndexedDB, the service-worker cache or any server. |
| REQ-PASTE-051 | C | Unreleased | When a peer joins, the system shall send it the list of paste ids it holds; the peer shall request the pastes it misses and receive them, with their proofs. |
| REQ-PASTE-052 | C | Unreleased | When the user posts a paste, the system shall send it to every connected peer. |
| REQ-PASTE-053 | C | Unreleased | While in a board, the system shall send every 20 seconds a digest of its paste ids, and when a peer's digest differs, exchange id lists with it, so that peers that are not directly connected to each other still converge. |
| REQ-PASTE-054 | C | Unreleased | The system shall identify a paste by the SHA-256 of its signed statement and ignore duplicates. |
| REQ-PASTE-055 | C | Unreleased | The system shall show the board ordered by declared timestamp, newest first, ties broken by paste id. |
| REQ-PASTE-056 | C | Unreleased | The system shall state on the board screen that content disappears once no connected peer holds it, and that participants can still copy or export it while they see it. |
| REQ-PASTE-060 | C | Unreleased | The system shall encrypt every board frame, attachments included, with AES-256-GCM under the content key, a random 96-bit nonce and the frame header as associated data. |
| REQ-PASTE-061 | C | Unreleased | If a frame fails to decrypt or to parse, then the system shall drop it and count a strike against the sending peer. |
| REQ-PASTE-062 | C | Unreleased | The system shall use the derived signaling password for trystero's signaling encryption, so that relays see neither the room secret, nor the content key, nor the content. |
| REQ-PASTE-070 | C | Unreleased | The system shall limit the source of a paste to 16 KiB of UTF-8 and refuse longer input in the composer with a byte counter. |
| REQ-PASTE-071 | C | Unreleased | The system shall limit a paste to 4 attachments, a re-encoded image to 1.5 MiB and any other attachment to 5 MiB. |
| REQ-PASTE-072 | C | Unreleased | The system shall hold at most 500 pastes, 4 MiB of source text and 32 MiB of attachments per board, counting attachment bytes when they arrive; when a limit is reached it shall refuse new pastes or attachments (local and remote) and say so, without evicting older ones. |
| REQ-PASTE-073 | C | Unreleased | The system shall accept at most 50 pastes and 8 MiB of attachments per author key per board. |
| REQ-PASTE-074 | C | Unreleased | The system shall let the user post at most one paste every 3 seconds. |
| REQ-PASTE-075 | C | Unreleased | The system shall drop, before decryption, control frames larger than 64 KiB, attachment frames larger than the attachment limit plus 1 KiB, frames already received from the same peer (same nonce) and frames exceeding a per-peer budget (control: burst of 200 frames, 20 per second; pastes and proofs: burst of 8 MiB, 1 MiB per second; attachments: burst of 10 MiB, 2 MiB per second; at most 4 attachment requests in flight per peer), and shall answer a paste request once per id, not again to the same peer within 15 seconds, within an outbound budget of 8 MiB burst and 1 MiB per second per peer. |
| REQ-PASTE-076 | C | Unreleased | When a peer reaches 5 strikes (undecryptable, malformed or invalidly signed frames, invalid proofs, or attachments whose hash does not match), the system shall ignore that peer's frames for the rest of the session and show the number of ignored peers; the system shall request at most as many pastes as the board has free places, give each connected peer an equal share of them, and when a request is not answered within 15 seconds ask another peer that advertised the paste, without counting a strike. |
| REQ-PASTE-080 | C | Unreleased | When the user asks to timestamp a paste for the first time in a session, the system shall explain what is sent (a blinded hash, the IP address, the time of the request) and to whom, and proceed only after confirmation. |
| REQ-PASTE-081 | C | Unreleased | When the user timestamps a paste, the system shall take the paste id (SHA-256 of the signed statement), append a random 16-byte nonce, hash it again, and submit only that 32-byte digest to the configured calendar servers in parallel, never the content. |
| REQ-PASTE-082 | C | Unreleased | The system shall build a standard detached `.ots` proof (OpenTimestamps format, SHA-256 file hash) of the statement file `paste-<id>.statement`, so that `ots verify paste-<id>.statement.ots` works on it. |
| REQ-PASTE-083 | C | Unreleased | If no calendar answers within 10 seconds, then the system shall report the failure; if only one answers, it shall keep the proof and say that a single calendar holds it. |
| REQ-PASTE-084 | C | Unreleased | When the author of a paste creates or upgrades a proof of it, the system shall merge it with the shared proof, sign the result with the author's session key over a domain-separated message (label, room tag, paste id, a sequence number higher than any it shared before, SHA-256 of the proof) and share it with the room; when another participant creates or upgrades a proof, the system shall keep it on that device only (shown, downloaded and exported there, never sent); when a proof is received, the system shall reject it with a strike unless it carries a valid signature of the paste's author, shall count the sender as holding the paste only after that check, shall ignore it unless its sequence is higher than that of the author's proof it holds, its file digest equals the paste id, it parses within the limits, it has no unknown attestation or unsupported operation, and it has at most 32 attestations, 8 pending calendars and 8 Bitcoin attestations, shall merge it with the author's proof it holds as a union without removing any attestation, replacing the held proof without a strike when the union would exceed the limits, and shall relay the author-signed proof unchanged to the other peers; calendars outside the allow-list in proofs made on the device or signed by the author shall be shown but never contacted. |
| REQ-PASTE-085 | C | Unreleased | The system shall show for each paste its proof status: none, being stamped, or side by side the pending calendars, the Bitcoin heights claimed but not verified and the heights whose block was checked (with block time), and shall offer Upgrade while an allow-listed calendar is pending, whatever Bitcoin attestations the proof carries. |
| REQ-PASTE-086 | C | Unreleased | The system shall let the user download the statement (`paste-<id>.statement`), its signature (`paste-<id>.statement.sig`), its proof (`paste-<id>.statement.ots`) and the source (`paste-<id>.md` or `.txt`). |
| REQ-PASTE-087 | C | Unreleased | The system shall state that a proof shows that the statement — source, attachment hashes, author key and declared time — existed no later than the anchoring block, and says nothing about who wrote it nor whether the declared time is true. |
| REQ-PASTE-090 | C | Unreleased | When the user asks to upgrade a pending proof, the system shall query each pending calendar for the completed path, graft it into the proof and drop that calendar's own pending attestation once the path it supplied reaches a Bitcoin attestation; an unreachable or not-yet-ready calendar leaves it pending. |
| REQ-PASTE-091 | C | Unreleased | The system shall contact only calendars on its allow-list when upgrading — the exact hosts `alice.btc.calendar.opentimestamps.org`, `bob.btc.calendar.opentimestamps.org`, `finney.calendar.eternitywall.com`, `a.pool.opentimestamps.org` and `b.pool.opentimestamps.org`, over https — and show other calendar addresses found in a proof without contacting them. |
| REQ-PASTE-092 | C | Unreleased | The system shall offer a "Check a proof" tool, usable without joining a board, that takes a statement file and its `.ots` proof (and optionally attachment files), checks the digest, the signature and the attachment hashes, shows the source, author fingerprint and declared time, replays the proof operations locally, upgrades it, and lets the user download the upgraded proof. |
| REQ-PASTE-093 | C | Unreleased | When the user asks to check a Bitcoin attestation, the system shall fetch the block header at that height from the configured block explorer and compare its Merkle root with the proof's commitment, and shall say that this check trusts the explorer and that `ots verify` with one's own Bitcoin node is the trust-minimised verification. |
| REQ-PASTE-094 | C | Unreleased | If a proof uses an operation or attestation the system does not support, then the system shall show it as unsupported and point to `ots verify`. |
| REQ-PASTE-100 | C | Unreleased | When the user exports the board, the system shall produce a Markdown document listing the pastes in chronological order (declared timestamp ascending, ties by paste id). |
| REQ-PASTE-101 | C | Unreleased | The system shall start each paste in the export with a header giving the author pseudonym and fingerprint, the declared timestamp in ISO 8601 UTC marked as self-declared, the format, the paste id, the source SHA-256, the signature status, the OpenTimestamps status (none, pending, Bitcoin block claimed but not verified, or confirmed with block height once checked against a block explorer) and the attachments (name, size, type, SHA-256). |
| REQ-PASTE-102 | C | Unreleased | The system shall embed Markdown pastes as block quotes whose raw HTML is escaped, and plain-text pastes as fenced code blocks whose fence is longer than any backtick run of the content, so that no paste can alter the structure of the export or forge a paste header. |
| REQ-PASTE-103 | C | Unreleased | The system shall never include the room code, the room secret or any derived key in an export; the statements in the ZIP export contain the one-way room tag, which links the pastes of the same board. |
| REQ-PASTE-104 | C | Unreleased | Where the board has attachments or proofs, the system shall offer a ZIP export containing `board.md`, `attachments/<sha256>-<name>`, and `proofs/paste-<id>.statement` with its `.sig` and, when stamped, `.ots` (the author's shared proof merged with this device's own), with `attachment:` links in `board.md` rewritten to the relative paths; it shall also offer the Markdown-only export, where each attachment reference becomes a placeholder giving its name and SHA-256. |
| REQ-PASTE-105 | C | Unreleased | The system shall produce the same export bytes for the same board, export time and proof states. |
| REQ-PASTE-106 | C | Unreleased | The system shall save exports through the app's download mechanism (`Blob`, object URL, `download` attribute) with the name `qrshare-paste-board-<UTC timestamp>.md` or `.zip`. |
| REQ-PASTE-110 | C | Unreleased | The system shall offer "Paste board (Experimental)" in the WebRTC group of the home screen, with Create, Join with a code and Scan, and a "Check a proof" entry. |
| REQ-PASTE-111 | C | Unreleased | The system shall provide every paste-board text in English, French and Arabic. |
| REQ-PASTE-112 | C | Unreleased | The system shall describe the paste board, its privacy and safety model, attachments, export and the OpenTimestamps workflow in the user guides (EN, FR) and in "How it works". |

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
| REQ-COLLAB-090 | C | 0.6.0 | The system shall let applications sync a shared document between devices without a network, by exchanging binary frames (hello, state vector, update) over any channel such as animated QR codes, as specified in the [offline sync protocol](collab-sync-protocol.md). |
| REQ-COLLAB-091 | C | 0.6.0 | Where a peer has been trusted through a signed hello frame, the system shall require its Ed25519 signature on every later frame and reject the frame otherwise. |
| REQ-COLLAB-092 | C | 0.6.0 | If a received sync frame is oversized, malformed, of an unknown version or type, or carries an invalid signature, then the system shall reject it before decoding its content and log the reason. |
| REQ-COLLAB-093 | C | 0.6.0 | When a sync update is received, the system shall apply it to an isolated copy first and change the document only after the application has validated that copy and the user has accepted it. |
| REQ-COLLAB-094 | C | 0.6.0 | The system shall log every received sync frame with its sender, trust, size and result (applied, unchanged, refused, rejected). |

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
| REQ-HANDOFF-006 | S | 0.6.0 | Where an application hands a file over with a send mode (`mode=animated-qr`, `cimbar`, `webrtc` or `share`, protocol version 2), the system shall go straight to that mode once the file is received, when the policy allows it, instead of showing the chooser. |
| REQ-HANDOFF-007 | S | 0.6.0 | Where the receive screen was opened with `reply=opener` (protocol version 2), when the user selects Open in &lt;host&gt;, the system shall post the received file back to the window that opened QRShare, to the origin of the `return` address only, and fall back to opening a new window if that window is gone. |
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
in release 0.6.0:

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
