import { useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  FolderIcon,
  GitBranchIcon,
  InboxIcon,
  ListPlusIcon,
  NetworkIcon,
  PlusIcon,
  ServerIcon,
} from "lucide-react";
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
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { WorkspaceTodos, useWorkspaceTodos } from "./WorkspaceTodos";
import { useAutomaticProjectAssignment } from "./AutomaticProjectAssignment";
import {
  buildWorkspaceGraph,
  groupThreadsByWorktree,
  workspaceThreadState,
  workspaceThreadNeedsAttention,
} from "./WorkspaceGraph.logic";

const VISIBLE_ITEMS = 8;

const STATE_BADGE = {
  "Needs input": "warning",
  Waiting: "warning",
  Failed: "error",
  Working: "info",
  Completed: "success",
  Stopped: "outline",
  Idle: "outline",
} as const;

const STATE_DOT = {
  "Needs input": "bg-warning",
  Waiting: "bg-warning",
  Failed: "bg-destructive",
  Working: "bg-info",
  Completed: "bg-success",
  Stopped: "bg-muted-foreground/40",
  Idle: "bg-muted-foreground/40",
} as const;

interface TreeControls {
  readonly isOpen: (key: string) => boolean;
  readonly toggle: (key: string) => void;
  readonly automatic: boolean;
  readonly addThread: (thread: EnvironmentThreadShell) => void;
}

export function WorkspaceGraph() {
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const hiddenThreadKeys = useHiddenThreadKeys();
  const { environments, isReady } = useEnvironments();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const [query, setQuery] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
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
  const filtering = query.trim() !== "" || attentionOnly;
  const controls: TreeControls = {
    // A filter shows every match, so collapsed branches reopen while it is active.
    isOpen: (key) => filtering || !collapsed.has(key),
    toggle: (key) =>
      setCollapsed((keys) => {
        const next = new Set(keys);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    automatic,
    addThread,
  };

  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, "Workspace graph")}
      role="main"
      className="h-dvh min-h-0 overflow-hidden"
    >
      <WorkspacePageHeader electron={isElectron}>
        <NetworkIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Workspace</span>
      </WorkspacePageHeader>
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto grid max-w-6xl items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <section aria-label="Workspace tree" className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-48 flex-1">
                <Input
                  type="search"
                  aria-label="Search workspace graph"
                  placeholder="Search projects, threads, branches, folders…"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </div>
              <Button variant="outline" onClick={() => openCommandPalette({ open: "add-project" })}>
                <PlusIcon />
                Project
              </Button>
              <Button onClick={() => openCommandPalette({ open: "new-thread-in" })}>
                <PlusIcon />
                Thread
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-2 text-foreground">
                <Checkbox checked={attentionOnly} onCheckedChange={setAttentionOnly} />
                Needs attention
              </label>
              <label className="flex items-center gap-2 text-foreground">
                <Checkbox checked={includeArchived} onCheckedChange={setIncludeArchived} />
                Archived
              </label>
              <span aria-live="polite" className="ml-auto">
                {graph.reduce((total, environment) => total + environment.projects.length, 0)}{" "}
                projects · {visibleThreads.length} threads · {working} working · {attention} need
                attention
              </span>
            </div>
            {!isReady || !bootstrapped ? (
              <p role="status" className="mt-4 text-sm text-muted-foreground">
                Loading connected workspaces…
              </p>
            ) : null}
            <div className="mt-4 space-y-3">
              {graph.map((node) => {
                const environment = environments.find(
                  (entry) => entry.environmentId === node.environmentId,
                );
                return environment ? (
                  <EnvironmentNode
                    key={node.environmentId}
                    environment={environment}
                    projects={node.projects}
                    filtering={filtering}
                    controls={controls}
                  />
                ) : null;
              })}
              {isReady && environments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Connect an environment to see its projects and threads.
                  </p>
                  <div className="mt-4">
                    <Button variant="outline" render={<Link to="/settings/connections" />}>
                      Open connections
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Shows loaded threads. Older settled threads stay available in thread search.{" "}
              <Link to="/settings/connections" className="underline underline-offset-4">
                Manage environments
              </Link>
            </p>
          </section>
          <aside className="space-y-4">
            <WorkspaceTodos />
            <section className="rounded-lg border border-border p-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Assign projects automatically</span>
                <Switch checked={automatic} onCheckedChange={setAutomatic} />
              </label>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                When a “No project” thread stops, its folder becomes a project named after the
                thread. Files stay in place. Runs on connected environments while this app is open.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </SidebarInset>
  );
}

function TreeToggle({
  label,
  open,
  onToggle,
}: {
  readonly label: string;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
      onClick={onToggle}
      className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <ChevronRightIcon className={cn("size-4", open && "rotate-90")} />
    </button>
  );
}

function TreeChildren({ children }: { readonly children: ReactNode }) {
  return <ul className="ml-[1.125rem] border-l border-border pl-2">{children}</ul>;
}

