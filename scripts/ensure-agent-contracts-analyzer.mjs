#!/usr/bin/env node
/**
 * GitHub-sourced agent-contracts-analyzer v0.1.1 does not ship dist/ in the tag.
 * Materialize dist/ from a sibling checkout, cache clone, or in-package build.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const ANALYZER_REPO =
  "https://github.com/foo-log-inc/agent-contracts-analyzer.git";
const ANALYZER_TAG = "v0.1.1";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "node_modules", "agent-contracts-analyzer");
const distIndex = path.join(pkgDir, "dist", "index.js");

if (!fs.existsSync(pkgDir)) {
  process.exit(0);
}

if (fs.existsSync(distIndex)) {
  process.exit(0);
}

function copyDist(fromDir) {
  const target = path.join(pkgDir, "dist");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(fromDir, "dist"), target, { recursive: true });
}

function buildAndCopy(sourceDir) {
  const built = path.join(sourceDir, "dist", "index.js");
  if (!fs.existsSync(built)) {
    console.log(`Building agent-contracts-analyzer in ${sourceDir}...`);
    execSync("npm ci && npm run build", {
      cwd: sourceDir,
      stdio: "inherit",
    });
  }
  if (!fs.existsSync(built)) {
    throw new Error("agent-contracts-analyzer build did not produce dist/index.js");
  }
  copyDist(sourceDir);
}

const sibling = path.resolve(root, "..", "agent-contracts-analyzer");
if (fs.existsSync(path.join(sibling, "package.json"))) {
  console.log("Materializing agent-contracts-analyzer dist/ from sibling workspace...");
  buildAndCopy(sibling);
  process.exit(0);
}

if (fs.existsSync(path.join(pkgDir, "src", "index.ts"))) {
  console.log("Building agent-contracts-analyzer from node_modules source...");
  buildAndCopy(pkgDir);
  process.exit(0);
}

const cacheDir = path.join(root, ".cache", "agent-contracts-analyzer");
if (!fs.existsSync(path.join(cacheDir, "package.json"))) {
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  console.log(`Cloning ${ANALYZER_REPO} (${ANALYZER_TAG})...`);
  execSync(
    `git clone --depth 1 --branch ${ANALYZER_TAG} ${ANALYZER_REPO} ${cacheDir}`,
    { stdio: "inherit" },
  );
}

console.log("Building agent-contracts-analyzer from cache clone...");
buildAndCopy(cacheDir);
