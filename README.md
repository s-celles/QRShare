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

The documentation is available **in the app** (book icon in the header, or
[#/docs](https://s-celles.github.io/QRShare/#/docs)) and in the [`docs/`](docs/)
folder:

- [User Guide](docs/en-user-guide.md) · [Guide utilisateur](docs/fr-guide-utilisateur.md)
- [How QRShare Works](docs/en-how-it-works.md) — features and transfer modes
- [Connectivity and TURN](docs/en-connectivity-and-turn.md)
- [Collaborative Editing](docs/en-collaborative-editing.md)
- [Architecture](docs/en-architecture.md) — building blocks and technology stack
- [Development](docs/en-development.md) — build, test and release

## Used by Progressive Web Office

[Progressive Web Office](https://github.com/s-celles/progressive-web-office)
([demo](https://s-celles.github.io/progressive-web-office/)), an office suite
that runs entirely in the browser, uses QRShare to exchange documents
between devices without a network:

- **From an app to QRShare**: the app opens `#/send?handoff=1` and hands the
  file over with `postMessage` (up to 200 MB); small text files can travel in
  the address instead (`#/send?data=`). QRShare then offers the transfer, by
  default preferring channels that need no network.
- **From QRShare to an app**: the app opens `#/receive/qr?return=<app URL>`;
  after reception, an *Open in …* button sends the file back to the app.
- Apps detect support from `manifest.webmanifest`
  (`qrshare_handoff.versions`).

The protocol is described in the [user guide](docs/en-user-guide.md); any web
app can use it.

## Quick Start

```bash
bun install
bun test
bun run build
```

See [Development](docs/en-development.md) for all commands and the release process.

## License

[BSD-3-Clause](LICENSE)
