# @scelles/collab

Serverless real-time collaboration for web apps, extracted from
[QRShare](https://github.com/s-celles/QRShare):

- **Document sync**: any [Yjs](https://yjs.dev) document over a peer-to-peer
  room (a [trystero](https://github.com/dmotz/trystero) room or anything with
  the same `makeAction` / `onPeerJoin` / `onPeerLeave` shape), with a
  state-vector handshake so late joiners and peers back from offline catch up.
- **Presence**: who is here and where they work (y-protocols awareness), with
  friendly compound names ("Swift Crimson Falcon") and matching colours from
  [@scelles/unique-names-generator](https://www.npmjs.com/package/@scelles/unique-names-generator).
- **Version history**: named snapshots ordered by a Lamport clock, kept by
  every participant, replayed to late joiners, restorable as a normal edit.
- **Local persistence**: document and history in IndexedDB.

There is no relay and no server: every participant keeps the whole document
and its history.

## Install

The package is published as a git dependency built from QRShare's
`src/collab/core`:

```sh
npm install "github:s-celles/QRShare#collab-dist-v0.1.0"
```

## Use

```ts
import { joinRoom } from "trystero";
import { CollabSession, loadIdentity, type CollabRoom } from "@scelles/collab";

const room = joinRoom({ appId: "my-app" }, roomId);
const session = new CollabSession(room as unknown as CollabRoom, {
  siteId: selfId,
  identity: loadIdentity("my-app.identity"),
});
await session.persist({ prefix: "my-app-collab-", roomId });

const cells = session.doc.getMap("cells");
session.on("participants", (people) => render(people));
session.setCursor({ row: 3, col: 1 });
const v = session.saveVersion("Before review");
session.restoreVersion(v.id, { cells: "map" });
```

Wire protocol (action names, kept compatible across versions): `doc-update`,
`sync`, `version`, `aware`.

## License

BSD-3-Clause.

## Offline sync

`offline` syncs a Yjs document between devices without a network, in passes
of short frames (state vector, then the missing updates), signed with
Ed25519, size-limited and validated on an isolated copy before being
applied. See [docs/en-offline-sync-protocol.md](../../../docs/en-offline-sync-protocol.md).

```ts
import { offline } from "@scelles/collab";

const key = await offline.generatePeerKey();
const sync = new offline.OfflineSync({ doc, docId, key, name: "Ana", peers, log, validate });
const frame = await sync.stateVector();      // show it
const received = await sync.receive(bytes);  // a scanned frame
if (received.type === "update") await received.apply();
```
