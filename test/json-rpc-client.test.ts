import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { JsonRpcProcessClient } from "../src/app-server/json-rpc-client.js";

const here = dirname(fileURLToPath(import.meta.url));
const mockServer = resolve(here, "fixtures/mock-rpc-server.mjs");

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
