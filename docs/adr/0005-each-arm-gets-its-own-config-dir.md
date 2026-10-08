# Each Arm gets its own config dir, set up the way a user would

Benchmark Trials run on the claude.ai subscription, and `claude --bare` (the only built-in clean mode) accepts only an API key. The maintainer's machine also has every Upstream installed globally, with startup hooks. So each Arm gets its own `CLAUDE_CONFIG_DIR` and `XDG_CONFIG_HOME`, logged in once and reused for every Trial, and a static check before each Trial marks it invalid if that dir has anything unexpected in it.

The Same-rules baseline is set up the way a user who installed every Upstream would have it, even where that helps the baseline: caveman's always-on voice stays on (the team's installer turns it off), and steipete's rules are wired in through that dir's `CLAUDE.md`, since a folder nothing points at isn't really installed. Same reasoning as ADR 0002: when in doubt, choose the setup that makes the baseline harder to beat.
