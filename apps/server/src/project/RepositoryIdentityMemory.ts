import { RepositoryIdentity } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as KeyValueStore from "effect/persistence/KeyValueStore";

import { ServerConfig } from "../config.ts";

/**
 * The repository identity each workspace root last resolved to. The resolver reads it back when
 * the folder is gone, so a project whose worktree was removed stays grouped with its repository
 * instead of degrading to a path group. Both operations swallow their own failures: memory is a
 * convenience, and losing it must never fail the resolution it decorates.
 */
export class RepositoryIdentityMemory extends Context.Service<
  RepositoryIdentityMemory,
  {
    readonly remember: (workspaceRoot: string, identity: RepositoryIdentity) => Effect.Effect<void>;
    readonly recall: (workspaceRoot: string) => Effect.Effect<Option.Option<RepositoryIdentity>>;
  }
>()("t3/project/RepositoryIdentityMemory") {}

export const layerInMemory = Layer.effect(
  RepositoryIdentityMemory,
  Effect.gen(function* () {
    const memory = yield* Ref.make(new Map<string, RepositoryIdentity>());
    return RepositoryIdentityMemory.of({
      remember: (workspaceRoot, identity) =>
        Ref.update(memory, (current) => new Map(current).set(workspaceRoot, identity)),
      recall: (workspaceRoot) =>
        Ref.get(memory).pipe(
          Effect.map((current) => Option.fromUndefinedOr(current.get(workspaceRoot))),
        ),
    });
  }),
);

/** One JSON file per workspace root in the provided KeyValueStore, keyed by the root's digest. */
export const makeFromKeyValueStore = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, RepositoryIdentity);
  const crypto = yield* Crypto.Crypto;
  const keyOf = (workspaceRoot: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(workspaceRoot)).pipe(Effect.map(Hex.encode));
  const swallow =
    <A>(operation: string, fallback: A) =>
    <E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Repository identity memory failed", { operation, cause }).pipe(
            Effect.as(fallback),
          ),
        ),
      );

  return RepositoryIdentityMemory.of({
    remember: (workspaceRoot, identity) =>
      keyOf(workspaceRoot).pipe(
        Effect.flatMap((key) =>
          store
            .get(key)
            .pipe(
              Effect.flatMap((stored) =>
                Option.isSome(stored) && stored.value.canonicalKey === identity.canonicalKey
                  ? Effect.void
                  : store.set(key, identity),
              ),
            ),
        ),
        swallow<void>("remember", undefined),
      ),
    recall: (workspaceRoot) =>
      keyOf(workspaceRoot).pipe(
        Effect.flatMap((key) => store.get(key)),
        swallow("recall", Option.none<RepositoryIdentity>()),
      ),
  });
});

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    return Layer.effect(RepositoryIdentityMemory, makeFromKeyValueStore).pipe(
      Layer.provide(
        KeyValueStore.layerFileSystem(path.join(config.stateDir, "repository-identity")).pipe(
          Layer.catch(() =>
            Layer.effectDiscard(
              Effect.logWarning("Repository identity memory directory unavailable; not persisting"),
            ).pipe(Layer.provideMerge(KeyValueStore.layerMemory)),
          ),
        ),
      ),
    );
  }),
);
