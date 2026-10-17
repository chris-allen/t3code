# Personal build of T3 Code

This branch (`personal/stable`) is the latest stable release tag plus a short
stack of commits, one per tweak. It lives in the linked worktree
`~/git/t3code/personal`; the `main` worktree at `~/git/t3code/main` stays on `main` for
upstream PRs. This file only exists on this branch.

## Commits on this branch

Run `git log --oneline v0.1.0..personal/stable` for the live list. Each commit is
one of:

- **Upstreamable fix.** Also opened as a PR from a `fix/*` branch off `main`.
  Drop it from this branch once the PR ships in a stable release.
- **Personal taste.** Stays here for good.
- **Build workflow.** Makes the AppImage build work on this machine.

## Rebase onto a new stable release

```sh
cd ~/git/t3code/personal
git fetch origin --tags
git rebase --onto v0.1.1 v0.1.0 personal/stable
```

Resolve conflicts commit by commit. If a commit is now empty because upstream
merged it, `git rebase --skip` drops it. Then reinstall and verify:

```sh
pnpm install --frozen-lockfile
export PATH="$PWD/node_modules/.bin:$PATH"
vp test run apps/server/src/project/AgentSessionScanner.test.ts \
  apps/server/src/project/RepositoryIdentityResolver.test.ts \
  apps/web/src/onboarding/projectImport.logic.test.ts
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
mkdir -p /tmp/node26 && curl -fsSL https://nodejs.org/dist/v26.8.2/node-v26.8.2-linux-x64.tar.xz \
  | tar -xJ --strip-components=1 -C /tmp/node26
scp -r capella:.t3/runtime/versions/0.0.45/resource-monitor /tmp/resource-monitor
vp run --filter t3 build
PATH="/tmp/node26/bin:$PATH" node apps/server/scripts/cli.ts build-exe
node scripts/build-cli-archive.ts --platform linux --arch x64 --version 0.0.45 \
  --output-dir release --resource-monitor-dir /tmp/resource-monitor
scp release/t3-0.0.45-linux-x64.tar.gz capella:git/t3code/personal/release/
```

The version in the archive name is the version in `apps/server/package.json`,
which trails the release tag because release CI bumps it (`0.0.45` for tag
`v0.1.0`). The executable reports the same number, and the service installer
expects the runtime at the directory named after it. That directory may already
hold the stock stable runtime of the same number; replacing it is intended.

On capella, unpack it there and let the CLI rewrite the unit. The install
stops, reloads, and restarts the service itself, which interrupts running
turns and remote clients, so nothing needs stopping first.

```sh
cd ~/.t3/runtime/versions
rm -rf 0.0.45 && mkdir 0.0.45
tar -xzf ~/git/t3code/personal/release/t3-0.0.45-linux-x64.tar.gz \
  --strip-components=1 -C 0.0.45
printf '0.0.45\n' > 0.0.45/.install-complete
0.0.45/t3 service install --allow-downgrade
ln -sfn ~/.t3/runtime/versions/0.0.45/t3 ~/.local/bin/t3
```

`--allow-downgrade` lets the install proceed whenever the number does not sort
above the currently installed one. When the installer reports the version is
already installed, finish with `systemctl --user restart t3code.service`. Do
not run `t3 update` on capella; it would replace this build with the stock
stable one.

Capella can also build the archive itself: its Node 26 covers every step, and
`~/git/t3code/personal/release/build.sh` there runs the whole sequence with
`npx pnpm@11.10.0`. The web bundle's Babel code-splitting step failed once
there and passed on retry, so rerun it if it dies with a `trailingComments`
error.

## Prerequisites on this machine

- Rust via rustup, kept current with `rustup update stable` (the resource
  monitor crate tracks a recent compiler).
- `libsecret`, `pkg-config`, ImageMagick, and a C toolchain, all from pacman.
