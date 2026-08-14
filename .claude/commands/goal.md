---
description: Show the standing ThreeMaker objective, measured gate status, and the next unit to pick up
---

Report where ThreeMaker actually stands and what to do next. This is a **status
and orientation** command — it changes nothing on its own.

CONTEXT:

- Repo: detect with `git rev-parse --show-toplevel`.
- Standing objective and backlog: `planes/GOAL.md`.
- How a pass runs: `planes/LOOP.md`.
- Optional focus: `$ARGUMENTS` — a type (`feature`, `optimization`, `ux`,
  `architecture`, `robustness`, `test`) or a free-form area to report on.

TASK:

1. Read `planes/GOAL.md`. It is the single live goal file — if you find another
   file claiming to be an active goal, say so, because one of them is stale.
2. **Measure, do not quote.** Run the gates and report what they actually say
   right now, not what the doc claims:
   ```sh
   pnpm test && pnpm typecheck && pnpm lint
   ```
   Add `pnpm smoke:painter` only if asked or if the viewport is in scope — it
   needs a browser and a saved map, and port 1421 must be free.
3. Report delivery state: current branch, unpushed commits, whether `master` and
   `main` agree, and the last CI conclusion (`gh run list --limit 3`).
4. Read the last entry of "Última pasada" in `planes/LOOP.md` and say which type
   the rotation lands on next.
5. Recommend ONE next unit — the highest-value item from `planes/GOAL.md`'s gaps,
   or the next loop pass. Give the reason in a sentence.
6. List anything that is blocked on Mike specifically (visual PASS, secrets,
   product decisions), so it does not sit invisible.

Keep it short. This is a briefing, not an essay: gate numbers, delivery state,
one recommendation, blocked items. If a claim in `planes/GOAL.md` no longer
matches the code, correct the file rather than repeating it.
