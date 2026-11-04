---
"neo2-flightpath": patch
---

Desktop app: all tile downloads — the gate pre-warm, the background warm, on-demand tiles and an export's pre-warm — now share one polite queue, so the combined request rate stays inside the 2 per second tile budget even when several lanes run at once.
