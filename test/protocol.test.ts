import { describe, expect, it } from "vitest";

import { parseIncomingMessage } from "../src/app-server/protocol.js";

describe("parseIncomingMessage", () => {
  it("accepts valid JSON-RPC message envelopes", () => {
    expect(
      parseIncomingMessage({ method: "notice", params: { value: 1 } }),
    ).toEqual({ method: "notice", params: { value: 1 } });
    expect(parseIncomingMessage({ id: 1, result: { ok: true } })).toEqual({
      id: 1,
      result: { ok: true },
    });
    expect(
      parseIncomingMessage({
        id: 1,
        error: { code: -32000, message: "failed" },
      }),
    ).toEqual({
      id: 1,
      error: { code: -32000, message: "failed" },
    });
  });

  it.each([
    "not a message",
    { id: 1, error: { code: -32000 } },
    { id: 1, result: {}, error: { code: -32000, message: "failed" } },
  ])("rejects malformed JSON-RPC envelopes: %j", (message) => {
    expect(parseIncomingMessage(message)).toBeUndefined();
  });
});
