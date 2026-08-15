import { build } from "esbuild";
import { chmod } from "node:fs/promises";

await build({
  entryPoints: ["src/index.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  packages: "external",
});

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
});

await chmod("dist/cli.js", 0o755);
