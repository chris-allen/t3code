// @effect-diagnostics nodeBuiltinImport:off - realpathSync.native resolves Windows 8.3 short names, which the Effect realPath does not.
import * as NodeFS from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { RepositoryIdentity } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Path from "effect/Path";
import * as KeyValueStore from "effect/persistence/KeyValueStore";

import * as ProcessRunner from "../processRunner.ts";
import * as RepositoryIdentityMemory from "./RepositoryIdentityMemory.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";

const normalizePathSeparators = (value: string) => value.replaceAll("\\", "/");
const normalizeResolvedPath = (value: string) => normalizePathSeparators(value);

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    return yield* processRunner.run({
      command: "git",
      args: ["-C", cwd, ...args],
    });
  }).pipe(Effect.provide(ProcessRunner.layer));

it.layer(NodeServices.layer)("RepositoryIdentityResolverLive", (it) => {
  it.effect("normalizes equivalent GitHub remotes into a stable repository identity", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-repository-identity-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:T3Tools/t3code.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);
      // Native realpath matches git's long paths when Windows temp dirs use 8.3 names.
      const resolvedIdentityRoot =
        identity?.rootPath === undefined ? "" : NodeFS.realpathSync.native(identity.rootPath);
      const resolvedCwd = NodeFS.realpathSync.native(cwd);

      expect(identity).not.toBeNull();
      expect(identity?.canonicalKey).toBe("github.com/t3tools/t3code");
      expect(normalizeResolvedPath(resolvedIdentityRoot)).toBe(normalizeResolvedPath(resolvedCwd));
      expect(identity?.displayName).toBe("T3Tools/t3code");
      expect(identity?.provider).toBe("github");
      expect(identity?.owner).toBe("T3Tools");
      expect(identity?.name).toBe("t3code");
      expect(yield* resolver.resolve(path.join(cwd, ".git"))).toBeNull();
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("resolves the fetch remote of a partial clone", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-repository-identity-partial-clone-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:T3Tools/t3code.git"]);
      yield* git(cwd, ["remote", "set-url", "--push", "origin", "git@github.com:T3Tools/push.git"]);
      yield* git(cwd, ["config", "remote.origin.promisor", "true"]);
      yield* git(cwd, ["config", "remote.origin.partialclonefilter", "blob:none"]);

      const remotes = yield* git(cwd, ["remote", "-v"]);
      expect(remotes.stdout).toContain("(fetch) [blob:none]");

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);
      expect(identity?.canonicalKey).toBe("github.com/t3tools/t3code");
      expect(identity?.locator.remoteUrl).toBe("git@github.com:T3Tools/t3code.git");
      expect(identity?.locator.remoteName).toBe("origin");
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("returns the git top-level root path when resolving from a nested workspace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repoRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-repository-identity-nested-root-test-",
      });
      const nestedWorkspace = path.join(repoRoot, "packages", "web");

      yield* fileSystem.makeDirectory(nestedWorkspace, { recursive: true });
      yield* git(repoRoot, ["init"]);
      yield* git(repoRoot, ["remote", "add", "origin", "git@github.com:T3Tools/t3code.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(nestedWorkspace);
      const resolvedIdentityRoot =
        identity?.rootPath === undefined ? "" : NodeFS.realpathSync.native(identity.rootPath);
      const resolvedRepoRoot = NodeFS.realpathSync.native(repoRoot);

      expect(identity).not.toBeNull();
      expect(identity?.canonicalKey).toBe("github.com/t3tools/t3code");
      expect(normalizeResolvedPath(resolvedIdentityRoot)).toBe(
        normalizeResolvedPath(resolvedRepoRoot),
      );
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect.each(["bare clone", "dot-bare"] as const)(
    "resolves a %s to its Git directory and the same identity as a checkout",
    (layout) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const checkout = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-repository-identity-checkout-",
        });
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-repository-identity-bare-",
        });
        const bareGitDir = layout === "dot-bare" ? path.join(root, ".bare") : root;

        yield* git(checkout, ["init"]);
        yield* git(checkout, ["remote", "add", "origin", "git@github.com:T3Tools/t3code.git"]);
        yield* git(root, ["init", "--bare", bareGitDir]);
        if (layout === "dot-bare") {
          yield* fileSystem.writeFileString(path.join(root, ".git"), "gitdir: ./.bare\n");
        }
        yield* git(root, [
          "--git-dir",
          bareGitDir,
          "remote",
          "add",
          "origin",
          "https://github.com/T3Tools/t3code.git",
        ]);

        const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
        const checkoutIdentity = yield* resolver.resolve(checkout);
        expect(checkoutIdentity?.canonicalKey).toBe("github.com/t3tools/t3code");
        const resolvedBareGitDir = NodeFS.realpathSync.native(bareGitDir);
        const projectRoots = layout === "dot-bare" ? [root, bareGitDir] : [root];

        for (const projectRoot of projectRoots) {
          const identity = yield* resolver.resolve(projectRoot);
          const resolvedIdentityRoot =
            identity?.rootPath === undefined ? "" : NodeFS.realpathSync.native(identity.rootPath);

          expect(identity).not.toBeNull();
          expect(identity?.canonicalKey).toBe(checkoutIdentity?.canonicalKey);
          expect(normalizeResolvedPath(resolvedIdentityRoot)).toBe(
            normalizeResolvedPath(resolvedBareGitDir),
          );
        }

        yield* git(root, ["--git-dir", bareGitDir, "remote", "remove", "origin"]);
        for (const projectRoot of projectRoots) {
          expect(yield* resolver.resolve(projectRoot, { refresh: true })).toBeNull();
        }
      }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect(
    "returns null for non-git, missing and no-remote folders, probing only what can exist",
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const nonGitDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-repository-identity-non-git-",
        });
        const gitDir = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-repository-identity-no-remote-",
        });

        yield* git(gitDir, ["init"]);

        const runner = yield* ProcessRunner.ProcessRunner;
        const runs: Array<ReadonlyArray<string>> = [];
        const resolver = yield* RepositoryIdentityResolver.make().pipe(
          Effect.provideService(ProcessRunner.ProcessRunner, {
            run: (input) =>
              Effect.suspend(() => {
                runs.push(input.args);
                return runner.run(input);
              }),
          }),
        );
        const bareProbes = () =>
          runs.filter((args) => args.some((arg) => arg.startsWith("--git-dir=")));

        expect(yield* resolver.resolve(path.join(nonGitDir, "deleted"))).toBeNull();
        expect(runs).toEqual([]);

        expect(yield* resolver.resolve(nonGitDir)).toBeNull();
        expect(bareProbes()).toEqual([]);

        expect(yield* resolver.resolve(gitDir)).toBeNull();
      }).pipe(Effect.provide(ProcessRunner.layer)),
  );

  it.effect("ignores local-path remotes such as GitButler's gb-local", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const localOnlyDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-repository-identity-local-remote-",
      });
      const mixedDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-repository-identity-mixed-remote-",
      });

      yield* git(localOnlyDir, ["init"]);
      yield* git(localOnlyDir, ["remote", "add", "gb-local", "."]);
      yield* git(localOnlyDir, ["remote", "add", "backup", "/srv/git/repo.git"]);
      yield* git(localOnlyDir, ["remote", "add", "archive", "file:///srv/git/repo.git"]);
      yield* git(mixedDir, ["init"]);
      yield* git(mixedDir, ["remote", "add", "gb-local", "."]);
      yield* git(mixedDir, ["remote", "add", "mirror", "git@github.com:T3Tools/t3code.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      expect(yield* resolver.resolve(localOnlyDir)).toBeNull();

      const mixedIdentity = yield* resolver.resolve(mixedDir);
      expect(mixedIdentity?.locator.remoteName).toBe("mirror");
      expect(mixedIdentity?.canonicalKey).toBe("github.com/t3tools/t3code");
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect.each(["add", "replace"] as const)(
    "refreshes the primary remote after %s before cache expiry",
    (change) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const cwd = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-repository-identity-upstream-test-",
        });

        yield* git(cwd, ["init"]);
        yield* git(cwd, ["remote", "add", "upstream", "git@github.com:julius/t3code.git"]);
        if (change === "replace") {
          yield* git(cwd, ["remote", "add", "origin", "git@github.com:T3Tools/previous.git"]);
        }

        const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
        const initialIdentity = yield* resolver.resolve(cwd);
        expect(initialIdentity?.canonicalKey).toBe(
          change === "add" ? "github.com/julius/t3code" : "github.com/t3tools/previous",
        );

        yield* git(cwd, [
          "remote",
          change === "add" ? "add" : "set-url",
          "origin",
          "git@github.com:T3Tools/t3code.git",
        ]);
        expect(yield* resolver.resolve(cwd)).toEqual(initialIdentity);
        const identity = yield* resolver.resolve(cwd, { refresh: true });

        expect(identity).not.toBeNull();
        expect(identity?.locator.remoteName).toBe("origin");
        expect(identity?.canonicalKey).toBe("github.com/t3tools/t3code");
        expect(identity?.displayName).toBe("T3Tools/t3code");
        expect(yield* resolver.resolve(cwd)).toEqual(identity);
      }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("keeps a fork's own remote as the identity when an upstream remote exists too", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-repository-identity-fork-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@github.com:julius/t3code-fork.git"]);
      yield* git(cwd, ["remote", "add", "upstream", "git@github.com:T3Tools/t3code.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);

      expect(identity?.canonicalKey).toBe("github.com/julius/t3code-fork");
      expect(identity?.displayName).toBe("julius/t3code-fork");
      expect(identity?.origin).toBeUndefined();
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );

  it.effect("uses the last remote path segment as the repository name for nested groups", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-repository-identity-nested-group-test-",
      });

      yield* git(cwd, ["init"]);
      yield* git(cwd, ["remote", "add", "origin", "git@gitlab.com:T3Tools/platform/t3code.git"]);

      const resolver = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
      const identity = yield* resolver.resolve(cwd);

      expect(identity).not.toBeNull();
      expect(identity?.canonicalKey).toBe("gitlab.com/t3tools/platform/t3code");
      expect(identity?.displayName).toBe("T3Tools/platform/t3code");
      expect(identity?.owner).toBe("T3Tools");
      expect(identity?.name).toBe("t3code");
    }).pipe(Effect.provide(RepositoryIdentityResolver.layer)),
  );
});

