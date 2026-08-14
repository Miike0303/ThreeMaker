---
description: One improvement pass — Claude, Cursor and Grok investigate blind, compare, then writers implement in one tree on disjoint file lanes
---

Run **one pass** of the ThreeMaker improvement loop. You orchestrate, compare and
validate. You do **not** write production code.

CONTEXT:

- Repo: detect with `git rev-parse --show-toplevel`.
- Procedure: read `planes/LOOP.md` and follow it. It is the authority — this file
  only dispatches.
- Backlog and standing objective: `planes/GOAL.md`.
- Type for this pass: `$ARGUMENTS` (one of `feature`, `optimization`, `ux`,
  `architecture`, `robustness`, `test`). If empty, take the next type in the
  rotation from `planes/LOOP.md`'s "Última pasada" and say which one you picked.

TASK:

0. **Preconditions.** Stop and report, changing nothing, if the tree is dirty, if
   the gates are already red on `HEAD`, or if `planes/GOAL.md` has text under
   `## STOP`.
1. Read `planes/LOOP.md` and `planes/GOAL.md` first. Do not proceed from memory.
   Honour the `## Rechazados` table — never re-propose something listed there.
2. **Phase 0** — write ONE concrete research question for the chosen type. Create
   `planes/_research/<YYYY-MM-DD>-<type>/`.
3. **Phase 1** — write ONE brief and send the SAME brief to all three
   investigators, blind. None may see another's output.
   - Claude: read the code yourself → `claude.md`
   - Cursor: `cursor-ask.ps1 -Mode plan -PromptFile <brief>` → `cursor.md`
   - Grok: `grok-write.ps1 -PromptFile <brief>` (read-only instruction) → `grok.md`
   Run Cursor and Grok in the background, in parallel, while you do your own.
4. **Phase 2** — apply the five filters. **Open a sample of the cited file:line
   yourself** — agents fabricate citations. Write `verdict.md`: what won, why,
   what was grafted in from the losers, what was killed and why.
5. **Phase 3** — write one brief PER LANE (`brief-<lane>.md`). A brief assigns an
   explicit list of files and says what to do in each, by function or symbol —
   never "fix the painter". One file belongs to exactly one lane. Shared files
   (`package.json`, barrel `index.ts`, `locales/*.json`, configs, workflows)
   belong to NO lane — you apply those yourself afterwards. Every brief carries
   a falsifiable exit criterion and a check that fails today.
6. **Phase 4** — dispatch the writers into the SAME tree and the SAME branch. No
   worktrees, no per-writer branches. Cross-check the lane file lists for overlap
   BEFORE dispatching; if they intersect, redo the lanes. Run Cursor and Grok in
   parallel in the background only when the lanes are truly disjoint — otherwise
   one writer, alternating between passes. Do not ask writers to run the full
   test suite while another writer is editing; you run the gates at the end on
   the combined tree.
7. **Phase 5** — validate yourself: run every gate, **negative-test the check**,
   review the diff against the brief.
8. **Phase 6** — work-unit commit, push to `master` AND `main`, confirm CI green
   with `gh run list`.
9. Update "Última pasada" in `planes/LOOP.md` and `mem_save` the outcome.

STOP AND ASK when: a product decision is needed, secrets/certs are involved, or
the result needs a visual judgement. Never declare a visual PASS yourself.

If a pass produces nothing worth building — every candidate failed the Evidence or
Real filter — say so plainly, record it in `verdict.md`, and move to the next type.
A pass that honestly finds nothing is a result, not a failure.
