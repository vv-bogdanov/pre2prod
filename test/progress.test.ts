import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsoleProgressReporter } from "../src/progress.js";

describe("ConsoleProgressReporter", () => {
  const context = {
    runId: "2026-01-01T00:00:00.000Z",
    phaseId: "foundation-immediate-risk-triage",
    phaseIndex: 1,
    phaseTitle: "Foundation: Immediate Risk Triage",
    phaseIteration: 1,
    phaseTotal: 5,
    threadRole: "reviewer" as const,
    phaseTurn: "review" as const,
    isRepeat: false,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pretty prints JSON messages across multiple lines", () => {
    const reporter = new ConsoleProgressReporter(false, true);
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    reporter.thinking('{"blockers":["x"],"non_blockers":["y"]}', context);

    const lines = consoleSpy.mock.calls.flatMap((call) =>
      String(call[0]).split("\n"),
    );
    const joined = lines.join("\n");
    expect(lines).toContain(
      "      [reviewer/review foundation-immediate-risk-triage#1] think:",
    );
    expect(lines).toContain("      {");
    expect(joined).toContain('  "blockers": [');
    expect(joined).toContain('  "non_blockers": [');
    expect(joined).toContain('"y"');
  });

  it("streams plain thinking text line-by-line", () => {
    const reporter = new ConsoleProgressReporter(false, true);
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    reporter.thinking("Line 1\nLine 2", context);

    const lines = consoleSpy.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("think: Line 1");
    expect(lines[1]).toContain("think: Line 2");
  });

  it("redacts sensitive values from observed output", () => {
    const reporter = new ConsoleProgressReporter(true, true);
    const consoleSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    reporter.command(
      'curl --header "Authorization: Bearer terminal-token"',
      "completed",
      context,
    );
    reporter.thinking(
      '{"apiKey":"terminal-key","apiSecret":"terminal-secret","safe":"keep-me"}',
      context,
    );
    reporter.result("token=terminal-result", context);
    reporter.thinking(
      "-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----",
      context,
    );

    const output = consoleSpy.mock.calls
      .map((call) => String(call[0]))
      .join("\n");
    expect(output).not.toContain("terminal-token");
    expect(output).not.toContain("terminal-key");
    expect(output).not.toContain("terminal-secret");
    expect(output).not.toContain("terminal-result");
    expect(output).not.toContain("private-key-body");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("keep-me");
  });
});
