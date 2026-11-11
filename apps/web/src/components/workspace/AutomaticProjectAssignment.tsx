import { useEffect, useRef } from "react";
import * as Schema from "effect/Schema";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useProjects, useQuietThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentsWithScope } from "../../state/session";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { scratchPromotionCandidates } from "./WorkspaceGraph.logic";

export function useAutomaticProjectAssignment() {
  return useLocalStorage("t3code:auto-assign-scratch-projects:v1", true, Schema.Boolean);
}

export function AutomaticProjectAssignment() {
  const [enabled] = useAutomaticProjectAssignment();
  return enabled ? <AssignmentCoordinator /> : null;
}

function AssignmentCoordinator() {
  const projects = useProjects();
  const threads = useQuietThreadShells();
  const { environments } = useEnvironments();
  const allowed = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope);
  const promote = useAtomCommand(projectEnvironment.createFromThread);
  const attempted = useRef(new Set<string>());
  const scratchProjects = projects.filter((project) =>
    isScratchProject(
      project,
      environments.find((environment) => environment.environmentId === project.environmentId)
        ?.serverConfig?.scratchWorkspaceRoot,
    ),
  );
  const availableEnvironmentIds = new Set(
    environments
      .filter(
        (environment) =>
          environment.connection.phase === "connected" &&
          environment.serverConfig?.environment.capabilities.threadProjectFromScratch === true &&
          allowed.has(environment.environmentId),
      )
      .map((environment) => environment.environmentId),
  );
  const candidates = scratchPromotionCandidates({
    threads,
    scratchProjects,
    availableEnvironmentIds,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes opted-in scratch folders with durable projects through the guarded server command
  useEffect(() => {
    let cancelled = false;
    const assign = async () => {
      for (const { key, thread } of candidates) {
        if (cancelled) break;
        if (attempted.current.has(key)) continue;
        attempted.current.add(key);
        await promote({ environmentId: thread.environmentId, input: { threadId: thread.id } });
      }
    };
    void assign();
    return () => {
      cancelled = true;
    };
  }, [candidates, promote]);
  return null;
}
