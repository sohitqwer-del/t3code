import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import { BearerConnectionTarget } from "@t3tools/client-runtime/connection";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentPresentation } from "../../state/environments";
import { makeThreadFixture } from "../../test-fixtures";
import { render } from "../../../test/render";
import { WorkspaceGraph } from "./WorkspaceGraph";
import "../../index.css";

const state = vi.hoisted(() => ({
  projects: [] as EnvironmentProject[],
  threads: [] as EnvironmentThreadShell[],
  environments: [] as EnvironmentPresentation[],
}));
vi.mock(import("../../state/entities"), () => ({
  useProjects: () => state.projects,
  useQuietThreadShells: () => state.threads,
  useHiddenThreadKeys: () => new Set<string>(),
  useAllEnvironmentShellsBootstrapped: () => true,
}));
vi.mock(import("../../state/environments"), () => ({
  useEnvironments: () => ({
    environments: state.environments,
    isReady: true,
    networkStatus: "online" as const,
    presentationById: new Map(),
  }),
}));
vi.mock(import("../../state/projects"), () => ({
  projectEnvironment: { createFromThread: { permissionAtom: () => Atom.make(false) } } as never,
}));
vi.mock(import("../../state/session"), () => ({
  useEnvironmentsWithScope: () => new Set<EnvironmentId>(),
}));
vi.mock(import("../../state/use-atom-command"), () => ({
  useAtomCommand: (() => async () => ({ _tag: "Success" })) as never,
}));
vi.mock(import("../../hooks/useHandleNewThread"), () => ({
  useNewThreadHandler: () => async () => null,
}));
vi.mock(import("../../commandPaletteBus"), () => ({ openCommandPalette: () => undefined }));

function setup() {
  localStorage.removeItem("t3code:workspace-todos:v1");
  localStorage.removeItem("t3code:auto-assign-scratch-projects:v1");
  const local = EnvironmentId.make("desktop");
  const remote = EnvironmentId.make("design-server");
  state.environments = [local, remote].map((environmentId) => ({
    environmentId,
    label: environmentId === local ? "Desktop" : "Design server",
    displayUrl: null,
    relayManaged: false,
    entry: {
      target: new BearerConnectionTarget({
        environmentId,
        connectionId: environmentId,
        label: environmentId,
      }),
      profile: Option.none(),
      enabled: true,
    },
    connection: {
      phase: environmentId === local ? "connected" : "offline",
      error: null,
      traceId: null,
    },
    serverConfig: null,
  }));
  state.projects = [local, remote].map((environmentId) => ({
    environmentId,
    id: ProjectId.make("app"),
    title: environmentId === local ? "Design system" : "Website",
    workspaceRoot: environmentId === local ? "C:/projects/design-system" : "/home/work/website",
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  }));
  state.threads = [
    makeThreadFixture({
      environmentId: local,
      projectId: ProjectId.make("app"),
      title: "Review navigation",
      hasPendingUserInput: true,
    }),
    makeThreadFixture({
      environmentId: remote,
      projectId: ProjectId.make("app"),
      title: "Update landing page",
      runtime: null,
    }),
  ];
}

it("filters across environments and keeps linked follow-ups and completion state after remounting", async () => {
  setup();
  await page.viewport(1280, 960);
  await using screen = await render(<WorkspaceGraph />);
  await expect.element(screen.getByRole("heading", { name: "Design server" })).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Add Review navigation to to-do list" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Add Review navigation to to-do list" }),
  );
  expect(
    screen.getByRole("checkbox", { name: "Complete Review navigation" }).elements(),
  ).toHaveLength(1);
  await userEvent.click(screen.getByRole("checkbox", { name: "Complete Review navigation" }));
  await userEvent.fill(
    screen.getByRole("searchbox", { name: "Search workspace graph" }),
    "landing",
  );
  await expect
    .element(screen.getByRole("link", { name: "Review navigation" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("link", { name: "Update landing page" })).toBeVisible();
  await screen.rerender(<WorkspaceGraph key="reopened" />);
  await expect
    .element(screen.getByRole("checkbox", { name: "Complete Review navigation" }))
    .toBeChecked();
  await expect
    .element(screen.getByRole("link", { name: "Open thread" }))
    .toHaveAttribute("href", "/desktop/thread-test");
  await userEvent.click(screen.getByRole("checkbox", { name: "Needs attention" }));
  await expect
    .element(screen.getByRole("link", { name: "Update landing page" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("link", { name: "Review navigation" })).toBeVisible();
  await userEvent.click(screen.getByRole("checkbox", { name: "Needs attention" }));
  await page.viewport(390, 844);
  await userEvent.click(screen.getByRole("button", { name: "Delete Review navigation" }));
  await expect.element(screen.getByRole("link", { name: "Open thread" })).not.toBeInTheDocument();
});
