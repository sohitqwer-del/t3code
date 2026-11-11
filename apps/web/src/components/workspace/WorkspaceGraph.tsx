import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { FolderIcon, NetworkIcon, PlusIcon, ServerIcon } from "lucide-react";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { openCommandPalette } from "../../commandPaletteBus";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import {
  useHiddenThreadKeys,
  useProjects,
  useQuietThreadShells,
  useAllEnvironmentShellsBootstrapped,
} from "../../state/entities";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { projectEnvironment } from "../../state/projects";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { cn } from "../../lib/utils";
import { isElectron } from "../../env";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { SidebarInset } from "../ui/sidebar";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { WorkspaceTodos, useWorkspaceTodos } from "./WorkspaceTodos";
import { useAutomaticProjectAssignment } from "./AutomaticProjectAssignment";
import {
  buildWorkspaceGraph,
  workspaceThreadState,
  workspaceThreadNeedsAttention,
} from "./WorkspaceGraph.logic";

export function WorkspaceGraph() {
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const hiddenThreadKeys = useHiddenThreadKeys();
  const { environments, isReady } = useEnvironments();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const [query, setQuery] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [automatic, setAutomatic] = useAutomaticProjectAssignment();
  const { addThread } = useWorkspaceTodos();
  const graph = buildWorkspaceGraph({
    environmentIds: environments.map((environment) => environment.environmentId),
    projects,
    threads,
    hiddenThreadKeys,
    query,
    attentionOnly,
    includeArchived,
  });
  const visibleThreads = graph.flatMap((environment) =>
    environment.projects.flatMap((project) => project.threads),
  );
  const working = visibleThreads.filter(
    (thread) => workspaceThreadState(thread) === "Working",
  ).length;
  const attention = visibleThreads.filter(workspaceThreadNeedsAttention).length;

  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, "Workspace graph")}
      role="main"
      className="h-dvh min-h-0 overflow-hidden"
    >
      <WorkspacePageHeader electron={isElectron}>
        <NetworkIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Workspace graph</span>
      </WorkspacePageHeader>
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Your work, connected</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Environments → projects → threads. Pick up where you left off.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => openCommandPalette({ open: "add-project" })}>
                <PlusIcon />
                Add project
              </Button>
              <Button onClick={() => openCommandPalette({ open: "new-thread-in" })}>
                <PlusIcon />
                New thread
              </Button>
              <Button variant="ghost" render={<Link to="/settings/connections" />}>
                Environments
              </Button>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-live="polite">
            <span>
              <strong>{environments.length}</strong> environments
            </span>
            <span>
              <strong>
                {graph.reduce((total, environment) => total + environment.projects.length, 0)}
              </strong>{" "}
              projects shown
            </span>
            <span>
              <strong>{working}</strong> working
            </span>
            <span>
              <strong>{attention}</strong> need attention
            </span>
          </div>
          <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
            <section aria-label="Environment and project graph" className="min-w-0">
              <div className="mb-5 flex flex-wrap items-center gap-4">
                <div className="min-w-48 flex-1">
                  <Input
                    type="search"
                    aria-label="Search workspace graph"
                    placeholder="Find a project, thread, or branch…"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={attentionOnly} onCheckedChange={setAttentionOnly} />
                  Needs attention
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={includeArchived} onCheckedChange={setIncludeArchived} />
                  Archived
                </label>
              </div>
              {!isReady || !bootstrapped ? (
                <p role="status" className="mb-4 text-sm text-muted-foreground">
                  Loading connected workspaces…
                </p>
              ) : null}
              <div className="space-y-8">
                {graph.map((node) => {
                  const environment = environments.find(
                    (entry) => entry.environmentId === node.environmentId,
                  );
                  if (!environment) return null;
                  return (
                    <section key={node.environmentId} aria-label={environment.label}>
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-4">
                        <ServerIcon className="size-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate font-medium">{environment.label}</h2>
                          <p className="break-words text-xs text-muted-foreground">
                            {connectionStatusText(environment.connection)}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {node.projects.length} projects
                        </span>
                      </div>
                      {environment.connection.phase !== "connected" ? (
                        <p className="ml-6 border-l border-border px-5 pt-3 text-xs text-muted-foreground">
                          Showing available local state. Thread status may be out of date until this
                          environment reconnects.
                        </p>
                      ) : null}
                      <div className="ml-6 space-y-4 border-l border-border pt-4 pl-5">
                        {node.projects.map(({ project, threads: projectThreads }) => (
                          <ProjectNode
                            key={project.id}
                            project={project}
                            threads={projectThreads}
                            environment={environment}
                            addThread={addThread}
                          />
                        ))}
                        {node.projects.length === 0 ? (
                          <p className="py-4 text-sm text-muted-foreground">
                            {query || attentionOnly
                              ? "No matching work in this environment."
                              : environment.connection.phase === "connected"
                                ? "No projects yet. Add a project to start."
                                : "Projects will appear when this environment connects."}
                          </p>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
                {isReady && environments.length === 0 ? (
                  <p className="py-8 text-sm text-muted-foreground">
                    Connect an environment to see its projects and threads.
                  </p>
                ) : null}
              </div>
              <p className="mt-6 text-xs text-muted-foreground">
                Shows loaded threads. Archived work is optional; older settled threads remain
                available in thread search.
              </p>
            </section>
            <aside className="space-y-4">
              <WorkspaceTodos />
              <section
                className="rounded-xl border border-border p-4"
                aria-labelledby="automatic-projects-title"
              >
                <label className="flex items-start gap-3">
                  <Checkbox checked={automatic} onCheckedChange={setAutomatic} />
                  <span id="automatic-projects-title" className="text-sm font-medium">
                    Automatically assign projects
                  </span>
                </label>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Turn each unassigned thread’s scratch folder into a project after its work stops.
                  Threads sharing a folder stay together. Files stay in place.
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Applies to connected environments while this client is open. This browser
                  remembers your choice. Turn it off to stop; failed assignments can be retried with
                  “Make project”.
                </p>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function ProjectNode({
  project,
  threads,
  environment,
  addThread,
}: {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environment: EnvironmentPresentation;
  readonly addThread: (thread: EnvironmentThreadShell) => void;
}) {
  const handleNewThread = useNewThreadHandler();
  const [showAll, setShowAll] = useState(false);
  const scratch = isScratchProject(project, environment.serverConfig?.scratchWorkspaceRoot);
  return (
    <div className="relative rounded-xl border border-border bg-card before:absolute before:top-6 before:-left-5 before:w-5 before:border-t before:border-border">
      <div className="flex items-center gap-3 p-4">
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">
            {project.title}
            {project.archivedAt ? " · Archived" : ""}
          </h3>
          <p className="break-all text-xs text-muted-foreground">
            {scratch ? "Unassigned threads" : project.workspaceRoot}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{threads.length}</span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`New thread in ${project.title}`}
          disabled={environment.connection.phase !== "connected" || project.archivedAt != null}
          onClick={() => void handleNewThread(scopeProjectRef(project.environmentId, project.id))}
        >
          <PlusIcon />
        </Button>
      </div>
      {threads.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">No matching threads.</p>
      ) : (
        <ul className="ml-6 mr-3 mb-4 space-y-2 border-l border-border pl-3">
          {(showAll ? threads : threads.slice(0, 8)).map((thread) => (
            <ThreadNode
              key={thread.id}
              thread={thread}
              scratch={scratch}
              environment={environment}
              addThread={addThread}
            />
          ))}
        </ul>
      )}
      {threads.length > 8 ? (
        <div className="px-4 pb-3">
          <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer" : `Show all ${threads.length} threads`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ThreadNode({
  thread,
  scratch,
  environment,
  addThread,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly scratch: boolean;
  readonly environment: EnvironmentPresentation;
  readonly addThread: (thread: EnvironmentThreadShell) => void;
}) {
  const promote = useAtomCommand(projectEnvironment.createFromThread);
  const canAssign = useAtomValue(
    projectEnvironment.createFromThread.permissionAtom(thread.environmentId),
  );
  const [assigning, setAssigning] = useState(false);
  const state = workspaceThreadState(thread);
  const canPromote =
    canAssign &&
    scratch &&
    thread.worktreePath !== null &&
    environment.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities.threadProjectFromScratch === true;
  return (
    <li className="relative flex flex-wrap items-center gap-2 rounded-lg bg-secondary/35 px-3 py-2 before:absolute before:top-5 before:-left-3 before:w-3 before:border-t before:border-border">
      <Link
        to="/$environmentId/$threadId"
        params={{ environmentId: thread.environmentId, threadId: thread.id }}
        className="min-w-0 flex-1 rounded-sm text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="block truncate">
          {thread.title}
          {thread.archivedAt ? " · Archived" : ""}
        </span>
        {thread.branch ? (
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {thread.branch}
          </span>
        ) : null}
      </Link>
      <span
        className={cn(
          "text-xs",
          state === "Failed"
            ? "text-destructive"
            : workspaceThreadNeedsAttention(thread)
              ? "text-warning-foreground"
              : "text-muted-foreground",
        )}
      >
        {state}
      </span>
      {canPromote ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={
            assigning || state === "Working" || state === "Waiting" || state === "Needs input"
          }
          onClick={async () => {
            setAssigning(true);
            await promote({ environmentId: thread.environmentId, input: { threadId: thread.id } });
            setAssigning(false);
          }}
        >
          {assigning ? "Assigning…" : "Make project"}
        </Button>
      ) : null}
      <Button
        size="icon-micro"
        variant="ghost"
        aria-label={`Add ${thread.title} to to-do list`}
        onClick={() => addThread(thread)}
      >
        <PlusIcon />
      </Button>
    </li>
  );
}
