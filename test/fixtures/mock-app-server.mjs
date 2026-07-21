#!/usr/bin/env node
import { createInterface } from "node:readline";
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const input = createInterface({ input: process.stdin });
let threadCounter = 0;
let turnCounter = 0;
const goals = new Map();
const now = () => Math.floor(Date.now() / 1000);

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialized") {
    return;
  }

  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "mock" } });
    return;
  }

  if (message.method === "thread/start") {
    const id = `thread-${++threadCounter}`;
    send({ id: message.id, result: { thread: { id, sessionId: id } } });
    send({ method: "thread/started", params: { thread: { id } } });
    return;
  }

  if (message.method === "thread/fork") {
    const id = `thread-${++threadCounter}`;
    send({
      id: message.id,
      result: {
        thread: {
          id,
          sessionId: "thread-1",
          forkedFromId: message.params.threadId,
        },
      },
    });
    send({ method: "thread/started", params: { thread: { id } } });
    return;
  }

  if (message.method === "thread/goal/set") {
    const params = message.params ?? {};
    const threadId = params.threadId;
    const previous = goals.get(threadId) ?? {
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    const goal = {
      threadId,
      objective: params.objective ?? previous.objective ?? "",
      status: params.status ?? previous.status ?? "active",
      tokenBudget: params.tokenBudget ?? previous.tokenBudget ?? null,
      tokensUsed: previous.tokensUsed ?? 0,
      timeUsedSeconds: previous.timeUsedSeconds ?? 0,
      createdAt: previous.createdAt ?? now(),
      updatedAt: now(),
    };
    goals.set(threadId, goal);
    send({ id: message.id, result: { goal } });
    send({
      method: "thread/goal/updated",
      params: { threadId, turnId: null, goal },
    });
    return;
  }

  if (message.method === "thread/goal/get") {
    const threadId = message.params?.threadId;
    send({ id: message.id, result: { goal: goals.get(threadId) ?? null } });
    return;
  }

  if (message.method === "thread/goal/clear") {
    const threadId = message.params?.threadId;
    goals.delete(threadId);
    send({ id: message.id, result: { cleared: true } });
    send({
      method: "thread/goal/cleared",
      params: { threadId },
    });
    return;
  }

  if (message.method === "turn/start") {
    const turnId = `turn-${++turnCounter}`;
    const prompt = message.params.input?.[0]?.text ?? "";
    const cwd = message.params.cwd ?? process.cwd();
    send({
      id: message.id,
      result: { turn: { id: turnId, status: "inProgress", items: [] } },
    });
    send({
      method: "turn/started",
      params: { turn: { id: turnId, status: "inProgress", items: [] } },
    });

    let text = "Repository studied.";
    if (
      prompt.includes("write a complete, minimal, executable remediation plan")
    ) {
      await writeFile(
        resolve(cwd, "PRE2PROD_PLAN.md"),
        "# Plan\n\n1. Create mock-fixed.txt.\n",
        "utf8",
      );
      text = "Plan written.";
    } else if (
      prompt.includes("read PRE2PROD_PLAN.md and execute it completely")
    ) {
      await writeFile(resolve(cwd, "mock-fixed.txt"), "fixed\n", "utf8");
      text = "Plan executed.";
    } else if (message.params.outputSchema) {
      const fixed = await access(resolve(cwd, "mock-fixed.txt"))
        .then(() => true)
        .catch(() => false);
      text = fixed
        ? JSON.stringify({ status: "PASS", findings: [] })
        : JSON.stringify({
            status: "NEEDS_WORK",
            findings: ["Create mock-fixed.txt"],
          });
    }

    send({
      method: "item/completed",
      params: {
        threadId: message.params.threadId,
        turnId,
        item: {
          type: "agentMessage",
          id: `item-${turnId}`,
          text,
          phase: "final_answer",
        },
      },
    });
    send({
      method: "turn/completed",
      params: {
        threadId: message.params.threadId,
        turn: { id: turnId, status: "completed", items: [], error: null },
      },
    });
    return;
  }

  if (message.id !== undefined) {
    send({ id: message.id, result: {} });
  }
});
