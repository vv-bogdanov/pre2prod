import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory = resolve(projectRoot, ".pre2prod", "pack-check");
const installDirectory = mkdtempSync(resolve(tmpdir(), "pre2prod-package-"));

try {
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  execFileSync("pnpm", ["pack", "--pack-destination", outputDirectory], {
    cwd: projectRoot,
    env: { ...process.env, npm_config_ignore_scripts: "true" },
    stdio: "inherit",
  });

  const tarballs = readdirSync(outputDirectory).filter((entry) =>
    entry.endsWith(".tgz"),
  );
  if (tarballs.length !== 1) {
    throw new Error(`Expected one package tarball, found ${tarballs.length}`);
  }
  const tarball = resolve(outputDirectory, tarballs[0]);

  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--loglevel=error",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installDirectory,
      tarball,
    ],
    { cwd: projectRoot, stdio: "inherit" },
  );

  const executable = resolve(
    installDirectory,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "pre2prod.cmd" : "pre2prod",
  );
  const help = execFileSync(executable, ["--help"], {
    cwd: installDirectory,
    encoding: "utf8",
  });
  if (!help.includes("Usage: pre2prod")) {
    throw new Error("Installed package did not expose the Pre2prod CLI");
  }

  console.log(
    `Package smoke passed (${statSync(tarball).size} bytes): ${tarball}`,
  );
} finally {
  rmSync(installDirectory, { recursive: true, force: true });
}
