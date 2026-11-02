# A two-Role security group gates the work, test-first

Security gets its own group of two Roles, both on trailofbits/skills: the **Threat Modeler** (`sharp-edges`) writes Abuse cases during Discuss, and the **Security Reviewer** (`differential-review`) checks the diff after each high-risk task and at the end. The Builder turns every Abuse case into a failing test before writing the logic (mattpocock `/tdd`), so security is specified and tested first, then coded, then checked. Both security Roles only advise; the Builder stays the only Role that edits source and tests.

The group is a hard gate, unlike the Reviewer: a Team run can't wrap up while any 🔴 security finding is open or any Abuse case lacks a passing test. Only the user can waive one, and the summary says so.

We rejected Anthropic's built-in `/security-review` as the Upstream: it's already in every Arm, and it explicitly skips input validation and rate limiting, which are what the benchmark seeds. We rejected one Role covering both phases because the user wanted a separate group that checks the dev team, not a teammate grading its own threat list. See `docs/research/security-role-upstreams.md`.

Consequences: trailofbits/skills joins `install.sh`'s Upstreams, so the Same-rules baseline gets it too (ADR 0002). The benchmark gains a security Trap before the pilot runs, so no Trial is wasted.
