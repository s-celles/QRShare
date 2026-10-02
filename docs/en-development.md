# Development

QRShare uses [Bun](https://bun.sh) for dependencies, tests and builds. The
optional [just](https://github.com/casey/just) recipes wrap the same commands.

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Run tests
bun test

# Type check
bun run typecheck

# Production build (dist/)
bun run build

# Serve dist/ locally
bun run serve

# Package the main script and styles into qrshare.html
# (workers and WebAssembly files must stay next to it)
bun run package
```

## Documentation

The pages in `docs/` are Markdown files. They are bundled into the app and shown
in-app under `#/docs`; the list of pages lives in `src/ui/docs.ts`. To add a page,
create the Markdown file, then register it there with its title. Links between
pages use the relative file name (for example `en-user-guide.md`, or
`en-user-guide.md#section-title` for a section), which works both on GitHub and in
the app.

A page has its own address in the app, used by the README links:

- `#/docs?page=<slug>` — a page, in the interface language when translated
- `&lang=fr` — force a translation (`en` or `fr`)
- `&section=<anchor>` — scroll to a heading; anchors follow GitHub's rules
  (`Exchanging Files with Other Web Apps` → `exchanging-files-with-other-web-apps`)

## Requirements

[`docs/requirements.md`](requirements.md) is the EARS specification of QRShare
(also shown in the app and linked from the About window). Every requirement has an
ID such as `REQ-QRX-004`, a MoSCoW priority and the release that introduced it.
Cite IDs in code comments and test names; `tests/requirements.test.ts` checks that
each cited ID is defined, that IDs are unique and that every requirement follows
an EARS pattern. When behaviour changes, update the requirement in the same commit.

## Releasing a New Version

1. **Bump the version** in `package.json` and `src/version.ts`
2. **Update `CHANGELOG.md`**: move entries from `[Unreleased]` into a new `[X.Y.Z] - YYYY-MM-DD` section, and replace *Unreleased* by `X.Y.Z` in the **Since** column of `docs/requirements.md`
3. **Run checks**:
   ```bash
   bun test
   bun run build
   ```
4. **Commit** the version bump:
   ```bash
   git add package.json src/version.ts CHANGELOG.md
   git commit -m "chore(release): X.Y.Z"
   ```
5. **Tag** the release:
   ```bash
   git tag -a vX.Y.Z -m "QRShare X.Y.Z"
   ```
6. **Push** commit and tag:
   ```bash
   git push && git push --tags
   ```
7. **(Optional) Create a GitHub Release** from the tag:
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag
   ```

Pushing to `main` runs the CI workflow, which tests, builds and deploys the app to
GitHub Pages.
