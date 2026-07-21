#!/usr/bin/env node
import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });
let pendingTrigger;

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

  if (message.id === 900 && message.result) {
    send({ id: pendingTrigger, result: message.result });
    pendingTrigger = undefined;
    return;
  }

  if (message.method === "fail") {
    send({ id: message.id, error: { code: -32000, message: "mock failure" } });
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
