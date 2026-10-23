# Plan: an agent-runnable, forkable release workflow

**Status:** future plan, not started (2026-10-23). For now the release
workflow is being built and proven in the maintainer's own environment;
this doc records where it should end up. Tracked as task 113 in the
maintainer's sandbox plan.

## Goal

Anyone can fork this repo and run the same release workflow with their own
coding agent (Claude Code, Codex, Cursor, ...) and their own configuration:
follow Chrome's release schedule, bump V8, get the CI build green, publish
the release, and hand off to lo's release.

## The workflow being automated

Chrome ships a milestone every 2 weeks; V8 `x.y` is Chrome milestone
`xy` (M156 = 15.6).

1. **Schedule:** `https://chromiumdash.appspot.com/fetch_milestone_schedule`
   gives the planned dates (`branch_point`, `stable_cut`, `stable_date`);
   `https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Linux`
   gives what actually shipped, with the exact V8 commit (`hashes.v8`).
2. **At stable cut:** check our patches still apply (`tools/check-patches.js`),
   bump the version (`tools/bump.js`), watch the push build, fix failures within a
   cap of fix pushes, and escalate to a human past it.
3. **When the milestone is on Stable:** confirm, publish (`tools/release.js --release`),
   watch the release build, then release lo for the new V8.
4. Builds use an exact V8 commit (the Stable Cut or Stable Release hash), not
   `branch-heads/x.y`.

## Layout

- `AGENTS.md` (repo root): the workflow in prose: the loop above, what each
  script guarantees, the fix/retry rules, when to stop and ask. The
  agent-neutral entry point.
- `CLAUDE.md`: one line, `@AGENTS.md`, so Claude Code reads the same file.
- `.claude/skills/<name>/SKILL.md`: thin Claude Code wrappers over the scripts
  (release, bump loop, patch check). Other agents ignore them.
- Scripts, all agent-independent:
  - `tools/release.js`: tag + push + publish the release (exists).
  - `tools/bump.js`: bump `V8_VERSION` and the README links, commit, push (exists).
  - `tools/check-patches.js`: do our patches apply to a version or commit (exists).
  - `tools/v8-schedule.js`: per milestone, planned dates, Stable shipped +
    V8 hash, and our bump/CI/tag/release state (to write).
  - `tools/watch-run.js <run-id>`: poll a workflow run until it finishes and
    print its jobs' results, so any agent can wait on CI (to write).
- `release.config.json`: what differs per fork (below).

## Script rules (decided 2026-10-23)

All workflow scripts are **Node**, so a fork needs nothing beyond Node, which
every GitHub runner and nearly every V8 developer already has:

- zero dependencies: no `package.json`, no `npm install`; ESM, `node:`
  built-ins and the global `fetch` only; Node 20 or newer
- git through `execFileSync('git', [...])`, never a shell, so nothing needs `sh`
- Windows-safe paths: `fileURLToPath(import.meta.url)`, not
  `new URL(...).pathname` (`/C:/...` on Windows)
- `--json` output where an agent or another script reads the result
- a small API surface (`fetch`, `execFileSync`, `fs` reads/writes,
  `process.argv/env/exit`, timers), so a compat layer could later run the
  same scripts on Bun, Deno or lo

The first `sh` versions (`release.sh`, `bump.sh`) were ported to `tools/release.js` and
`tools/bump.js`.

## Making it forkable

- **No environment specifics** in the repo's copies: no absolute paths, shell
  quirks, or notes about the maintainer's own machine or note-keeping.
- **Owner/repo from the `origin` remote**, not hard-coded `just-js`, so a
  fork publishes its own releases.
- **`release.config.json`** for per-fork choices, e.g.:
  - the env var that holds the GitHub token (needs Actions + Contents
    read/write on the repo);
  - the fix cap (how many fix pushes before escalating);
  - confirm before publishing, or publish automatically;
  - build from the Stable Cut or the Stable Release hash;
  - the lo repo to hand off to, and the release assets it needs.
- **Permissions documented:** which token scopes each step needs, and the
  cheap pre-checks (a `git push --dry-run`; a draft release created and
  deleted, since an invalid release POST returns 422 before checking
  permission).

## lo

lo's half belongs in `just-js/lo`: its `tools/release.js` (bump `VERSION`/`V8` in
`Makefile` and `build.cmd`, tag, push, publish the prerelease) and its own
`AGENTS.md` section. This repo's workflow hands off to it once a V8 release's
assets are up.

## Before doing this

The pieces are first being built and run in the maintainer's environment:
the watcher, the schedule script, the pinned-hash `build.yml` change, the
bump-and-fix loop, then real releases (15.6 onward). Move the stable parts
here once the loop has run cleanly for a cycle or two, so they aren't
rewritten in two places.
