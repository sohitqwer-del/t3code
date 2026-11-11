import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { makeThreadFixture } from "../../test-fixtures";
import {
  buildWorkspaceGraph,
  groupThreadsByWorktree,
  scratchPromotionCandidates,
  workspaceThreadState,
} from "./WorkspaceGraph.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const projectId = ProjectId.make("shared-id");
function project(environmentId = local): EnvironmentProject {
  return {
    environmentId,
    id: projectId,
    title: "App",
    workspaceRoot: "/repo",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
}
function thread(environmentId = local) {
  return makeThreadFixture({
    environmentId,
    id: ThreadId.make("shared-thread"),
    projectId,
    title: "Fix login",
    worktreePath: "/scratch/login",
    runtime: null,
  });
}
const graphInput = () => ({
  environmentIds: [local, remote],
  projects: [project(), project(remote)],
  threads: [thread(), thread(remote)],
  hiddenThreadKeys: new Set<string>(),
  query: "",
  attentionOnly: false,
  includeArchived: false,
});

describe("workspace graph", () => {
  it("keeps equal project and thread ids on separate environments and retains empty environments", () => {
    const input = graphInput();
    const graph = buildWorkspaceGraph(input);
    expect(
      graph.map((node) => node.projects[0]?.threads.map((entry) => entry.environmentId)),
    ).toEqual([[local], [remote]]);
    expect(buildWorkspaceGraph({ ...input, projects: [project()] })[1]).toEqual({
      environmentId: remote,
      projects: [],
    });
  });

  it("filters hidden, archived, deleted and unrelated threads while searching branches", () => {
    const input = graphInput();
    input.threads = [
      thread(),
      { ...thread(remote), branch: "feature/access" },
      { ...thread(), id: ThreadId.make("deleted"), deletedAt: "2026-11-02" },
      { ...thread(), id: ThreadId.make("archived"), archivedAt: "2026-11-02" },
    ];
    expect(
      buildWorkspaceGraph({ ...input, query: "access" })[1]?.projects[0]?.threads,
    ).toHaveLength(1);
    expect(
      buildWorkspaceGraph({
        ...input,
        hiddenThreadKeys: new Set([`${local}\u0000shared-thread`]),
      })[0]?.projects[0]?.threads,
    ).toHaveLength(0);
    expect(
      buildWorkspaceGraph({ ...input, includeArchived: true })[0]?.projects[0]?.threads,
    ).toHaveLength(2);
  });

  it("prioritizes actionable threads without treating an idle runtime as working", () => {
    const idle = thread();
    const runtime = {
      status: "idle" as const,
      activeRunId: null,
      providerInstanceId: idle.providerInstanceId,
      providerName: null,
      lastError: null,
      updatedAt: idle.updatedAt,
    };
    expect(workspaceThreadState({ ...idle, runtime })).toBe("Idle");
    expect(workspaceThreadState({ ...idle, runtime: { ...runtime, status: "waiting" } })).toBe(
      "Waiting",
    );
    const failed = {
      ...idle,
      id: ThreadId.make("failed"),
      runtime: { ...runtime, status: "failed" as const },
    };
    const graph = buildWorkspaceGraph({
      ...graphInput(),
      threads: [idle, failed],
      attentionOnly: true,
    });
    expect(graph[0]?.projects[0]?.threads.map((entry) => entry.id)).toEqual([failed.id]);
    const working = {
      ...idle,
      id: ThreadId.make("working"),
      runtime: { ...runtime, status: "running" as const },
    };
    expect(
      buildWorkspaceGraph({ ...graphInput(), threads: [idle, working] })[0]?.projects[0]?.threads[0]
        ?.id,
    ).toBe(working.id);
  });

  it("nests threads that share a worktree and finds them by worktree folder", () => {
    const solo = { ...thread(), id: ThreadId.make("solo"), worktreePath: "/wt/solo" };
    const first = {
      ...thread(),
      id: ThreadId.make("first"),
      branch: null,
      worktreePath: "C:\\wt\\pair",
    };
    const second = { ...first, id: ThreadId.make("second"), branch: "feat/pair" };
    const root = { ...thread(), id: ThreadId.make("root"), worktreePath: null };
    expect(
      groupThreadsByWorktree([first, solo, root, second]).map((item) =>
        item.kind === "worktree"
          ? [item.label, item.threads.map((entry) => entry.id)]
          : item.thread.id,
      ),
    ).toEqual([["feat/pair", [first.id, second.id]], solo.id, root.id]);
    expect(groupThreadsByWorktree([first, { ...first, id: second.id }])[0]).toMatchObject({
      label: "pair",
    });
    expect(
      buildWorkspaceGraph({ ...graphInput(), threads: [solo, root], query: "wt/solo" })[0]
        ?.projects[0]?.threads,
    ).toEqual([solo]);
  });
});

describe("automatic project assignment", () => {
  it("deduplicates a folder within its environment, and leaves disconnected environments alone", () => {
    const input = {
      threads: [thread(), { ...thread(), id: ThreadId.make("sibling") }, thread(remote)],
      scratchProjects: [project(), project(remote)],
      availableEnvironmentIds: new Set([local]),
    };
    expect(scratchPromotionCandidates(input).map((entry) => entry.thread.environmentId)).toEqual([
      local,
    ]);
    expect(
      scratchPromotionCandidates({ ...input, availableEnvironmentIds: new Set([local, remote]) }),
    ).toHaveLength(2);
    expect(scratchPromotionCandidates({ ...input, scratchProjects: [] })).toEqual([]);
  });

  it.each(["running", "waiting", "approval", "input", "background", "active-run"])(
    "waits for a %s sibling, including archived siblings",
    (state) => {
      const sibling = {
        ...thread(),
        id: ThreadId.make("busy"),
        archivedAt: "2026-11-02",
        hasPendingApprovals: state === "approval",
        hasPendingUserInput: state === "input",
        runtime: {
          status:
            state === "waiting"
              ? ("waiting" as const)
              : state === "running"
                ? ("running" as const)
                : ("idle" as const),
          activeRunId: state === "active-run" ? RunId.make("run") : null,
          providerInstanceId: thread().providerInstanceId,
          providerName: null,
          lastError: null,
          updatedAt: thread().updatedAt,
        },
      };
      const busy =
        state === "background"
          ? {
              ...sibling,
              pendingBackgroundTasks: [
                {
                  taskId: "task",
                  description: "Watch build",
                  kind: "monitor" as const,
                  awaited: true as const,
                },
              ],
            }
          : sibling;
      expect(
        scratchPromotionCandidates({
          threads: [thread(), busy],
          scratchProjects: [project()],
          availableEnvironmentIds: new Set([local]),
        }),
      ).toEqual([]);
    },
  );
});
