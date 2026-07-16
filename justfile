# QRShare dev tasks. Run `just` to list recipes.
# Requires: bun (https://bun.sh), just (https://github.com/casey/just)

# Default: show available recipes
default:
    @just --list

# Install dependencies
install:
    bun install

# Hot-reloading dev build (static PWA is served from dist/ — see `serve`)
build:
    bun run build

# Serve built dist/ on localhost
serve port='3000':
    PORT={{port}} bun run scripts/serve.ts

# Build then serve dist/ on 0.0.0.0 for cross-device (LAN) testing — WebRTC / collab
serve-lan port='3000':
    bun run build
    HOST=0.0.0.0 PORT={{port}} bun run scripts/serve.ts

# Run the test suite
test:
    bun test

# Type-check without emitting
check:
    bun run typecheck

# Bundle into a single self-contained qrshare.html
package:
    bun run package

# Everything CLAUDE.md requires before a commit
preflight: check test
    @echo "typecheck + tests passed"
