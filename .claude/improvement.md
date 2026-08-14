---
ledger: planes/GOAL.md
categories: [feature, optimization, ux, architecture, robustness, test]
delivery: push
branch: master
push_refs: ["master", "master:main"]
---

## Gates

Run them yourself; never trust a writer's report.

```sh
pnpm test
pnpm typecheck
pnpm lint
```

`pnpm smoke:painter` is a fourth gate, but only when the change touches the
editor viewport. It needs a browser and a saved map, which is why it is out of
`pnpm test` and out of CI. Free port 1421 first — vite uses `strictPort`, so a
leftover dev server fails the run with "port already in use" instead of a result.

`pnpm lint` reports 29 pre-existing warnings. Warnings do not fail the gate;
errors do. If the warning count moves, say so.

## Shared files

Owned by no lane; Claude applies these after the writers finish.

- `package.json`, `pnpm-lock.yaml`
- `packages/*/src/index.ts` (barrel exports)
- `apps/editor/src/locales/en.json`, `apps/editor/src/locales/es.json`
- `biome.json`, `tsconfig.json`, `tsconfig.base.json`, `vitest.config.ts`
- `.github/workflows/*`

## Writer traps

- Tests needing `fixtures/roseliam` or `fixtures/mz-project1` cannot run in CI —
  those are copyrighted RPG Maker projects and `fixtures/` is gitignored whole.
  Guard new fixture-backed suites with `skipWithoutFixture`.
- Never mix `from 'three'` and `from 'three/webgpu'` in one file: two module
  instances of the core classes break `instanceof` and material identity far
  from the cause.
- The editor dev server is port **1421**, not 5173.
- Never declare a visual PASS. HD-2D fidelity is Mike's call, by screenshot.

## Ledger mapping

This repo splits the ledger across two files instead of one:

- `planes/GOAL.md` — Goal, gaps by priority, seeds per category, **Rechazados**
  (Rejected, with reasons) and **Fallas** (Failures). A `## STOP` heading is
  absent by design: its mere presence halts the loop, so an empty placeholder
  would freeze everything.
- `planes/LOOP.md` — the procedure and its "Última pasada" log.
- `planes/_research/<date>-<type>/` — per-cycle research, one file per
  investigator plus `verdict.md`.

Both live under `planes/`, which is gitignored in full. That is a deliberate
open question, not an oversight — the repo is public and `VISION.md` quotes user
transcripts verbatim.
