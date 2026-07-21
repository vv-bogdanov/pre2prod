#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === "--version") {
  console.log("codex-cli mock");
} else if (args[0] === "login" && args[1] === "status") {
  console.log("Logged in with mock credentials");
} else if (args.at(-1) === "app-server") {
  await import("./mock-app-server.mjs");
} else {
  console.error(`Unexpected mock Codex arguments: ${args.join(" ")}`);
  process.exitCode = 1;
}
