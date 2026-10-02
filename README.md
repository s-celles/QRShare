# QRShare

![QRShare](assets/QRShare.png)

Air-gapped peer-to-peer file transfer via animated QR codes with fountain codes.

**Open the app: https://s-celles.github.io/QRShare/** — it runs entirely in your
browser, installs as a Progressive Web App and works offline.

## Highlights

- Scan and create QR codes (text, URLs, Wi-Fi, contacts), optionally password-protected
- Send text and files between devices with **animated QR codes** — no network needed
- Experimental high-speed **CIMBAR** color barcodes, also air-gapped
- Direct **WebRTC** peer-to-peer transfers, nearby-device discovery and live collaborative editing
- Native share, SHA-256 integrity checks, English / French / Arabic interface, light and dark themes

## Documentation

The documentation opens **in the app** (book icon in the header):

- [User Guide](https://s-celles.github.io/QRShare/#/docs?page=user-guide&lang=en) · [Guide utilisateur](https://s-celles.github.io/QRShare/#/docs?page=user-guide&lang=fr)
- [How QRShare Works](https://s-celles.github.io/QRShare/#/docs?page=how-it-works) — features and transfer modes
- [Connectivity and TURN](https://s-celles.github.io/QRShare/#/docs?page=connectivity)
- [Collaborative Editing](https://s-celles.github.io/QRShare/#/docs?page=collaboration)
- [Apps Built on QRShare](https://s-celles.github.io/QRShare/#/docs?page=apps) — who uses QRShare, and how to build on it
- [Architecture](https://s-celles.github.io/QRShare/#/docs?page=architecture) — building blocks and technology stack
- [Development](https://s-celles.github.io/QRShare/#/docs?page=development) — build, test and release
- [Requirements](https://s-celles.github.io/QRShare/#/docs?page=requirements) — EARS specification

Its Markdown sources are in the [`docs/`](docs/) folder.

## Apps Built on QRShare

[Progressive Web Office](https://github.com/s-celles/progressive-web-office) (office
suite) and [CAScad](https://github.com/s-celles/CAScad) (computer algebra notebook)
use QRShare to move their files between devices, even without a network. Any web
app can do the same: see [Apps Built on QRShare](https://s-celles.github.io/QRShare/#/docs?page=apps).

## Quick Start

```bash
bun install
bun test
bun run build
```

See [Development](https://s-celles.github.io/QRShare/#/docs?page=development) for all commands and the release process.

## License

[BSD-3-Clause](LICENSE)
