import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { selectProjectGroupingSettings } from "../logicalProject";
import { buildProjectBadgeMap, buildSidebarProjectSnapshots } from "../sidebarProjectGrouping";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useProjects } from "../state/entities";
import { useClientSettings } from "./useSettings";

export function useProjectBadge(project: EnvironmentProject | null) {
  const projects = useProjects();
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  if (project === null) return null;
  const groups = buildSidebarProjectSnapshots({
    projects,
    settings: groupingSettings,
    primaryEnvironmentId,
    resolveEnvironmentLabel: () => null,
  });
  return buildProjectBadgeMap(groups).get(`${project.environmentId}:${project.id}`) ?? project;
}
