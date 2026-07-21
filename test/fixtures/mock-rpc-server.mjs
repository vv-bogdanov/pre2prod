#!/usr/bin/env node
import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });
setInterval(() => {}, 1_000);
let pendingTrigger;
let pendingModernTrigger;
let modernApprovalStep = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendRaw(message) {
  process.stdout.write(`${message}\n`);
}

input.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "trigger-approval") {
    pendingTrigger = message.id;
    send({ method: "mock/notification", params: { value: 42 } });
    send({
      id: 900,
      method: "item/commandExecution/requestApproval",
      params: { reason: "mock approval" },
    });
    return;
  }

  if (message.method === "trigger-modern-approvals") {
    pendingModernTrigger = message.id;
    modernApprovalStep = 1;
    send({
      id: 901,
      method: "execCommandApproval",
      params: {
        conversationId: "thread-1",
        callId: "exec-call",
        approvalId: null,
        command: ["echo", "approval"],
        cwd: "/tmp",
        reason: null,
        parsedCmd: [],
      },
    });
    return;
  }

  if (message.id === 900 && message.result) {
    send({ id: pendingTrigger, result: message.result });
    pendingTrigger = undefined;
    return;
  }

  if (message.id === 901 && message.result) {
    if (message.result.decision !== "denied") {
      send({
        id: pendingModernTrigger,
        error: { code: -32001, message: "Modern approval was not denied" },
      });
    } else {
      modernApprovalStep = 2;
      send({
        id: 902,
        method: "applyPatchApproval",
        params: {
          callId: "patch-call",
          conversationId: "thread-1",
          fileChanges: {},
          reason: null,
          grantRoot: null,
        },
      });
    }
    return;
  }

  if (message.id === 902 && message.result) {
    if (message.result.decision !== "denied") {
      send({
        id: pendingModernTrigger,
        error: {
          code: -32001,
          message: "Modern patch approval was not denied",
        },
      });
    } else {
      modernApprovalStep = 3;
      send({
        id: 903,
        method: "item/permissions/requestApproval",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-1",
          environmentId: null,
          startedAtMs: Date.now(),
          cwd: "/tmp",
          reason: null,
          permissions: { network: null, fileSystem: null },
        },
      });
    }
    return;
  }

  if (message.id === 903 && message.result) {
    if (
      modernApprovalStep !== 3 ||
      JSON.stringify(message.result) !==
        JSON.stringify({
          permissions: {},
          scope: "turn",
          strictAutoReview: true,
        })
    ) {
      send({
        id: pendingModernTrigger,
        error: { code: -32001, message: "Modern permissions were not denied" },
      });
    } else {
      modernApprovalStep = 4;
      send({
        id: 904,
        method: "mcpServer/elicitation/request",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          serverName: "mock",
          mode: "form",
          _meta: null,
          message: "Provide no additional information",
          requestedSchema: { type: "object", properties: {}, required: [] },
        },
      });
    }
    return;
  }

  if (message.id === 904 && message.result) {
    if (
      modernApprovalStep !== 4 ||
      JSON.stringify(message.result) !==
        JSON.stringify({ action: "decline", content: null, _meta: null })
    ) {
      send({
        id: pendingModernTrigger,
        error: { code: -32001, message: "MCP elicitation was not declined" },
      });
    } else {
      send({ id: pendingModernTrigger, result: { ok: true } });
    }
    pendingModernTrigger = undefined;
    modernApprovalStep = 0;
    return;
  }

  if (message.method === "fail") {
    send({ id: message.id, error: { code: -32000, message: "mock failure" } });
    return;
  }

  if (message.method === "exit-pending") {
    setTimeout(() => process.exit(17), 10);
    return;
  }

  if (message.method === "no-response") {
    return;
  }

  if (message.method === "stderr-private-key") {
    process.stderr.write(
      "-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----\n",
    );
    send({ id: message.id, result: {} });
    return;
  }

  if (message.method === "malformed-scalar") {
    sendRaw('"not a JSON-RPC message"');
    return;
  }

  if (message.method === "malformed-response") {
    send({ id: message.id, error: { code: -32000 } });
    return;
  }

  if (message.id !== undefined) {
    send({ id: message.id, result: {} });
  }
});