function EnvironmentNode({
  environment,
  projects,
  filtering,
  controls,
}: {
  readonly environment: EnvironmentPresentation;
  readonly projects: ReturnType<typeof buildWorkspaceGraph>[number]["projects"];
  readonly filtering: boolean;
  readonly controls: TreeControls;
}) {
  const key = `environment:${environment.environmentId}`;
  const open = controls.isOpen(key);
  const phase = environment.connection.phase;
  const connected = phase === "connected";
  return (
    <section aria-label={environment.label} className="rounded-lg border border-border bg-card">
      <div className="flex min-h-11 items-center gap-2 px-2">
        <TreeToggle label={environment.label} open={open} onToggle={() => controls.toggle(key)} />
        <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="min-w-0 truncate text-sm font-medium">{environment.label}</h2>
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            connected
              ? "bg-success"
              : phase === "error" || phase === "unsupported"
                ? "bg-destructive"
                : phase === "offline"
                  ? "bg-muted-foreground/40"
                  : "bg-warning",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {connectionStatusText(environment.connection)}
          {connected ? "" : " · status may be out of date"}
        </span>
        <span className="shrink-0 pr-2 text-xs text-muted-foreground">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </span>
      </div>
      {open ? (
        <div className="border-t border-border p-2">
          {projects.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {filtering
                ? "No matching work in this environment."
                : connected
                  ? "No projects yet. Add a project to start."
                  : "Projects appear when this environment connects."}
            </p>
          ) : (
            <ul>
              {projects.map(({ project, threads }) => (
                <ProjectNode
                  key={project.id}
                  project={project}
                  threads={threads}
                  environment={environment}
                  controls={controls}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ProjectNode({
  project,
  threads,
  environment,
  controls,
}: {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environment: EnvironmentPresentation;
  readonly controls: TreeControls;
}) {
  const handleNewThread = useNewThreadHandler();
  const [showAll, setShowAll] = useState(false);
  const scratch = isScratchProject(project, environment.serverConfig?.scratchWorkspaceRoot);
  const title = scratch ? "No project" : project.title;
  const key = `project:${project.environmentId}:${project.id}`;
  const open = controls.isOpen(key) && threads.length > 0;
  // Each No project thread has its own folder, so nesting by folder would add nothing.
  const items = scratch
    ? threads.map((thread) => ({ kind: "thread" as const, thread }))
    : groupThreadsByWorktree(threads);
  return (
    <li>
      <div className="flex min-h-9 items-center gap-2 rounded-md px-1 hover:bg-accent/50">
        {threads.length > 0 ? (
          <TreeToggle label={title} open={open} onToggle={() => controls.toggle(key)} />
        ) : (
          <span className="size-6 shrink-0" />
        )}
        {scratch ? (
          <InboxIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <h3 className="shrink-0 truncate text-sm font-medium max-sm:min-w-0 max-sm:shrink">
          {title}
          {project.archivedAt ? " · Archived" : ""}
        </h3>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {scratch
            ? controls.automatic
              ? "Each thread becomes a project when its work stops"
              : "Threads not assigned to a project"
            : project.workspaceRoot}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{threads.length}</span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`New thread in ${title}`}
          disabled={environment.connection.phase !== "connected" || project.archivedAt != null}
          onClick={() => void handleNewThread(scopeProjectRef(project.environmentId, project.id))}
        >
          <PlusIcon />
        </Button>
      </div>
      {open ? (
        <TreeChildren>
          {(showAll ? items : items.slice(0, VISIBLE_ITEMS)).map((item) =>
            item.kind === "thread" ? (
              <ThreadNode
                key={item.thread.id}
                thread={item.thread}
                scratch={scratch}
                environment={environment}
                controls={controls}
              />
            ) : (
              <WorktreeNode
                key={item.path}
                environment={environment}
                label={item.label}
                path={item.path}
                threads={item.threads}
                controls={controls}
              />
            ),
          )}
          {items.length > VISIBLE_ITEMS ? (
            <li className="py-1 pl-7">
              <Button size="sm" variant="ghost" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show fewer" : `Show ${items.length - VISIBLE_ITEMS} more`}
              </Button>
            </li>
          ) : null}
        </TreeChildren>
      ) : null}
    </li>
  );
}

function WorktreeNode({
  environment,
  label,
  path,
  threads,
  controls,
}: {
  readonly environment: EnvironmentPresentation;
  readonly label: string;
  readonly path: string;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly controls: TreeControls;
}) {
  const key = `worktree:${environment.environmentId}:${path}`;
  const open = controls.isOpen(key);
  return (
    <li>
      <div className="flex min-h-8 items-center gap-2 rounded-md px-1 hover:bg-accent/50">
        <TreeToggle label={`worktree ${label}`} open={open} onToggle={() => controls.toggle(key)} />
        <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 truncate font-mono text-xs max-sm:min-w-0 max-sm:shrink">
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{path}</span>
        <span className="shrink-0 pr-2 text-xs text-muted-foreground">{threads.length}</span>
      </div>
      {open ? (
        <TreeChildren>
          {threads.map((thread) => (
            <ThreadNode
              key={thread.id}
              thread={thread}
              scratch={false}
              nested
              environment={environment}
              controls={controls}
            />
          ))}
        </TreeChildren>
      ) : null}
    </li>
  );
}

function ThreadNode({
  thread,
  scratch,
  nested = false,
  environment,
  controls,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly scratch: boolean;
  readonly nested?: boolean;
  readonly environment: EnvironmentPresentation;
  readonly controls: TreeControls;
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
    <li className="flex min-h-8 items-center gap-2 rounded-md py-0.5 pr-1 pl-2 hover:bg-accent/50">
      <span className={cn("ml-1.5 size-2 shrink-0 rounded-full", STATE_DOT[state])} />
      <Link
        to="/$environmentId/$threadId"
        params={{ environmentId: thread.environmentId, threadId: thread.id }}
        className="min-w-0 flex-1 truncate rounded-sm text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {thread.title}
        {thread.archivedAt ? " · Archived" : ""}
      </Link>
      {thread.branch && !nested ? (
        <span className="hidden max-w-40 shrink-0 truncate font-mono text-xs text-muted-foreground sm:block">
          {thread.branch}
        </span>
      ) : null}
      <Badge variant={STATE_BADGE[state]}>{state}</Badge>
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
        onClick={() => controls.addThread(thread)}
      >
        <ListPlusIcon />
      </Button>
    </li>
  );
}
