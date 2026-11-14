# Agent images

One figure per agent from the Team office prototype (TechPulse session, 11 agents).

- `svg/<id>.svg`: vector, 56 x 72 viewBox, transparent background. Use these in code.
- `png/<id>.png`: 224 x 288 (4x), transparent background.
- `agents.json`: id, type, room, body colour and file paths for each agent.
- `contact-sheet.png`: all figures with names, for reference only.

The figure stands on the bottom centre of its box: place that point on the agent's floor position.
Only the body colour differs between agents; head, eyes and antenna are ink #1C2126 on white.
Skeptic-2 and Security-Reviewer-2 share #C2417A, and Builder-2 and Reviewer share #0E8A9E, as in the prototype.
To recolour in code, change the `fill` on the last `<path>`.
