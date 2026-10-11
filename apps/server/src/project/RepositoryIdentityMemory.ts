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
 * The identity each workspace root last resolved to, read back when its folder is gone so a removed
 * worktree keeps its repository group. Failures are logged and swallowed: losing memory must never
 * fail the resolution it decorates.
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
      remember: Effect.fn("RepositoryIdentityMemory.remember")(function* (
        workspaceRoot: string,
        identity: RepositoryIdentity,
      ) {
        yield* Ref.update(memory, (current) => new Map(current).set(workspaceRoot, identity));
      }),
      recall: Effect.fn("RepositoryIdentityMemory.recall")(function* (workspaceRoot: string) {
        const current = yield* Ref.get(memory);
        return Option.fromUndefinedOr(current.get(workspaceRoot));
      }),
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
    remember: Effect.fn("RepositoryIdentityMemory.remember")(
      function* (workspaceRoot: string, identity: RepositoryIdentity) {
        const key = yield* keyOf(workspaceRoot);
        const stored = yield* store.get(key);
        if (Option.isSome(stored) && stored.value.canonicalKey === identity.canonicalKey) return;
        yield* store.set(key, identity);
      },
      swallow<void>("remember", undefined),
    ),
    recall: Effect.fn("RepositoryIdentityMemory.recall")(
      function* (workspaceRoot: string) {
        const key = yield* keyOf(workspaceRoot);
        return yield* store.get(key);
      },
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
