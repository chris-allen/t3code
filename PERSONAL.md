# Personal build of T3 Code

This branch (`personal/stable`) is a short stack of commits, one per tweak, on
top of an upstream base. The base is usually the latest stable release tag,
currently `v0.1.7`. It lives in the linked worktree
`~/git/t3code/personal`; the `main` worktree at `~/git/t3code/main` stays on `main` for
upstream PRs. This file only exists on this branch.

## Commits on this branch

Run `git log --oneline origin/main..personal/stable` for the live list. Each commit is
one of:

- **Upstreamable fix.** Also opened as a PR from a `fix/*` branch off `main`.
  Drop it from this branch once the PR ships in a stable release.
- **Personal taste.** Stays here for good.
- **Build workflow.** Makes the AppImage build work on this machine.

## Rebase onto a new base

Rebuild in a fresh worktree and leave `personal/stable` alone until it builds:

```sh
cd ~/git/t3code/personal
git fetch origin --tags
OLD_BASE=$(git merge-base personal/stable origin/main)
git worktree add -b personal-next ../personal-next personal/stable
cd ../personal-next
git rebase --onto origin/main $OLD_BASE personal-next   # or a tag such as v0.1.7
```

Resolve conflicts commit by commit. If a commit is now empty because upstream
merged it, `git rebase --skip` drops it. Then reinstall and verify:

```sh
CI=true pnpm install --frozen-lockfile
export PATH="$PWD/node_modules/.bin:$PATH"
vp test run apps/server/src/project/RepositoryIdentityResolver.test.ts
vp test run apps/web/src/onboarding/projectImport.logic.test.ts \
  apps/web/src/rightPanelStore.test.ts \
  apps/web/src/sidebarProjectGrouping.test.ts \
  apps/web/src/components/CommandPalette.logic.test.ts
```

Run the tests from the package that owns them (`apps/server`, `apps/web`), and
typecheck those packages with `vp run typecheck`. If a typecheck fails with a
missing `typescript/bin/tsc`, the install left stale per-package shims from an
older pnpm. Delete every `node_modules` folder except the tracked fixtures under
`.repos/`, then reinstall:

```sh
find . -name node_modules -type d -prune -not -path './.repos/*' -exec rm -rf {} +
CI=true pnpm install --frozen-lockfile
```

Push the rebased branch to the fork with `git push --force-with-lease fork personal/stable`.

## Build the AppImage

```sh
cd ~/git/t3code/personal
export PATH="$PWD/node_modules/.bin:$PATH"
vp run dist:desktop:linux
```

The artifact lands in `release/` (gitignored). It writes the same `~/.t3`
data as the installed app, so switching between them is safe as long as both
sides are the same stable version.

The installed app may offer an update to the stable version this branch is
based on. Decline it; that build has none of these commits.

## Server build for capella

Capella runs the headless server as a systemd user service from a pinned
runtime at `~/.t3/runtime/versions/<version>/`. That runtime is the CLI
archive (`scripts/build-cli-archive.ts`), not the AppImage. Build it here and
copy it over. The single-executable step needs Node 25.7 or newer as the host,
so it runs with a standalone Node 26 unpacked under `/tmp`; everything else
builds with the system Node 24. The resource monitor is reused from capella's
installed stable runtime instead of being compiled.

```sh
cd ~/git/t3code/personal
export PATH="$PWD/node_modules/.bin:$PATH"
VERSION=0.1.6       # apps/server/package.json
INSTALLED=0.1.6     # the runtime capella runs now: ls ~/.t3/runtime/versions
mkdir -p /tmp/node26 && curl -fsSL https://nodejs.org/dist/v26.12.1/node-v26.12.1-linux-x64.tar.xz \
  | tar -xJ --strip-components=1 -C /tmp/node26
scp -r capella:.t3/runtime/versions/$INSTALLED/resource-monitor /tmp/resource-monitor
vp run --filter t3 build
PATH="/tmp/node26/bin:$PATH" node apps/server/scripts/cli.ts build-exe
node scripts/build-cli-archive.ts --platform linux --arch x64 --version $VERSION \
  --output-dir release --resource-monitor-dir /tmp/resource-monitor
scp release/t3-$VERSION-linux-x64.tar.gz capella:git/t3code/personal/release/
```

The version in the archive name is the version in `apps/server/package.json`,
which trails the release tag because release CI bumps it (`0.1.2` for tag
`v0.1.3`, `0.1.6` for tag `v0.1.7`). The executable reports the same number,
and the service installer expects the runtime at the directory named after it.
That directory may already hold the stock stable runtime or an earlier personal
build of the same number; replacing it is intended. Keep the previous archive
under another name first if you want a rollback.

On capella, unpack it there and let the CLI rewrite the unit. The install
stops, reloads, and restarts the service itself, which interrupts running
turns and remote clients, so nothing needs stopping first.

```sh
VERSION=0.1.6
cd ~/.t3/runtime/versions
rm -rf $VERSION && mkdir $VERSION
tar -xzf ~/git/t3code/personal/release/t3-$VERSION-linux-x64.tar.gz \
  --strip-components=1 -C $VERSION
printf '%s\n' $VERSION > $VERSION/.install-complete
$VERSION/t3 service install --allow-downgrade
ln -sfn ~/.t3/runtime/versions/$VERSION/t3 ~/.local/bin/t3
```

`--allow-downgrade` lets the install proceed whenever the number does not sort
above the currently installed one. When the installer reports the version is
already installed, finish with `systemctl --user restart t3code.service`. Do
not run `t3 update` on capella; it would replace this build with the stock
stable one.

Capella can also build the archive itself: its Node 26 covers every step, and
`~/git/t3code/personal/release/build.sh` there runs the whole sequence with
`npx pnpm@11.10.0`; update that to the `packageManager` version in
`package.json` (`pnpm@12.14.0` since v0.1.3) before running it. The web bundle's Babel code-splitting step failed once
there and passed on retry, so rerun it if it dies with a `trailingComments`
error.

## Prerequisites on this machine

- Rust via rustup, kept current with `rustup update stable` (the resource
  monitor crate tracks a recent compiler).
- `libsecret`, `pkg-config`, ImageMagick, and a C toolchain, all from pacman.
