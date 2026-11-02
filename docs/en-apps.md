# Apps Built on QRShare

Other web applications use QRShare to move their files between devices — with
animated QR codes when there is no network, or a direct connection when there is
one — instead of building their own transfer. They open QRShare's public pages
and talk to it inside the browser: nothing goes through a server.

| App | What it is | Sends with QRShare | Receives with QRShare | Status |
|-----|------------|--------------------|-----------------------|--------|
| [Progressive Web Office](#progressive-web-office) | Office suite in the browser | Documents | Documents | In use |
| [CAScad](#cascad) | Computer algebra notebook | Notebooks | Notebooks | In use |

## Progressive Web Office

[Progressive Web Office](https://github.com/s-celles/progressive-web-office)
([open the app](https://s-celles.github.io/progressive-web-office/)) opens, edits
and saves documents, spreadsheets and presentations entirely in the browser, in
OpenDocument and Microsoft Office formats, with real-time collaboration.

It relies on QRShare to:

- **Send a document** — *Send to another device…* hands the open document to
  QRShare. Small Markdown, CSV and LaTeX files (up to 16 KB) travel in the
  address (`#/send?data=…`); larger ones go through the
  [app handoff protocol](en-user-guide.md#exchanging-files-with-other-web-apps)
  (`postMessage`, up to 200 MB). The user chooses the transfer policy (air-gapped
  only, prefer air-gapped, any mode), and QRShare shows the animated QR codes.
- **Receive a document** — *Receive from another device…* opens QRShare's
  receive screen with a `return` address; once the file is received, QRShare's
  **Open in …** button brings it back into Progressive Web Office.
- **Sync a document without any network** — collaborators exchange the changes
  of a shared text document as signed frames shown and scanned as QR codes
  ([offline sync protocol](collab-sync-protocol.md)), with the collaboration
  engine of QRShare, `@scelles/collab`.

Both apps share the same visual style, and Progressive Web Office reads QRShare's
manifest to check which handoff protocol versions it supports. Its address of
QRShare can point to a self-hosted copy.

## CAScad

[CAScad](https://github.com/s-celles/CAScad)
([open the app](https://s-celles.github.io/CAScad/)) is an interactive computer
algebra notebook in the browser (Giac/Xcas and CortexJS kernels, reactive cells,
plots).

It relies on QRShare to:

- **Send a notebook** — *Send to device* hands `notebook.cascad.json` to QRShare
  with the [app handoff protocol](en-user-guide.md#exchanging-files-with-other-web-apps),
  after checking QRShare's manifest, with the same transfer policies as
  Progressive Web Office (air-gapped only, prefer air-gapped, any mode). With an
  older QRShare, the notebook is downloaded and QRShare opens its *Prepare a
  transfer* screen.
- **Receive a notebook** — *Receive* opens QRShare's receive screen with a
  `return` address; **Open in …** opens the received notebook in CAScad, which
  accepts only files coming from the configured QRShare address.

The address of QRShare can point to a self-hosted copy. CAScad's own
[sharing guide](https://s-celles.github.io/CAScad/#/docs?page=sharing) describes
these features from its side.

CAScad also shares QRShare's visual style.

## Building on QRShare

Any web application can do the same, with no library to install:

1. **Check support** — fetch QRShare's `manifest.webmanifest` and read
   `qrshare_handoff.versions` (and `features` for version 2).
2. **Send a file** — open `#/send?handoff=1&policy=…` (optionally `&mode=…`) and
   answer QRShare's `ready` message with the file; small text can travel in the
   address instead (`#/send?data=…`).
3. **Receive a file** — open a receive screen such as `#/receive/qr` with
   `return=<your app's address>` (optionally `&reply=opener`), then wait for the
   `file` message from QRShare's origin.

The messages, limits and security rules are described in the
[user guide](en-user-guide.md#exchanging-files-with-other-web-apps) and specified
by the REQ-HANDOFF requirements in the [requirements](requirements.md). To list
your application on this page, open a pull request on the
[QRShare repository](https://github.com/s-celles/QRShare).