const rememberedIdentity = (workspaceRoot: string): RepositoryIdentity => ({
  canonicalKey: "example.test/owner/repo",
  locator: {
    source: "git-remote",
    remoteName: "origin",
    remoteUrl: "git@example.test:owner/repo.git",
  },
  rootPath: workspaceRoot,
  displayName: "owner/repo",
});

it.effect("withMemory keeps the last identity for a root whose folder is gone", () => {
  const workspaceRoot = "/repo/feature";
  const gitAnswers = Ref.makeUnsafe<RepositoryIdentity | null>(rememberedIdentity(workspaceRoot));
  const folderExists = Ref.makeUnsafe(true);
  const inner: RepositoryIdentityResolver.RepositoryIdentityResolver["Service"] = {
    resolve: () => Ref.get(gitAnswers),
  };
  return Effect.gen(function* () {
    const resolver = yield* RepositoryIdentityResolver.withMemory(inner);
    expect(yield* resolver.resolve(workspaceRoot)).toEqual(rememberedIdentity(workspaceRoot));

    // The worktree is removed: git finds nothing in the missing folder, memory answers.
    yield* Ref.set(gitAnswers, null);
    yield* Ref.set(folderExists, false);
    expect(yield* resolver.resolve(workspaceRoot)).toEqual(rememberedIdentity(workspaceRoot));

    // The folder is back without a repository: that null is real.
    yield* Ref.set(folderExists, true);
    expect(yield* resolver.resolve(workspaceRoot)).toBeNull();

    // A root deleted before it was ever remembered inherits from a remembered ancestor,
    // and one outside any remembered root has nothing to fall back on.
    yield* Ref.set(folderExists, false);
    expect(yield* resolver.resolve("/repo/feature/packages/web")).toEqual(
      rememberedIdentity(workspaceRoot),
    );
    expect(yield* resolver.resolve("/elsewhere/never-seen")).toBeNull();
  }).pipe(
    Effect.provide(
      Layer.merge(
        RepositoryIdentityMemory.layerInMemory,
        FileSystem.layerNoop({ exists: () => Ref.get(folderExists) }),
      ),
    ),
  );
});

