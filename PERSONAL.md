# Personal build of T3 Code

This branch (`personal/stable`) is the latest stable release tag plus a short
stack of commits, one per tweak. It lives in the linked worktree
`~/git/t3code/personal`; the `main` worktree at `~/git/t3code/main` stays on `main` for
upstream PRs. This file only exists on this branch.

## Commits on this branch

Run `git log --oneline v0.0.45..personal/stable` for the live list. Each commit is
one of:

- **Upstreamable fix.** Also opened as a PR from a `fix/*` branch off `main`.
  Drop it from this branch once the PR ships in a stable release.
- **Personal taste.** Stays here for good.
- **Build workflow.** Makes the AppImage build work on this machine.

## Rebase onto a new stable release

```sh
cd ~/git/t3code/personal
git fetch origin --tags
git rebase --onto v0.0.46 v0.0.45 personal/stable
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

## Prerequisites on this machine

- Rust via rustup, kept current with `rustup update stable` (the resource
  monitor crate tracks a recent compiler).
- `libsecret`, `pkg-config`, ImageMagick, and a C toolchain, all from pacman.
