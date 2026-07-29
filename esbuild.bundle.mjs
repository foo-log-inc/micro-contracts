#!/usr/bin/env node
import { build } from "esbuild";
import { readFileSync, statSync } from "node:fs";

const minify = process.argv.includes("--minify");

const externalSdks = [
  "@anthropic-ai/claude-agent-sdk",
  "@anthropic-ai/sdk",
  "@google/adk",
  "@openai/agents",
  "@google/genai",
];

const stripShebang = {
  name: "strip-shebang",
  setup(build) {
    build.onLoad({ filter: /src[\\/]cli\.ts$/ }, async (args) => {
      const contents = readFileSync(args.path, "utf8").replace(/^#!.*\n/, "");
      return { contents, loader: "ts" };
    });
  },
};

const result = await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: "dist/micro-contracts.bundle.mjs",
  minify,
  sourcemap: true,
  external: externalSdks,
  mainFields: ["module", "main"],
  conditions: ["import", "node"],
  banner: {
    js: [
      "#!/usr/bin/env node",
      // Banner declarations are invisible to esbuild's renamer, so they must use
      // names no bundled module can declare: dependencies import createRequire
      // themselves and an unaliased import collides ("already been declared").
      "import { createRequire as __microContractsCreateRequire } from 'module';",
      "const require = __microContractsCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  plugins: [stripShebang],
  logLevel: "info",
});

if (result.errors.length > 0) process.exit(1);
const stat = statSync("dist/micro-contracts.bundle.mjs");
const sizeKB = (stat.size / 1024).toFixed(1);
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
console.log(`\n✓ dist/micro-contracts.bundle.mjs  ${sizeKB} KB (${sizeMB} MB)`);
