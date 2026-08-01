EXTERNAL world_set(key, value)

// STICKY choices (`+`, not `*`) on purpose: the desktop runtime compiles this
// story ONCE per map session and re-enters `start` on every interaction
// (`InkDialogueProvider.open` -> `ChoosePathString`), so once-only choices would
// be consumed for good -- the second visit would silently offer fewer options
// and the visit after that would reach a weave with nothing left to run, which
// inkjs reports as a raw "ran out of content" error shown to the PLAYER. Sticky
// is also why no fallback (`* ->`) is needed: this knot can never run dry.
// `world_set` is idempotent, so re-taking the reveal is harmless.
=== start ===
Welcome, traveler. I know a secret the guard does not. # speaker: Elder
+ [Tell me the secret]
    ~ world_set("secret_revealed", true)
    The old shrine north of here hides a passage. # speaker: Elder
    -> DONE
+ [Not now]
    Very well, traveler. # speaker: Elder
    -> DONE