it.effect("the key-value memory survives a new store handle and skips unchanged writes", () =>
  Effect.gen(function* () {
    const backing = yield* KeyValueStore.KeyValueStore;
    const memory = yield* RepositoryIdentityMemory.makeFromKeyValueStore;
    const workspaceRoot = "/home/user/git/repo/feature";

    expect(Option.isNone(yield* memory.recall(workspaceRoot))).toBe(true);
    yield* memory.remember(workspaceRoot, rememberedIdentity(workspaceRoot));
    expect(Option.getOrNull(yield* memory.recall(workspaceRoot))).toEqual(
      rememberedIdentity(workspaceRoot),
    );

    // Same identity again leaves the stored value untouched; a changed one replaces it.
    const writes: Array<string> = [];
    const counting = yield* RepositoryIdentityMemory.makeFromKeyValueStore.pipe(
      Effect.provideService(KeyValueStore.KeyValueStore, {
        ...backing,
        set: (key, value) => {
          writes.push(key);
          return backing.set(key, value);
        },
      }),
    );
    yield* counting.remember(workspaceRoot, rememberedIdentity(workspaceRoot));
    expect(writes).toHaveLength(0);
    yield* counting.remember(workspaceRoot, {
      ...rememberedIdentity(workspaceRoot),
      canonicalKey: "example.test/owner/renamed",
    });
    expect(writes).toHaveLength(1);
    expect(Option.getOrNull(yield* memory.recall(workspaceRoot))?.canonicalKey).toBe(
      "example.test/owner/renamed",
    );
  }).pipe(Effect.provide(Layer.merge(KeyValueStore.layerMemory, NodeServices.layer))),
);
