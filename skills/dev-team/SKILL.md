---
name: dev-team
description: Launch the Rolecall team (Skeptic, Planner, Builder, Gatekeeper, Reviewer, the Threat Modeler and Security Reviewer, plus Design Lead, Art Director and Design Critic) as an agent team that discusses and builds a task together. Use when the user says "/dev-team", "start the dev team", "run the team on this", or asks the team agents to work on a project.
---

# Rolecall team

You are the team lead. The user's task is in the arguments; if none, ask for it in one line.

## Spawn

Spawn ten **teammates** (agent team, not plain subagents), using these names and agent types (teammate names can't contain spaces, so keep the hyphens):

| Name | Agent type | Job |
|---|---|---|
| Skeptic | team-skeptic | assumptions, success criteria, scope guard |
| Planner | team-planner | design + task plan in docs/plans/ |
| Builder | team-builder | test-first implementation, only one who edits code |
| Gatekeeper | team-gatekeeper | build/lint/test, docs, changelog |
| Reviewer | team-reviewer | terse diff review + final summary |
| Threat-Modeler | team-threat-modeler | Abuse cases before any code (advises only) |
| Security-Reviewer | team-security-reviewer | security diff review, the security gate (advises only) |
| Design-Lead | team-design-lead | palette, type, spacing, UX rules (advises only) |
| Art-Director | team-art-director | visual direction, anti-generic (advises only) |
| Design-Critic | team-design-critic | audits screenshots, sends polish fixes (advises only) |

For work with no UI at all, skip the three design Roles.

Spawn every teammate while the session's working directory is the project root. Give each the user's task, the project path, the starting commit (`git rev-parse HEAD`, if it's a git repo), and the table above so they know who plays which Role.

## Flow

Put these on the shared task list with dependencies:

1. **Discuss** (in parallel): Skeptic sends the brief; Gatekeeper finds the build/test commands; Planner reads the code; Threat-Modeler sends the Abuse cases; Art-Director and Design-Lead agree a visual direction and design spec and send it to Planner. Have them message each other to challenge the brief.
2. **Ask:** bring any open questions from Skeptic to the user. Wait for answers.
3. **Plan:** Planner writes the plan; Skeptic challenges it once; Threat-Modeler checks every Abuse case is a test planned before its logic. Show the user the plan summary and get a go-ahead.
4. **Build:** Builder implements task by task. Gatekeeper checks each task; Security-Reviewer checks each task that touches a trust boundary; Design-Critic audits screenshots of each visual task; Skeptic guards scope.
5. **Review:** Reviewer and Security-Reviewer review the diff; Builder fixes; Gatekeeper runs the final checks and updates docs/changelog.
6. **Wrap up:** only once Security-Reviewer reports `security: pass`, or the user waives each open item. Relay Reviewer's summary and Gatekeeper's draft commit message. Commit or push only if the user says so. Then shut the team down.

## Rules

- Wait for teammates; don't do their work yourself.
- Only Builder edits source and tests, only Planner writes plans, and only Gatekeeper edits docs and the changelog. The design and security Roles advise only. This prevents overwrites.
- The Security group is a hard gate: don't wrap up while a 🔴 security finding is open or an Abuse case lacks a passing test, unless the user waives it. List any waiver in the summary.
- For a tiny task (one-line fix, a question), tell the user a team is overkill and do it directly unless they insist.
