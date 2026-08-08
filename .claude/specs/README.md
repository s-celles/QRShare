# Feature Specifications

Durable, single-file specifications for each QRShare feature. Each file merges
its requirements, design, research notes, and task breakdown. These replace the
former `.kiro/specs/` multi-file + `spec.json` bundles.

See [../../CLAUDE.md](../../CLAUDE.md) for how specs fit into the development
workflow, and [../workflow.md](../workflow.md) for the full process.

## Specifications

- [QRShare Core](./qrshare-core.md) — QRShare is a Progressive Web Application (PWA) enabling peer-to-peer file transfer between two devices via two modes: (1) animated QR codes with fountain codes over an air-gapped optical channel (no network required), and (2) WebRTC DataChannel bootstrapped by a QR code containing a peer ID (network required for signaling). The application is built as a purely static, single-page application using Bun and TypeScript, installable as an offline-capable PWA.
- [QR Scan and Create](./qr-scan-and-create.md) — QRShare is an air-gapped file transfer application that uses animated QR codes and WebRTC for peer-to-peer sharing. Currently, the app's landing page presents four transfer modes (Send/Receive via QR, Send/Receive via WebRTC). This specification adds two new standalone utility features — **QR Code Scanning** (decode any QR code and display its content) and **QR Code Creation** (generate a QR code from user-provided text) — positioned **before** the existing transfer modes on the landing page. All parameters must remain visible and accessible, as this is an advanced user application.
- [Text Sharing](./text-sharing.md) — QRShare currently supports only file transfer across its three sharing methods (animated QR codes, WebRTC DataChannel, and Web Share API). This feature extends QRShare to also support sharing simple text messages through all existing transfer methods. Users should be able to type or paste a text message and share it using any of the available channels — QR code (single static or animated fountain-coded), WebRTC, or Web Share — and receivers should be able to view and copy the received text directly, without needing to download a file.

## Planned

- [Local Network Peer Discovery](./local-discovery.md) — Serverless WebRTC local network peer discovery via Trystero signaling, allowing devices on the same Wi-Fi network to announce presence, track active nearby peers, and exchange direct file/text transfer offers with zero QR code scanning.
