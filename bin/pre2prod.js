#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const cliPath = resolve(projectRoot, "dist", "cli.js");

const args = process.argv.slice(2);
const isSourceCheckout =
  existsSync(resolve(projectRoot, ".git")) &&
  existsSync(resolve(projectRoot, "src")) &&
  existsSync(resolve(projectRoot, "tsconfig.json"));
const isDevMode =
  process.env.PRE2PROD_DEV === "1" ||
  process.env.PRE2PROD_DEV === "true" ||
  isSourceCheckout ||
  args.includes("--dev");
const cleanedArgs = args.filter((arg) => arg !== "--dev");

if (isDevMode) {
  const devEnvPath = resolve(projectRoot, "dev.env");
  if (existsSync(devEnvPath)) {
    process.loadEnvFile(devEnvPath);
  }
  console.log(`[pre2prod] rebuilding TypeScript CLI at ${projectRoot}`);
  const buildResult = spawnSync("pnpm", ["run", "build"], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (buildResult.status !== 0) {
    process.exit(buildResult.status ?? 1);
  }
}

const child = spawnSync(process.execPath, [cliPath, ...cleanedArgs], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    ...(isDevMode ? { PRE2PROD_DEV_ACTIVE: "1" } : {}),
  },
});
process.exit(child.status ?? 1);
