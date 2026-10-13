import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";

import { buildSidebarProjectSnapshots } from "./sidebarProjectGrouping";

const environmentId = EnvironmentId.make("environment");
const repositoryIdentity = {
  canonicalKey: "github.com/owner/repo",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "git@github.com:owner/repo.git",
  },
  rootPath: "/work/repo",
  owner: "owner",
  name: "repo",
  displayName: "owner/repo",
};
const icon = { kind: "monogram" as const, text: "RP", color: "violet" as const };

function makeProject(
  id: string,
  workspaceRoot: string,
  overrides: Partial<EnvironmentProject> = {},
): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    workspaceRoot,
    repositoryIdentity,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function snapshots(projects: ReadonlyArray<EnvironmentProject>) {
  return buildSidebarProjectSnapshots({
    projects,
    settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
    primaryEnvironmentId: environmentId,
    resolveEnvironmentLabel: () => null,
  });
}

describe("buildSidebarProjectSnapshots project icons", () => {
  it("lends a member's icon to the group and to members without one", () => {
    const [group] = snapshots([
      makeProject("repo", "/work/repo"),
      makeProject("repo-feature", "/work/repo-feature", { projectIcon: icon }),
      makeProject("repo-fix", "/work/repo-fix"),
    ]);

    expect(group?.projectIcon).toEqual(icon);
    expect(group?.memberProjects.map((member) => member.projectIcon)).toEqual([icon, icon, icon]);
  });

  it("keeps a member's own icon over the group's", () => {
    const own = { kind: "emoji" as const, emoji: "🔧" };
    const [group] = snapshots([
      makeProject("repo", "/work/repo", { projectIcon: icon }),
      makeProject("repo-fix", "/work/repo-fix", { projectIcon: own }),
    ]);

    expect(group?.projectIcon).toEqual(icon);
    expect(group?.memberProjects.map((member) => member.projectIcon)).toEqual([icon, own]);
  });

  it("leaves members untouched when nobody chose an icon", () => {
    const [group] = snapshots([
      makeProject("repo", "/work/repo"),
      makeProject("repo-fix", "/work/repo-fix"),
    ]);

    expect(group?.projectIcon).toBeNull();
    expect(group?.memberProjects.every((member) => member.projectIcon === undefined)).toBe(true);
  });
});
