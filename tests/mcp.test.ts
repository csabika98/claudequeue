import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// The server resolves its working repo through the global config; point it at
// a throwaway directory so the tools operate on a fixture queue.md.
const activeRepo = vi.hoisted(() => ({ current: null as { id: string; name: string; path: string; addedAt: string } | null }));

vi.mock("../src/config.js", () => ({
  getActiveRepo: () => activeRepo.current,
}));

const { createMcpServer } = await import("../src/mcp.js");

let repo: string;
let client: Client;

function writeQueue(content: string): void {
  fs.writeFileSync(path.join(repo, "queue.md"), content);
}

function readQueue(): string {
  return fs.readFileSync(path.join(repo, "queue.md"), "utf-8");
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
  };
  return result.content.map((c) => c.text).join("\n");
}

async function callToolRaw(name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
}

beforeEach(async () => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "cq-mcp-"));
  activeRepo.current = { id: "fixture", name: "fixture", path: repo, addedAt: "2026-01-01" };

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    createMcpServer().connect(serverTransport),
  ]);
});

afterEach(async () => {
  await client.close();
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("tool registration", () => {
  it("advertises the five queue tools over the protocol", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_current_task",
      "get_project_context",
      "log_decision",
      "mark_task_done",
      "write_blocked",
    ]);
  });

  it("gives every tool a description so the model can choose between them", async () => {
    const { tools } = await client.listTools();
    expect(tools.every((t) => (t.description ?? "").length > 0)).toBe(true);
  });

  it("declares a required summary argument on mark_task_done", async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "mark_task_done")!.inputSchema;
    expect(schema.properties).toHaveProperty("summary");
    expect(schema.required).toContain("summary");
  });
});

describe("mark_task_done", () => {
  it("transitions the active task to DONE and records the summary", async () => {
    writeQueue("## [ACTIVE] Build the parser\nSome description.\n");

    const reply = await callTool("mark_task_done", { summary: "shipped it" });

    expect(reply).toContain("marked as DONE");
    expect(readQueue()).toContain("## [DONE] Build the parser");
    expect(readQueue()).toContain("shipped it");
  });

  it("reports when there is nothing active rather than failing", async () => {
    writeQueue("## [PENDING] Build the parser\n");

    expect(await callTool("mark_task_done", { summary: "nothing" })).toBe("No active task found");
  });

  it("reports a schema violation when summary is missing", async () => {
    writeQueue("## [ACTIVE] Build the parser\n");

    const result = await callToolRaw("mark_task_done", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/summary/);
    // The task must not have moved on an invalid call.
    expect(readQueue()).toContain("## [ACTIVE] Build the parser");
  });
});

describe("write_blocked", () => {
  it("transitions the active task to BLOCKED with the stated reason", async () => {
    writeQueue("## [ACTIVE] Build the parser\nSome description.\n");

    const reply = await callTool("write_blocked", { reason: "missing API key" });

    expect(reply).toContain("marked as BLOCKED");
    expect(readQueue()).toContain("## [BLOCKED] Build the parser");
    expect(readQueue()).toContain("missing API key");
  });

  it("reports when there is nothing active", async () => {
    writeQueue("## [PENDING] Build the parser\n");

    expect(await callTool("write_blocked", { reason: "x" })).toBe("No active task found");
  });
});

describe("log_decision", () => {
  it("writes the decision and reason into the queue", async () => {
    writeQueue("## [ACTIVE] Build the parser\nSome description.\n");

    const reply = await callTool("log_decision", {
      decision: "use a regex parser",
      reason: "the format is line-oriented",
    });

    expect(reply).toContain("Decision logged");
    expect(readQueue()).toContain("use a regex parser — the format is line-oriented");
  });
});

describe("get_current_task", () => {
  it("returns the active task with its acceptance criteria", async () => {
    writeQueue(
      "## [ACTIVE] Build the parser\nParse queue.md.\nAcceptance: handles all four status tags.\n"
    );

    const reply = await callTool("get_current_task");

    expect(reply).toContain("## [ACTIVE] Build the parser");
    expect(reply).toContain("Parse queue.md.");
    expect(reply).toContain("Acceptance: handles all four status tags.");
  });

  it("says so when no task is active", async () => {
    writeQueue("## [PENDING] Build the parser\n");

    expect(await callTool("get_current_task")).toBe("No active task");
  });
});

describe("get_project_context", () => {
  it("summarises counts for every status", async () => {
    writeQueue(
      [
        "## [DONE] First",
        "## [ACTIVE] Second",
        "## [PENDING] Third",
        "## [PENDING] Fourth",
        "## [BLOCKED] Fifth",
      ].join("\n")
    );

    const reply = await callTool("get_project_context");

    expect(reply).toContain("5 total tasks");
    expect(reply).toContain("Done: 1");
    expect(reply).toContain("Active: 1");
    expect(reply).toContain("Pending: 2");
    expect(reply).toContain("Blocked: 1");
  });

  it("lists every task with its status", async () => {
    writeQueue("## [DONE] First\n## [PENDING] Second\n");

    const reply = await callTool("get_project_context");

    expect(reply).toContain("[DONE] First");
    expect(reply).toContain("[PENDING] Second");
  });

  it("handles an empty queue", async () => {
    writeQueue("# Task Queue\n");

    expect(await callTool("get_project_context")).toContain("0 total tasks");
  });
});

describe("no active repo", () => {
  it("surfaces a clear error instead of silently doing nothing", async () => {
    activeRepo.current = null;

    const result = await callToolRaw("get_current_task");

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No active repo/);
  });
});
