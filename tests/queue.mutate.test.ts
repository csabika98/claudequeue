import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { parseTasks, updateTask, updateTaskStatus, appendDecision } from "../src/queue.js";

let repo: string;

function writeQueue(content: string): void {
  fs.writeFileSync(path.join(repo, "queue.md"), content);
}

function readQueue(): string {
  return fs.readFileSync(path.join(repo, "queue.md"), "utf-8");
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "cq-mutate-"));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("updateTaskStatus", () => {
  it("rewrites the status tag and preserves the title", () => {
    writeQueue("## [PENDING] Build the parser\nSome description.\n");

    updateTaskStatus(repo, "build-the-parser", "ACTIVE");

    const [task] = parseTasks(repo);
    expect(task.status).toBe("ACTIVE");
    expect(task.title).toBe("Build the parser");
  });

  it("preserves the task description across a status change", () => {
    writeQueue("## [PENDING] Build the parser\nSome description.\n");

    updateTaskStatus(repo, "build-the-parser", "DONE", "shipped it");

    expect(parseTasks(repo)[0].description).toContain("Some description.");
  });

  it("stamps a Completed note carrying the summary", () => {
    writeQueue("## [ACTIVE] Build the parser\nSome description.\n");

    updateTaskStatus(repo, "build-the-parser", "DONE", "shipped it");

    expect(readQueue()).toMatch(/> Completed: .+ — shipped it/);
  });

  it("stamps a Blocked note carrying the summary", () => {
    writeQueue("## [ACTIVE] Build the parser\nSome description.\n");

    updateTaskStatus(repo, "build-the-parser", "BLOCKED", "waiting on upstream");

    expect(readQueue()).toMatch(/> Blocked: .+ — waiting on upstream/);
  });

  it("stamps a Started note when a task becomes ACTIVE", () => {
    writeQueue("## [PENDING] Build the parser\nSome description.\n");

    updateTaskStatus(repo, "build-the-parser", "ACTIVE");

    expect(readQueue()).toMatch(/> Started: /);
  });

  it("replaces the previous status note instead of stacking duplicates", () => {
    writeQueue("## [PENDING] Build the parser\nSome description.\n");

    updateTaskStatus(repo, "build-the-parser", "ACTIVE");
    updateTaskStatus(repo, "build-the-parser", "DONE", "finished");

    const queue = readQueue();
    expect(queue.match(/> Started: /g) ?? []).toHaveLength(0);
    expect(queue.match(/> Completed: /g) ?? []).toHaveLength(1);
  });

  it("keeps a single status note across many transitions", () => {
    writeQueue("## [PENDING] Build the parser\nSome description.\n");

    updateTaskStatus(repo, "build-the-parser", "ACTIVE");
    updateTaskStatus(repo, "build-the-parser", "BLOCKED", "waiting");
    updateTaskStatus(repo, "build-the-parser", "ACTIVE");
    updateTaskStatus(repo, "build-the-parser", "DONE", "finished");

    const notes = readQueue().match(/^> (Started|Completed|Blocked):/gm) ?? [];
    expect(notes).toHaveLength(1);
  });

  it("keeps decisions while discarding the stale status note", () => {
    writeQueue("## [PENDING] Build the parser\nSome description.\n");

    updateTaskStatus(repo, "build-the-parser", "ACTIVE");
    appendDecision(repo, "use a regex parser", "the format is line-oriented");
    updateTaskStatus(repo, "build-the-parser", "DONE", "finished");

    const queue = readQueue();
    expect(queue).toContain("use a regex parser");
    expect(queue).not.toContain("> Started:");
  });

  it("leaves sibling tasks untouched", () => {
    writeQueue("## [PENDING] First\nbody one\n\n## [PENDING] Second\nbody two\n");

    updateTaskStatus(repo, "first", "DONE", "done");

    const tasks = parseTasks(repo);
    expect(tasks[1].status).toBe("PENDING");
    expect(tasks[1].description).toBe("body two");
  });

  it("throws when the queue file does not exist", () => {
    expect(() => updateTaskStatus(repo, "nope", "DONE")).toThrow(/queue\.md not found/);
  });

  it("preserves decisions logged against the task", () => {
    writeQueue("## [ACTIVE] Build the parser\nSome description.\n");
    appendDecision(repo, "use a regex parser", "the format is line-oriented");

    updateTaskStatus(repo, "build-the-parser", "DONE", "shipped it");

    expect(readQueue()).toContain("use a regex parser");
  });
});

describe("appendDecision", () => {
  it("records the decision and its reason under the active task", () => {
    writeQueue("## [ACTIVE] Build the parser\nSome description.\n");

    appendDecision(repo, "use a regex parser", "the format is line-oriented");

    expect(readQueue()).toMatch(/> Decision \[.+\]: use a regex parser — the format is line-oriented/);
  });

  it("appends to the end of the file when no task is active", () => {
    writeQueue("## [PENDING] Build the parser\nSome description.\n");

    appendDecision(repo, "defer the parser", "no active work");

    expect(readQueue().trimEnd()).toMatch(/defer the parser — no active work$/);
  });

  it("keeps earlier decisions when a second one is logged", () => {
    writeQueue("## [ACTIVE] Build the parser\nSome description.\n");

    appendDecision(repo, "first choice", "reason one");
    appendDecision(repo, "second choice", "reason two");

    const queue = readQueue();
    expect(queue).toContain("first choice");
    expect(queue).toContain("second choice");
  });

  it("throws when the queue file does not exist", () => {
    expect(() => appendDecision(repo, "d", "r")).toThrow(/queue\.md not found/);
  });
});

describe("updateTask", () => {
  it("renames a task while keeping its status", () => {
    writeQueue("## [ACTIVE] Old title\nSome description.\n");

    updateTask(repo, "old-title", { title: "New title" });

    const [task] = parseTasks(repo);
    expect(task.title).toBe("New title");
    expect(task.status).toBe("ACTIVE");
  });

  it("replaces the description and acceptance criteria", () => {
    writeQueue("## [PENDING] A task\nold description\nAcceptance: old criteria\n");

    updateTask(repo, "a-task", { description: "new description", acceptanceCriteria: "new criteria" });

    const [task] = parseTasks(repo);
    expect(task.description).toBe("new description");
    expect(task.acceptanceCriteria).toBe("new criteria");
  });

  it("throws when the queue file does not exist", () => {
    expect(() => updateTask(repo, "nope", { title: "x" })).toThrow(/queue\.md not found/);
  });
});
