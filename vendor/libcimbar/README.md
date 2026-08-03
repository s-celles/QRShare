# Vendored libcimbar web runtime

This directory contains the official web encoder and beta web decoder from
[`sz3/libcimbar`](https://github.com/sz3/libcimbar), release **v0.6.7c**
(published 2026-07-14).

The files are intentionally kept separate from QRShare's AGPL source. libcimbar
is distributed under the Mozilla Public License 2.0; see `LICENSE` in this
directory. The upstream release artifact was `cimbar.wasm.tar.gz`.

QRShare removes only the nested PWA manifest/service-worker registration from
the two HTML entry points because QRShare's own service worker precaches these
files. The encoder and decoder JavaScript/WASM implementations are otherwise
the upstream release artifacts.
