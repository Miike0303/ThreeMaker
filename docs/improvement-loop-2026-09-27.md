# Improvement loop — summary (2026-09-25 to 2026-09-27)

An automated `/goal` loop audited ThreeMaker, then ran 47 research → write → verify cycles on the code the owner
had not modified. Claude orchestrated and verified; Codex (and, early on, Cursor Grok) wrote.

## Outcome

| | Before (`da29112`) | After (`master`) |
|---|---|---|
| Commits on `master` | — | **+166** (112 test, 26 fix, 12 feat, 8 refactor, 5 perf, 1 style, 1 chore) |
| Branch-only test suite | 2777 tests | **3493 tests** |
| Lint on the branch | 0 errors / 36 warnings | 0 errors / 30 warnings |
| CI (`master` and `main`) | green | green on every push |

Every commit was verified before landing: typecheck, the full suite on the owner's working tree, a branch-only
suite in a clean worktree (so no commit depends on uncommitted work), and a negative test that breaks the guarded
code and confirms the new test turns red.

## User-facing changes

**RPG Maker import** (`packages/importer-rpgm`)
- Imports Show Text, scrolling text, Transfer Player, comments, Control Switches/Variables, switch-gated pages,
  self switches A–D, item-gated pages, and Change Items/Weapons/Armors (126–128) instead of dropping those events.
- Maps keep their editor name from `MapInfos.json` and are listed in RPG Maker's sidebar (tree) order.
- The imported player sprite is the starting party leader, not the first actor.
- Rejects malformed map grids, duplicate map ids, non-integer tileset flags and duplicate tileset ids.

**Editor (Maker Studio)**
- Generate keeps hand-drawn stairs (drops only the ones a new wall or void would break) and refuses to re-class a
  tile that another floor still uses.
- Even corridor widths carve real two-tile corridors.
- Map names reject Windows reserved names with extensions; templates insert values literally.
- Accessibility: palette `aria-pressed`, palette grids named by their sheet, polish CSS layer (hierarchy, contrast).

**Runtime (desktop)**
- Dialogue: screen readers announce lines and choices, choices carry `aria-current`, errors are alerts and no longer
  promise "press to continue", blank speakers get a label, the box clears between conversations.

**Narrative (Ink)**
- New externals `item_add`, `stat_modify`, `world_get(key, fallback)`; read-only externals work inside choice text.
- Choice-only knots no longer show a blank page; the graph keeps author comments and ignores commented diverts.

**Assets / CLI**
- Atomic writes for CLI outputs; a data-folder path resolves the cataloged game's tile sheets.

## Tests

716 new tests in the branch suite (2777 → 3493), most pinning "mutation survivors": rules where a one-token change (flipped comparison, dropped
guard, swapped operand) left every existing test green. Each was re-verified by re-applying the mutation.

## Rejected, blocked, pending

- Rejected with reasons (speculative hardening, cosmetic duplication, cross-app coupling): see the loop ledger.
- **Blocked on the owner's uncommitted files** (188 modified / 551 untracked): save/load and `main.ts`,
  `PainterPanel.tsx`, the catalog UI, locale bundles, MCP tools, Rust `src-tauri` logic, keyboard unbound-action
  persistence, the photo-mode Spanish label. Committing that work would open the highest-value areas to the loop.
- Pending a visual decision: the editor polish CSS layer (`a1f068a`) and an Ink graph "preamble" node.

## How the loop runs

Config and rules live in `.claude/improvement.md`. The loop now uses Codex only (`gpt-6-sol` / `gpt-6-astra`,
`high`/`xhigh`), at most six parallel lanes, and pushes `master` and `main` only after the branch-only gate is green.
