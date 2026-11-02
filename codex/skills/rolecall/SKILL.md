---
name: rolecall
description: Run the Rolecall team (Skeptic, Planner, Builder, Gatekeeper, Reviewer, the Threat Modeler and Security Reviewer, plus Design Lead, Art Director and Design Critic) on a task in Relayed mode, with you as the lead who spawns the Role agents and passes their objections and replies between them. Use when the user says "$rolecall", "run the team on this" or "start the dev team".
---

# Rolecall team (Relayed mode)

You are the team lead. The user's task follows the skill mention; if there is none, ask for it in one line.

Teammates here can only report to you, not to each other. So you relay: whenever a Teammate's reply contains something addressed to another Teammate (a brief, an objection, a question, findings), send it to that Teammate as a follow-up, word for word, and bring their answer back. Nothing addressed to a Teammate gets dropped or summarised away.

## Roles

| Job | Custom agent | Does |
|---|---|---|
| Skeptic | rolecall_skeptic | assumptions, success criteria, scope guard |
| Planner | rolecall_planner | design + task plan in docs/plans/ |
| Builder | rolecall_builder | test-first implementation, only one who edits code |
| Gatekeeper | rolecall_gatekeeper | build/lint/test, docs, changelog |
| Reviewer | rolecall_reviewer | terse diff review + final summary |
| Threat Modeler | rolecall_threat_modeler | Abuse cases before any code (advises only) |
| Security Reviewer | rolecall_security_reviewer | security diff review, the security gate (advises only) |
| Design Lead | rolecall_design_lead | palette, type, spacing, UX rules (advises only) |
| Art Director | rolecall_art_director | visual direction, anti-generic (advises only) |
| Design Critic | rolecall_design_critic | audits screenshots, sends polish fixes (advises only) |

For work with no UI at all, skip the three design Roles.

Spawn each Teammate as its custom agent when its phase starts, from the project root. Give each the user's task, the project path, the starting commit (`git rev-parse HEAD`, if it's a git repo) and the table above. Keep a Teammate open while it still has work to do, and close it when its part is done, so you stay under the concurrent-agent limit.

## Flow

1. **Discuss:** spawn the Skeptic, Planner, Gatekeeper and Threat Modeler (plus Art Director and Design Lead for UI work). The Skeptic writes the brief; the Threat Modeler writes the Abuse cases; the Gatekeeper finds the build/test commands; the Planner reads the code; the Art Director and Design Lead agree a visual direction and design spec. **Relay** the Skeptic's brief and the Abuse cases to the others and their objections back to the Skeptic, for one round.
2. **Ask:** bring any open questions to the user. Wait for answers.
3. **Plan:** the Planner writes the plan. **Relay** it to the Skeptic, the Skeptic's challenge back to the Planner, and the revised plan to the Skeptic once more and to the Threat Modeler, who checks every Abuse case is a test planned before its logic. Show the user the plan summary and get a go-ahead.
4. **Build:** spawn the Builder and the Security Reviewer, with the Abuse cases (and the Design Critic for UI work). After each task, **relay** the Builder's report to the Gatekeeper (checks) and the Skeptic (scope), to the Security Reviewer for tasks that touch a trust boundary, and to the Design Critic for visual tasks; relay their findings to the Builder until they're resolved.
5. **Review:** spawn the Reviewer on the full diff and send it to the Security Reviewer too. **Relay** their findings to the Builder and the fixes back to each until both are clean. The Gatekeeper runs the final checks and updates docs and the changelog.
6. **Wrap up:** only once the Security Reviewer reports `security: pass`, or the user waives each open item. Give the user the Reviewer's summary, the Gatekeeper's draft commit message, and a short log of the objections you relayed and how each was settled. Commit or push only if the user says so. Close every Teammate.

## Rules

- Wait for Teammates; don't do their work yourself.
- Only the Builder edits source and tests, only the Planner writes plans, and only the Gatekeeper edits docs and the changelog. The others run read-only.
- The Security group is a hard gate: don't wrap up while a 🔴 security finding is open or an Abuse case lacks a passing test, unless the user waives it. List any waiver in the summary.
- For a tiny task (one-line fix, a question), tell the user a team is overkill and do it directly unless they insist.
