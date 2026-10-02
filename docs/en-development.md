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

# Package as a single HTML file
bun run package
```

## Documentation

The pages in `docs/` are Markdown files. They are bundled into the app and shown
in-app under `#/docs`; the list of pages lives in `src/ui/docs.ts`. To add a page,
create the Markdown file, then register it there with its title. Links between
pages use the relative file name (for example `en-user-guide.md`), which works both
on GitHub and in the app.

## Releasing a New Version

1. **Bump the version** in `package.json` and `src/version.ts`
2. **Update `CHANGELOG.md`**: move entries from `[Unreleased]` into a new `[X.Y.Z] - YYYY-MM-DD` section
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
