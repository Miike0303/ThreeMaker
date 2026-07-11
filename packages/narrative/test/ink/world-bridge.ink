EXTERNAL world_get(key)
EXTERNAL world_set(key, value)

VAR mood = "neutral"

~ world_set("greeting_seen", true)
The world says: {world_get("weather")}
~ mood = "happy"
Mood is now {mood}.
-> END
