#!/usr/bin/env node
import { createInterface } from "node:readline";
import { access, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const input = createInterface({ input: process.stdin });
setInterval(() => {}, 1_000);
let threadCounter = 0;
let turnCounter = 0;
const goals = new Map();
const now = () => Math.floor(Date.now() / 1000);

if (process.env.MOCK_PID_FILE) {
  await writeFile(process.env.MOCK_PID_FILE, `${process.pid}\n`, "utf8");
}
if (process.env.MOCK_EXIT_FILE) {
  const markExited = () => {
    writeFileSync(process.env.MOCK_EXIT_FILE, `${process.pid}\n`, "utf8");
  };
  process.once("SIGINT", () => {
    markExited();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    markExited();
    process.exit(0);
  });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

input.on("line", async (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialized") {
    return;
  }

  if (message.method === "initialize") {
    if (message.params?.capabilities !== null) {
      send({
        id: message.id,
        error: { code: -32602, message: "Missing initialize capabilities" },
      });
      return;
    }
    send({ id: message.id, result: { userAgent: "mock" } });
    return;
  }

  if (message.method === "thread/start") {
    if (process.env.MOCK_MALFORMED_RESULT === "thread/start") {
      send({ id: message.id, result: { thread: {} } });
      return;
    }
    if (
      process.env.MOCK_EXPECT_MODEL_PROVIDER &&
      message.params.modelProvider !== process.env.MOCK_EXPECT_MODEL_PROVIDER
    ) {
      send({
        id: message.id,
        error: {
          code: -32602,
          message: "Unexpected model provider",
        },
      });
      return;
    }
    const id = `thread-${++threadCounter}`;
    send({ id: message.id, result: { thread: { id, sessionId: id } } });
    send({ method: "thread/started", params: { thread: { id } } });
    return;
  }

  if (message.method === "thread/fork") {
    if (process.env.MOCK_MALFORMED_RESULT === "thread/fork") {
      send({ id: message.id, result: { thread: {} } });
      return;
    }
    if (message.params?.ephemeral) {
      send({
        id: message.id,
        error: {
          code: -32602,
          message: "ephemeral thread does not support goals",
        },
      });
      return;
    }
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
    if (process.env.MOCK_MALFORMED_RESULT === "thread/goal/set") {
      send({ id: message.id, result: { goal: {} } });
      return;
    }
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
    if (process.env.MOCK_MALFORMED_RESULT === "thread/goal/get") {
      send({ id: message.id, result: { goal: {} } });
      return;
    }
    const threadId = message.params?.threadId;
    send({ id: message.id, result: { goal: goals.get(threadId) ?? null } });
    return;
  }

  if (message.method === "thread/goal/clear") {
    if (process.env.MOCK_MALFORMED_RESULT === "thread/goal/clear") {
      send({ id: message.id, result: { cleared: "yes" } });
      return;
    }
    const threadId = message.params?.threadId;
    goals.delete(threadId);
    if (process.env.MOCK_GOAL_CLEAR_MARKER) {
      await writeFile(process.env.MOCK_GOAL_CLEAR_MARKER, "cleared\n", "utf8");
    }
    send({ id: message.id, result: { cleared: true } });
    send({
      method: "thread/goal/cleared",
      params: { threadId },
    });
    return;
  }

  if (message.method === "turn/start") {
    if (process.env.MOCK_MALFORMED_RESULT === "turn/start") {
      send({ id: message.id, result: { turn: {} } });
      return;
    }
    const sandboxPolicy = message.params?.sandboxPolicy;
    const isReadOnlySandbox =
      sandboxPolicy?.type === "readOnly" &&
      typeof sandboxPolicy.networkAccess === "boolean";
    const isWorkspaceWriteSandbox =
      sandboxPolicy?.type === "workspaceWrite" &&
      Array.isArray(sandboxPolicy.writableRoots) &&
      typeof sandboxPolicy.networkAccess === "boolean" &&
      typeof sandboxPolicy.excludeTmpdirEnvVar === "boolean" &&
      typeof sandboxPolicy.excludeSlashTmp === "boolean";
    if (!isReadOnlySandbox && !isWorkspaceWriteSandbox) {
      send({
        id: message.id,
        error: { code: -32602, message: "Invalid sandbox policy" },
      });
      return;
    }
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
    if (process.env.MOCK_TURN_STARTED_FILE) {
      await writeFile(process.env.MOCK_TURN_STARTED_FILE, "started\n", "utf8");
    }

    if (
      process.env.MOCK_EXIT_DURING_REVIEW === "1" &&
      prompt.includes("Current phase")
    ) {
      setTimeout(() => process.exit(17), 10);
      return;
    }

    if (
      process.env.MOCK_HANG_TURN === "1" &&
      (prompt.includes("First, study the repository") ||
        prompt.includes("hang turn"))
    ) {
      return;
    }

    if (prompt.includes("emit observability")) {
      send({
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId: message.params.threadId,
          turnId,
          itemId: `reasoning-${turnId}`,
          summaryIndex: 0,
          delta: "Inspecting the repository.",
        },
      });
      send({
        method: "item/completed",
        params: {
          threadId: message.params.threadId,
          turnId,
          item: {
            type: "reasoning",
            id: `reasoning-${turnId}`,
            summary: [
              { type: "summary_text", text: "Inspecting the repository." },
            ],
          },
        },
      });
      send({
        method: "item/agentMessage/delta",
        params: {
          threadId: message.params.threadId,
          turnId,
          itemId: `item-${turnId}`,
          delta: "Repository ",
        },
      });
      send({
        method: "item/started",
        params: {
          threadId: message.params.threadId,
          turnId,
          startedAtMs: Date.now(),
          item: {
            type: "commandExecution",
            id: `command-${turnId}`,
            command: "git status --short",
            status: "inProgress",
          },
        },
      });
      send({
        method: "error",
        params: {
          threadId: message.params.threadId,
          turnId,
          willRetry: true,
          error: { message: "temporary mock error" },
        },
      });
    }

    let text = prompt.includes("emit observability")
      ? "Repository reviewed."
      : "Repository studied.";
    if (
      prompt.includes(
        "return the complete, minimal, executable remediation plan",
      )
    ) {
      text = "# Plan\n\n1. Create mock-fixed.txt.\n";
    } else if (
      prompt.includes("read PRE2PROD_PLAN.md and execute it completely")
    ) {
      await writeFile(resolve(cwd, "mock-fixed.txt"), "fixed\n", "utf8");
      const goal = goals.get(message.params.threadId);
      if (goal) {
        goal.status = process.env.MOCK_WORKER_GOAL_STATUS ?? "complete";
        goal.updatedAt = now();
        send({
          method: "thread/goal/updated",
          params: {
            threadId: message.params.threadId,
            turnId: "goal-turn",
            goal,
          },
        });
        return;
      }
      text = "Plan executed.";
    } else if (message.params.outputSchema) {
      const fixed = await access(resolve(cwd, "mock-fixed.txt"))
        .then(() => true)
        .catch(() => false);
      text = fixed
        ? JSON.stringify({ blockers: [], non_blockers: [] })
        : JSON.stringify({
            blockers: ["Create mock-fixed.txt"],
            non_blockers: [],
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
    const terminalStatus = prompt.includes("terminal turn")
      ? process.env.MOCK_TURN_STATUS
      : undefined;
    send({
      method: "turn/completed",
      params: {
        threadId: message.params.threadId,
        turn: {
          id: turnId,
          status: terminalStatus ?? "completed",
          items: [],
          error: terminalStatus
            ? { message: `mock ${terminalStatus} turn` }
            : null,
        },
      },
    });
    return;
  }

  if (message.id !== undefined) {
    send({ id: message.id, result: {} });
  }
});
