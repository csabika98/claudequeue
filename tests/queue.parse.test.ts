import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { parseTasks, getNextPending, writeQueueTemplate } from "../src/queue.js";

let repo: string;

function writeQueue(content: string): void {
  fs.writeFileSync(path.join(repo, "queue.md"), content);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "cq-parse-"));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("parseTasks", () => {
  it("returns an empty list when queue.md is absent", () => {
    expect(parseTasks(repo)).toEqual([]);
  });

  it("returns an empty list for a file with no task headings", () => {
    writeQueue("# Task Queue\n\nSome preamble prose.\n");
    expect(parseTasks(repo)).toEqual([]);
  });

  it("extracts status, title, slug id and 1-based index", () => {
    writeQueue("## [PENDING] Build the parser\n");

    const [task] = parseTasks(repo);
    expect(task.status).toBe("PENDING");
    expect(task.title).toBe("Build the parser");
    expect(task.id).toBe("build-the-parser");
    expect(task.index).toBe(1);
  });

  it("numbers tasks sequentially regardless of status", () => {
    writeQueue(
      [
        "## [DONE] First",
        "## [ACTIVE] Second",
        "## [PENDING] Third",
        "## [BLOCKED] Fourth",
      ].join("\n")
    );

    expect(parseTasks(repo).map((t) => [t.index, t.status])).toEqual([
      [1, "DONE"],
      [2, "ACTIVE"],
      [3, "PENDING"],
      [4, "BLOCKED"],
    ]);
  });

  it("slugifies punctuation and collapses separators", () => {
    writeQueue("## [PENDING] Task 1 — Set up CI/CD (phase 2)!\n");
    expect(parseTasks(repo)[0].id).toBe("task-1-set-up-ci-cd-phase-2");
  });

  it("splits the body into description and acceptance criteria", () => {
    writeQueue(
      [
        "## [PENDING] Add retries",
        "Retry failed runs with exponential backoff.",
        "Acceptance: a failing run is retried three times before it is marked BLOCKED.",
      ].join("\n")
    );

    const [task] = parseTasks(repo);
    expect(task.description).toBe("Retry failed runs with exponential backoff.");
    expect(task.acceptanceCriteria).toBe(
      "a failing run is retried three times before it is marked BLOCKED."
    );
  });

  it("keeps multi-line acceptance criteria together", () => {
    writeQueue(
      [
        "## [PENDING] Add retries",
        "Description line.",
        "Acceptance:",
        "- retries three times",
        "- then marks the task BLOCKED",
      ].join("\n")
    );

    expect(parseTasks(repo)[0].acceptanceCriteria).toBe(
      "- retries three times\n- then marks the task BLOCKED"
    );
  });

  it("treats a body with no acceptance line as all description", () => {
    writeQueue("## [PENDING] Add retries\nJust a description.\n");

    const [task] = parseTasks(repo);
    expect(task.description).toBe("Just a description.");
    expect(task.acceptanceCriteria).toBe("");
  });

  it("stops a task body at the next task heading", () => {
    writeQueue(
      ["## [PENDING] First", "body of first", "## [PENDING] Second", "body of second"].join("\n")
    );

    const tasks = parseTasks(repo);
    expect(tasks[0].rawBody).toBe("body of first");
    expect(tasks[1].rawBody).toBe("body of second");
  });

  it("ignores headings with an unrecognised status tag", () => {
    writeQueue("## [WONTFIX] Not a real status\n## [PENDING] Real task\n");

    const tasks = parseTasks(repo);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Real task");
  });
});

describe("getNextPending", () => {
  it("returns null when nothing is pending", () => {
    writeQueue("## [DONE] First\n## [ACTIVE] Second\n");
    expect(getNextPending(repo)).toBeNull();
  });

  it("returns the first PENDING task in file order", () => {
    writeQueue("## [DONE] First\n## [PENDING] Second\n## [PENDING] Third\n");
    expect(getNextPending(repo)?.title).toBe("Second");
  });

  it("returns null for a repo with no queue file", () => {
    expect(getNextPending(repo)).toBeNull();
  });
});

describe("writeQueueTemplate", () => {
  it("writes a template that parses back into pending tasks", () => {
    writeQueueTemplate(repo);

    const tasks = parseTasks(repo);
    expect(tasks).toHaveLength(3);
    expect(tasks.every((t) => t.status === "PENDING")).toBe(true);
    expect(tasks.every((t) => t.acceptanceCriteria.length > 0)).toBe(true);
  });
});
