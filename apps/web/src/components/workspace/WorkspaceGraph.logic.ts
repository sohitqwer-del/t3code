import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { EnvironmentId } from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

export function workspaceThreadState(thread: EnvironmentThreadShell) {
  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest != null
  )
    return "Needs input";
  const status = thread.runtime?.status ?? thread.latestRun?.status;
  if (status === "failed") return "Failed";
  if (
    status === "waiting" ||
    thread.blockedOnThreadWait ||
    backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks)
  )
    return "Waiting";
  if (status !== "idle" && isThreadWorking(thread)) return "Working";
  if (status === "completed") return "Completed";
  if (status === "cancelled" || status === "interrupted" || status === "rolled_back")
    return "Stopped";
  return "Idle";
}

export function workspaceThreadNeedsAttention(thread: EnvironmentThreadShell) {
  const state = workspaceThreadState(thread);
  return state === "Needs input" || state === "Failed" || state === "Waiting";
}

export function buildWorkspaceGraph(input: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly hiddenThreadKeys: ReadonlySet<string>;
  readonly query: string;
  readonly attentionOnly: boolean;
  readonly includeArchived: boolean;
}) {
  const query = input.query.trim().toLocaleLowerCase();
  const projectNodes = new Map(
    input.projects.map((project) => [
      JSON.stringify([project.environmentId, project.id]),
      { project, threads: [] as EnvironmentThreadShell[] },
    ]),
  );
  for (const thread of input.threads) {
    if (thread.deletedAt !== null || (!input.includeArchived && thread.archivedAt !== null))
      continue;
    if (input.hiddenThreadKeys.has(`${thread.environmentId}\u0000${thread.id}`)) continue;
    if (input.attentionOnly && !workspaceThreadNeedsAttention(thread)) continue;
    const node = projectNodes.get(JSON.stringify([thread.environmentId, thread.projectId]));
    if (!node) continue;
    if (
      query &&
      ![thread.title, thread.branch, node.project.title, node.project.workspaceRoot].some((text) =>
        text?.toLocaleLowerCase().includes(query),
      )
    )
      continue;
    node.threads.push(thread);
  }
  return input.environmentIds.map((environmentId) => ({
    environmentId,
    projects: [...projectNodes.values()]
      .filter(
        ({ project, threads }) =>
          project.environmentId === environmentId &&
          (input.includeArchived || project.archivedAt == null) &&
          (!input.attentionOnly || threads.length > 0) &&
          (!query ||
            threads.length > 0 ||
            project.title.toLocaleLowerCase().includes(query) ||
            project.workspaceRoot.toLocaleLowerCase().includes(query)),
      )
      .map(({ project, threads }) => ({
        project,
        threads: threads.sort(
          (a, b) =>
            Number(workspaceThreadNeedsAttention(b)) - Number(workspaceThreadNeedsAttention(a)) ||
            Number(workspaceThreadState(b) === "Working") -
              Number(workspaceThreadState(a) === "Working") ||
            b.updatedAt.localeCompare(a.updatedAt) ||
            a.id.localeCompare(b.id),
        ),
      }))
      .sort(
        (a, b) =>
          a.project.title.localeCompare(b.project.title) ||
          a.project.id.localeCompare(b.project.id),
      ),
  }));
}

export function scratchPromotionCandidates(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly scratchProjects: ReadonlyArray<EnvironmentProject>;
  readonly availableEnvironmentIds: ReadonlySet<EnvironmentId>;
}) {
  const scratchKeys = new Set(
    input.scratchProjects.map((project) => JSON.stringify([project.environmentId, project.id])),
  );
  const folders = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of input.threads) {
    if (
      thread.deletedAt !== null ||
      !thread.worktreePath ||
      !scratchKeys.has(JSON.stringify([thread.environmentId, thread.projectId])) ||
      !input.availableEnvironmentIds.has(thread.environmentId)
    )
      continue;
    const key = JSON.stringify([thread.environmentId, thread.worktreePath]);
    const siblings = folders.get(key) ?? [];
    siblings.push(thread);
    folders.set(key, siblings);
  }
  return [...folders.entries()].flatMap(([key, siblings]) => {
    // Promotion moves the whole folder, including archived siblings.
    if (
      siblings.some(
        (thread) =>
          workspaceThreadState(thread) === "Working" ||
          thread.runtime?.status === "waiting" ||
          thread.runtime?.activeRunId != null ||
          thread.hasPendingApprovals ||
          thread.hasPendingUserInput ||
          thread.pendingSubagentRequest != null ||
          thread.pendingBackgroundTasks.length > 0,
      )
    )
      return [];
    const thread = siblings.find(
      (candidate) => candidate.archivedAt === null && candidate.title.trim(),
    );
    return thread ? [{ key, thread }] : [];
  });
}
