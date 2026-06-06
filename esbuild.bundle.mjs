#!/usr/bin/env node
import { build } from "esbuild";
import { readFileSync, statSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const minify = process.argv.includes("--minify");

const externalSdks = [
  "@anthropic-ai/claude-agent-sdk",
  "@anthropic-ai/sdk",
  "@google/adk",
  "@openai/agents",
  "@google/genai",
];

const resolveRuntimeDynamicImports = {
  name: "resolve-runtime-dynamic-imports",
  setup(_build) {},
};

const inlineBuildTimeConstants = {
  name: "inline-build-time-constants",
  setup(build) {
    build.onLoad({ filter: /src[\\/]cli\.ts$/ }, async (args) => {
      let contents = readFileSync(args.path, "utf8");
      // Strip shebang
      contents = contents.replace(/^#!.*\n/, "");
      // Replace runtime package.json read with build-time constant
      // Pattern: createRequire + require('../package.json')
      contents = contents.replace(
        /const require = createRequire\(import\.meta\.url\);\nconst pkg = require\(['"]\.\.\/package\.json['"]\).*;\n/,
        `const pkg = { version: ${JSON.stringify(pkg.version)} };\n`,
      );
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
      "import { createRequire } from 'module';",
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
  plugins: [resolveRuntimeDynamicImports, inlineBuildTimeConstants],
  logLevel: "info",
});

if (result.errors.length > 0) process.exit(1);
const stat = statSync("dist/micro-contracts.bundle.mjs");
const sizeKB = (stat.size / 1024).toFixed(1);
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
console.log(`\n✓ dist/micro-contracts.bundle.mjs  ${sizeKB} KB (${sizeMB} MB)`);
