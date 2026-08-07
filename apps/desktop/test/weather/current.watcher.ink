EXTERNAL world_get(key)

// Branches on session weather.current (string type-lock). The load gate
// requires weather.current in the map document's worldSeeds even though the
// narrative root already seeds 'clear' and seedIfAbsent will skip any map
// override at runtime — the gate scans the document text, not the live root.
=== start ===
{ world_get("weather.current") == "rain":
    The rain soaks the cobblestones. # speaker: Watcher
- else:
    The sky is clear for now. # speaker: Watcher
}
-> END
