/**
 * Build the shared collaboration core (`src/collab/core`) as a standalone
 * package in `dist-collab/`: ES modules + type declarations + package.json,
 * ready to be published on the `collab-dist` branch and consumed as a git
 * dependency (e.g. `github:s-celles/QRShare#collab-dist-v0.1.0`).
 */
import { $ } from "bun";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const src = join(root, "src/collab/core");
const out = join(root, "dist-collab");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const tsconfig = join(out, "tsconfig.build.json");
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022", "DOM"],
      declaration: true,
      skipLibCheck: true,
      isolatedModules: true,
      types: [],
      rootDir: src,
      outDir: out,
    },
    files: readdirSync(src).filter((f) => f.endsWith(".ts")).map((f) => join(src, f)),
  }),
);
await $`bunx tsc -p ${tsconfig}`.cwd(root);
rmSync(tsconfig);

// Node-style ESM needs explicit extensions on relative imports.
for (const file of readdirSync(out)) {
  if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
  const path = join(out, file);
  writeFileSync(path, readFileSync(path, "utf8").replace(/(from\s+["'])(\.\/[\w-]+)(["'])/g, "$1$2.js$3"));
}

const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
pkg.exports = { ".": { types: "./index.d.ts", import: "./index.js" } };
pkg.types = "./index.d.ts";
pkg.module = "./index.js";
pkg.sideEffects = false;
writeFileSync(join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
cpSync(join(src, "README.md"), join(out, "README.md"));
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));
console.log(`Built ${pkg.name}@${pkg.version} in ${out}`);
