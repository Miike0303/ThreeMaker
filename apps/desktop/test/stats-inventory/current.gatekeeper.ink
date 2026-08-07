EXTERNAL item_count(itemId)

=== start ===
{ item_count("brass_key") > 0:
    You hold the brass key. Pass freely. # speaker: Gatekeeper
- else:
    Without a key, you shall not pass. # speaker: Gatekeeper
}
-> END
