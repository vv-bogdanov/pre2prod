import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { JsonRpcProcessClient } from "../src/app-server/json-rpc-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const mockServer = resolve(here, "fixtures/mock-rpc-server.mjs");
const delayedResponseScript = [
  "const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');",
  "setTimeout(() => send({ id: 1, result: { delayed: true } }), 200);",
  "setInterval(() => {}, 1000);",
].join("\n");

describe("JsonRpcProcessClient", () => {
  it("routes notifications and declines unexpected approvals", async () => {
    const client = new JsonRpcProcessClient({
      command: process.execPath,
      args: [mockServer],
    });
    const notification = vi.fn();
    client.onNotification(notification);

    await client.start();
    try {
      const response = await client.request<{ decision: string }>(
        "trigger-approval",
      );
      expect(response).toEqual({ decision: "decline" });
      expect(notification).toHaveBeenCalledWith("mock/notification", {
        value: 42,
      });
    } finally {
      await client.close();
    }
  });

  it("denies modern approval requests without granting permissions", async () => {
    const client = new JsonRpcProcessClient({
      command: process.execPath,
      args: [mockServer],
    });

    await client.start();
    try {
      await expect(client.request("trigger-modern-approvals")).resolves.toEqual(
        { ok: true },
      );
    } finally {
      await client.close();
    }
  });

  it("surfaces JSON-RPC failures", async () => {
    const client = new JsonRpcProcessClient({
      command: process.execPath,
      args: [mockServer],
    });
    await client.start();
    try {
      await expect(client.request("fail")).rejects.toThrow(/mock failure/i);
    } finally {
      await client.close();
    }
  });

  it("rejects a pending request when the subprocess exits", async () => {
    const client = new JsonRpcProcessClient({
      command: process.execPath,
      args: [mockServer],
    });
    await client.start();
    try {
      await expect(client.request("exit-pending")).rejects.toThrow(
        /exited unexpectedly \(code=17, signal=null\)/i,
      );
    } finally {
      await client.close();
    }
  });

  it("times out a request and ignores its late response", async () => {
    const client = new JsonRpcProcessClient({
      command: process.execPath,
      args: ["-e", delayedResponseScript],
      requestTimeoutMs: 50,
    });
    const failures: Error[] = [];
    client.onFailure((error) => failures.push(error));
    await client.start();
    try {
      await expect(client.request("delayed-response")).rejects.toThrow(
        /request "delayed-response" timed out after 50ms/i,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(failures).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it("rejects pending requests and makes close idempotent", async () => {
    const client = new JsonRpcProcessClient({
      command: process.execPath,
      args: [mockServer],
    });
    await client.start();
    const pending = client.request("no-response");
    const firstClose = client.close();
    const secondClose = client.close();

    await expect(pending).rejects.toThrow(/client closed/i);
    expect(secondClose).toBe(firstClose);
    await Promise.all([firstClose, secondClose]);
  });

  it("redacts multiline private keys from App Server stderr", async () => {
    let output = "";
    const stderr = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString("utf8");
        callback();
      },
    });
    const client = new JsonRpcProcessClient({
      command: process.execPath,
      args: [mockServer],
      stderr,
    });
    await client.start();
    try {
      await client.request("stderr-private-key");
      expect(output).toContain("[REDACTED]");
      expect(output).not.toContain("private-key-body");
    } finally {
      await client.close();
    }
  });

  it.each(["malformed-scalar", "malformed-response"])(
    "rejects malformed JSON-RPC output: %s",
    async (method) => {
      const client = new JsonRpcProcessClient({
        command: process.execPath,
        args: [mockServer],
      });
      await client.start();
      try {
        await expect(client.request(method)).rejects.toThrow(
          /invalid JSON-RPC message/i,
        );
      } finally {
        await client.close();
      }
    },
  );
});
