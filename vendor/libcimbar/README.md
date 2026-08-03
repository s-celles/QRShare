# Vendored libcimbar web runtime

This directory contains the official WASM runtime and encoder engine from
[`sz3/libcimbar`](https://github.com/sz3/libcimbar), release **v0.6.7c**
(published 2026-07-14).

The files are intentionally kept separate from QRShare's AGPL source. libcimbar
is distributed under the Mozilla Public License 2.0; see `LICENSE` in this
directory. The upstream release artifact was `cimbar.wasm.tar.gz`.

QRShare does not embed the upstream web pages. Its own Preact views and workers
call the exported encoder and decoder APIs directly. The WASM glue and
`send.2026-07-13T0523.js` engine in this directory are unmodified upstream
release artifacts; the QRShare adapters live under `src/workers/`.
