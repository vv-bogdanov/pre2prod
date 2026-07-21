import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterAll } from "vitest";

const original = {
  TMPDIR: process.env.TMPDIR,
  TMP: process.env.TMP,
  TEMP: process.env.TEMP,
};
const testTmp = mkdtempSync(resolve(tmpdir(), "pre2prod-tests-"));

process.env.TMPDIR = testTmp;
process.env.TMP = testTmp;
process.env.TEMP = testTmp;

afterAll(() => {
  restoreEnvironment("TMPDIR", original.TMPDIR);
  restoreEnvironment("TMP", original.TMP);
  restoreEnvironment("TEMP", original.TEMP);
  rmSync(testTmp, { recursive: true, force: true });
});

function restoreEnvironment(key: "TMPDIR" | "TMP" | "TEMP", value?: string) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
