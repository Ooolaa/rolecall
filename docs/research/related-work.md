# Related work

How published work on multi-agent and role-based coding relates to Rolecall's benchmark (three Arms, script-scored hidden tests and Traps, tokens, cost and time).

Sources were checked at the arXiv abstract or HTML page, the conference listing given there, or the first-party blog or docs page, in November 2026. Anything not confirmed at the primary source is marked **unverified**. Numbers are the paper's own unless marked otherwise.

## Role-based multi-agent software development

### ChatDev

Chen Qian, Wei Liu, Hongzhang Liu, Nuo Chen, Yufan Dang, Jiahao Li, Cheng Yang, Weize Chen, Yusheng Su, Xin Cong, Juyuan Xu, Dahai Li, Zhiyuan Liu, Maosong Sun. "ChatDev: Communicative Agents for Software Development." ACL 2024 (according to the arXiv comments). https://arxiv.org/abs/2307.07924

- Role-playing agents (CEO, CTO, programmer, reviewer, tester) move through a "chat chain" of design, coding and testing phases, and use "communicative dehallucination" (CDH).
- On SRDD (1,200 generated software prompts), ChatDev scores 0.88 executability and 0.3953 quality, against MetaGPT's 0.4145 and 0.1523 and GPT-Engineer's 0.3583 and 0.1419 (Table 1).
- Cost: ChatDev uses 22,949 tokens and 148 s per task, against GPT-Engineer's 7,183 tokens and 15.6 s, so about 3x the tokens for its gains (Table 3).
- In the ablation (Table 4), removing roles gives the largest drop: executability falls from 0.88 to 0.58 and quality from 0.3953 to 0.2212.
- Scoring is largely model-based (completeness, consistency via embeddings, executability by running), on tasks the authors generated.

Bearing: this supports giving each Role a distinct job. But ChatDev's baselines are other frameworks, not a single agent given the same instructions, which is exactly the gap Rolecall's Same-rules baseline fills.

### MetaGPT

Sirui Hong, Mingchen Zhuge, Jiaqi Chen, Xiawu Zheng, Yuheng Cheng, Ceyao Zhang, Jinlin Wang, Zili Wang, Steven Ka Shing Yau, Zijuan Lin, Liyang Zhou, Chenyu Ran, Lingfeng Xiao, Chenglin Wu, Jürgen Schmidhuber. "MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework." arXiv 2308.00352 (v7, 2024). https://arxiv.org/abs/2308.00352. The commonly cited ICLR 2024 venue is **unverified** (the arXiv page lists none).

- Standard operating procedures (SOPs) are encoded as role prompts on an assembly line (product manager, architect, project manager, engineer), with structured documents handed between roles.
- It reports 85.9% and 87.7% Pass@1 on HumanEval and MBPP. Executable feedback adds 4.2 and 5.4 points.
- On SoftwareDev against ChatDev (Table 1): executability is 3.75 vs 2.25 (scale of 1 to 4), human revision cost 0.83 vs 2.5, and tokens 31,255 vs 19,292.
- In the role ablation (Table 3), going from engineer only to all four roles raises executability from 1.0 to 4.0 and cuts revisions from 10 to 2.5. Expense rises from $0.915 to $1.385, and lines of code from 83 to 191.

Bearing: this supports handoffs through written artifacts (Rolecall's brief, then plan, then code). It also warns that more roles produce more code, so `linesChanged` and the scope-creep Trap matter.

### Self-collaboration code generation

Yihong Dong, Xue Jiang, Zhi Jin, Ge Li. "Self-collaboration Code Generation via ChatGPT." ACM TOSEM (according to the arXiv comments). https://arxiv.org/abs/2304.07590

- An analyst, a coder and a tester are all the same LLM given different role instructions. It reports a 29.9% to 47.1% relative Pass@1 gain over the base LLM agent.

Bearing: this is the closest analogue to Rolecall, since its "team" is one model with role prompts. Its baseline has no role instructions, so it is comparable to the Bare baseline, not the Same-rules one.

### AgentCoder

Dong Huang, Jie M. Zhang, Michael Luck, Qingwen Bu, Yuhao Qing, Heming Cui. "AgentCoder: Multi-Agent-based Code Generation with Iterative Testing and Optimisation." arXiv 2312.13010 (v3, 2024). https://arxiv.org/abs/2312.13010

- A programmer, a test designer and a test executor work together. With GPT-4 it reaches 96.3% (HumanEval) and 91.8% (MBPP) Pass@1, against 90.2% and 78.9% for the previous state of the art.
- It reports a lower token overhead than that baseline: 56.9K vs 138.2K on HumanEval, and 66.3K vs 206.5K on MBPP.

Bearing: this supports keeping tests apart from the code they check (the Builder writes the tests, the Gatekeeper runs them). It also shows that a multi-agent setup can sometimes cost less, so tokens should be reported rather than assumed to be higher.

### MapCoder

Md. Ashraful Islam, Mohammed Eunus Ali, Md Rizwan Parvez. "MapCoder: Multi-Agent Code Generation for Competitive Problem Solving." arXiv 2405.11403 (2024). https://arxiv.org/abs/2405.11403. The ACL 2024 venue is **unverified** (the arXiv page lists none).

- Four agents handle retrieval, planning, coding and debugging. It reports Pass@1 of 93.9% on HumanEval, 83.1% on MBPP, 22.0% on APPS, 28.5% on CodeContests and 45.3% on xCodeEval.

Bearing: this is weak evidence for Rolecall. It uses single-function competitive problems, not feature work in an existing repository.

### CodeAgents

Bruce Yang, Xinfeng He, Huan Gao, Yifan Cao, Xiaofan Li, David Hsu. "CodeAgents: A Token-Efficient Framework for Codified Multi-Agent Reasoning in LLMs." arXiv 2507.03254 (2025). https://arxiv.org/abs/2507.03254

- Multi-agent prompts are written as structured pseudocode. It reports gains of 3 to 36 points on planning benchmarks (GAIA, HotpotQA, VirtualHome) and cuts input tokens by 55% to 87% and output tokens by 41% to 70%.

Bearing: this suggests a metric. How Roles talk to each other (Reviewer terseness, the format of messages between Roles) is a cost lever, so report Teammate message tokens separately from tool and code tokens.

## Does the team help, or only the extra compute?

### More Agents Is All You Need

Junyou Li, Qin Zhang, Yangbin Yu, Qiang Fu, Deheng Ye. "More Agents Is All You Need." TMLR (according to the arXiv page). https://arxiv.org/abs/2402.05120

- Plain sampling and voting ("Agent Forest") scales with the number of agents. On GSM8K, Llama2-13B rises from 35% to 59% with 40 agents, beating a single Llama2-70B at 54%.
- On HumanEval the gains are 4 to 9 points (GPT-3.5-Turbo from 67% to 73%).

Bearing: this threatens validity. Some of any Team gain may come from spending more samples rather than from the Roles. A "best of N same-rules sessions at Team cost" control would separate the two.

### Single-agent vs multi-agent under equal thinking budgets

Dat Tran, Douwe Kiela. "Single-Agent LLMs Outperform Multi-Agent Systems on Multi-Hop Reasoning Under Equal Thinking Token Budgets." arXiv 2604.02460 (v2, April 2026). https://arxiv.org/abs/2604.02460

- When thinking tokens are held equal (100 to 10k), a single agent "is the best-performing system or statistically indistinguishable from the best for all budgets" except 100 tokens, on FRAMES and MuSiQue with Qwen3, DeepSeek-R1-Distill-Llama and Gemini 2.5.
- Average accuracy at 1k tokens is 0.418 for the single agent against 0.388 for the best multi-agent setup (Debate). At 10k it is 0.426 against 0.423 (Parallel-roles), from Table 1.
- The authors argue, from the Data Processing Inequality, that multi-agent setups should win only when a single agent's use of its context degrades.
- They also report that API budget controls are inaccurate for Gemini: a single agent's visible thinking plateaus below the requested budget, which inflates apparent multi-agent gains.

Bearing: this threatens validity and suggests a metric. Rolecall should report results at matched cost, and should not trust requested budgets, measuring tokens from the transcripts instead (which the runner already does). The domain is multi-hop QA, not coding.

### Multi-agent collaboration for automated research

Yang Shen, Zhenyi Yi, Ziyi Zhao, Lijun Sun, Dongyang Li, Chin-Teng Lin, Yuhui Shi. "An Empirical Study of Multi-Agent Collaboration for Automated Research." arXiv 2603.29632 (v2, May 2026). https://arxiv.org/abs/2603.29632

- Compares one agent, "subagents" (three parallel workers plus a coordinator that merges their patches) and an "agent team" (three fixed-role experts handing off in turn on one shared worktree). The task is optimizing a GPT training script under fixed time budgets of 300 s and 600 s, using GLM-4.6v and GLM-4.7 models.
- At 300 s, the subagent setup made 7 effective improvements in 50 rounds, against 3 for the agent team. The team was "more fragile due to multi-author code generation": missing imports, shape mismatches and logic errors built up across handoffs. It produced more structurally complex changes and may suit larger budgets.
- The single agent plateaued early. Despite the name, the paper does not use Claude Code agent teams; it only mentions them in related work.

Bearing: this supports Rolecall's choice to have only the Builder edit source. It threatens results on small tasks such as `04-item-duplicate`, where deliberation eats the budget. It also suggests reporting the time spent before the first code edit.

### Towards a science of scaling agent systems

Yubin Kim, Ken Gu, Chanwoo Park, and 17 others. "Towards a Science of Scaling Agent Systems." arXiv 2512.08296 (v3, April 2026). https://arxiv.org/abs/2512.08296

- Covers 260 configurations, six agentic benchmarks and three model families. Against a single agent, multi-agent results range from +80.8% on decomposable financial reasoning to -70.0% on sequential planning.
- Gains shrink when the single-agent baseline is already strong, tool-heavy tasks pay a coordination cost, and architectures with no central verifier spread errors further.

Bearing: this supports a central verifier (the Gatekeeper) and predicts the Team will help least on sequential, tool-heavy work. That is what most feature tasks look like, so a null result is plausible and should be reported plainly.

## Failure analysis

### Why Do Multi-Agent LLM Systems Fail? (MAST)

Mert Cemri, Melissa Z. Pan, Shuyi Yang, Lakshya A. Agrawal, Bhavya Chopra, Rishabh Tiwari, Kurt Keutzer, Aditya Parameswaran, Dan Klein, Kannan Ramchandran, Matei Zaharia, Joseph E. Gonzalez, Ion Stoica. "Why Do Multi-Agent LLM Systems Fail?" arXiv 2503.13657 (v3, October 2025). https://arxiv.org/abs/2503.13657. The arXiv page lists no venue.

- Draws on more than 1,600 annotated traces from 7 frameworks (MetaGPT, ChatDev, HyperAgent, AppWorld, AG2, Magentic-One, OpenManus). The taxonomy was built from 150 traces with expert annotators, reaching kappa = 0.88.
- It defines 14 failure modes in 3 categories:
  - System design: FM-1.1 disobey task specification, 1.2 disobey role specification, 1.3 step repetition, 1.4 loss of conversation history, 1.5 unaware of termination conditions.
  - Inter-agent misalignment: FM-2.1 conversation reset, 2.2 fail to ask for clarification, 2.3 task derailment, 2.4 information withholding, 2.5 ignored other agent's input, 2.6 reasoning-action mismatch.
  - Task verification: FM-3.1 premature termination, 3.2 no or incomplete verification, 3.3 incorrect verification.
- The most common modes are step repetition (15.7%), reasoning-action mismatch (13.2%), unaware of termination (12.4%) and disobey task specification (11.8%).
- In a ChatDev case study, better role specifications raised success by 9.4%, and a high-level verification step raised it by 15.6% on ProgramDev. Completion rates stayed low even so.
- The paper ships an LLM-as-judge annotator.

Bearing: this gives a ready coding scheme for failed Team runs. FM-1.1 and FM-2.3 correspond to the scope-creep Trap, and FM-3.2 and FM-3.3 to the broken-caller Trap. It also supports the Skeptic's job of asking questions (FM-2.2).

## Single-agent and simple pipelines

### Agentless

Chunqiu Steven Xia, Yinlin Deng, Soren Dunn, Lingming Zhang. "Agentless: Demystifying LLM-based Software Engineering Agents." arXiv 2407.01489 (v2, October 2024). https://arxiv.org/abs/2407.01489. The FSE 2025 venue is **unverified** (the arXiv page lists none).

- A fixed three-phase pipeline (localize, repair, validate the patch) with no agent planning. It solves 32.00% of SWE-bench Lite (96 issues) at $0.70 per issue, which the authors call the best performance and lowest cost among open-source agents at the time.
- A manual audit of SWE-bench Lite found issues whose descriptions contain the exact fix, and others that are underspecified or misleading. The authors release a filtered subset, Lite-S.

Bearing: this sets the bar that any added structure must beat a simple setup at matched cost. It also shows why Rolecall's prompts must not give away the Trap's answer, and must not be so vague that a hidden test checks something the prompt never asked for.

### Cognition, "Don't Build Multi-Agents"

Walden Yan. "Don't Build Multi-Agents." Cognition blog, 12 June 2025. https://cognition.com/blog/dont-build-multi-agents (the old cognition.ai URL redirects there)

- Two principles: "Share context, and share full agent traces, not just individual messages," and "actions carry implicit decisions," so agents acting on conflicting assumptions produce bad results.
- In the Flappy Bird example, parallel subagents built a Super Mario style background and a bird that did not match it.
- Recommends single-threaded linear agents, with context compression for long tasks.

Bearing: this threatens the Team design. Teammates get a spawn prompt, not the Lead's history. Rolecall mitigates this with the written brief and plan, a single Builder and file ownership. Tag "conflicting assumptions" failures explicitly, for example design Roles disagreeing with what was built.

### Anthropic, "How we built our multi-agent research system"

Jeremy Hadfield, Barry Zhang, Kenneth Lien, Florian Scholz, Jeremy Fox, Daniel Ford. "How we built our multi-agent research system." Anthropic Engineering, 13 June 2025. https://www.anthropic.com/engineering/multi-agent-research-system

- An Opus 4 lead with Sonnet 4 subagents beat a single Opus 4 agent by 90.2% on an internal research eval.
- On BrowseComp, token usage alone explains 80% of the variance in performance, and tokens plus tool calls plus model choice explain 95%.
- Agents use about 4x the tokens of chat, and multi-agent systems about 15x.
- The authors name coding as a weaker fit: "fewer truly parallelizable tasks," with tight dependencies and a need for shared context.
- For agents that change state, they recommend judging the end state rather than the path taken.

Bearing: the 80% finding is the strongest argument for a cost-matched comparison. The coding caveat predicts that Rolecall's gains, if any, come from review and verification rather than parallelism. The end-state advice supports scoring the final tree by script.

### Claude Code agent teams documentation

Anthropic. "Orchestrate teams of Claude Code sessions." Claude Code docs. https://code.claude.com/docs/en/agent-teams (read November 2026)

- "Agent teams add coordination overhead and use significantly more tokens than a single session... For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective."
- Teammates load the same CLAUDE.md, skills and MCP servers as a normal session but not the Lead's history. Spawning teammates "requires an interactive session"; with `-p`, no team forms.

Bearing: the vendor itself expects little gain on sequential feature work. The interactive-only constraint is why Team runs are driven by a person while the baselines run headless. That asymmetry is a validity threat (see below).

## Benchmarks and methodology

### SWE-bench

Carlos E. Jimenez, John Yang, Alexander Wettig, Shunyu Yao, Kexin Pei, Ofir Press, Karthik Narasimhan. "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?" ICLR 2024. https://arxiv.org/abs/2310.06770

- 2,294 issue and pull request pairs from 12 Python repositories, scored by hidden fail-to-pass and pass-to-pass tests. The best model at the time, Claude 2, resolved 1.96%.

Bearing: Rolecall follows the same idea, with hidden tests for the feature and the template's own tests as pass-to-pass (the broken-caller Trap).

### SWE-bench Verified

OpenAI with the SWE-bench authors. "Introducing SWE-bench Verified." 13 August 2024. https://openai.com/index/introducing-swe-bench-verified/

- **Unverified at the primary source** (the page returned HTTP 403). Search snippets of that page say 93 developers screened 1,699 samples for underspecified issues and unfair tests, and kept 500.

Bearing: this suggests a check. Have a person who did not write a task confirm that each `prompt.md` fully specifies what its hidden tests check.

### SWE-Bench+

Reem Aleithan, Haoran Xue, Mohammad Mahdi Mohajer, Elijah Nnorom, Gias Uddin, Song Wang. "SWE-Bench+: Enhanced Coding Benchmark for LLMs." arXiv 2410.06992 (2024). https://arxiv.org/abs/2410.06992

- For SWE-Agent with GPT-4, 32.67% of successful patches had the solution leaked in the issue, and 31.08% passed only because the tests were weak. After filtering, the resolve rate fell from 12.47% to 3.97%.
- Over 94% of issues predate the models' knowledge cutoffs.

Bearing: this threatens validity on two counts. full-stack-fastapi-template is very popular and likely in training data. And a hidden test that is too weak lets a wrong patch pass. The trap fixtures (each trips only its own Trap) are the right defense, so keep adding them.

## Rule files and context files

### Evaluating AGENTS.md

Thibaud Gloaguen, Niels Mündler-Sasahara, Mark Niklas Müller, Veselin Raychev, Martin Vechev. "Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?" arXiv 2602.11988 (v3, September 2026). https://arxiv.org/abs/2602.11988. The ICLR 2026 venue appears in search results but is **unverified** (the arXiv page lists none).

- Context files "do not generally improve task success rates" and raise inference cost by over 20% on average. This holds across Claude Code (Sonnet 4.5), Codex (GPT-5.2, GPT-5.1 mini) and Qwen Code.
- LLM-generated files changed resolution by about -0.5 points on SWE-bench Lite and -2 points on the authors' 138-task benchmark (neither significant). Developer-written files gave about +2.4 points (p = 0.21).
- Agents do follow the instructions, running more tests and exploring more files (about 2.5 to 3.9 extra steps). Repository overviews did not help.

Bearing: this is the closest prior work to Rolecall's Same-rules versus Bare comparison. It predicts that Upstreams raise cost more than they raise success, so report that comparison too, even though ADR 0002 keeps it out of the headline.

## Over-editing and scope creep

### When Models Edit Too Much

Tongyao Zhu, Wei Hern Lim, Min-Yen Kan. "When Models Edit Too Much: On the Fidelity of Minimal Code Edits." EMNLP 2026 Main (according to the arXiv page). https://arxiv.org/abs/2609.04061

- Uses 400 BigCodeBench problems with injected AST-level corruptions, so each has a known minimal patch. Over-editing is widespread across frontier models, and a high Pass@1 can coexist with large edits.
- A single preservation instruction cut excess Levenshtein distance from 0.195 to 0.131 and added cognitive complexity by 26.6%, and raised Pass@1 by 2.3 points.

Bearing: this supports ponytail as the Base rule, since one instruction measurably reduces over-editing. It also suggests a size metric normalized against `good.patch`, beyond raw `linesChanged`.

### TRIM

Alex Mathai, Shobini Iyer, Aleksandr Nogikh, Petros Maniatis, Franjo Ivancic, Junfeng Yang, Baishakhi Ray. "TRIM: Reducing AI-Generated CodeSlop via Agent Trajectory Minimization." arXiv 2607.18161 (2026). https://arxiv.org/abs/2607.18161

- Agents leave edits from abandoned hypotheses in the final patch ("CodeSlop"). Minimizing the trajectory cuts this by 17.9% to 32.9% with negligible regression.

Bearing: this suggests a metric. Count hunks in a Trial's patch that can be reverted without failing any hidden or template test. A Reviewer Role should lower that count.

### PAFT

Boyang Yang, Zijian Cai, Shunfu Jin, Haoye Tian. "PAFT: Preservation Aware Fine-Tuning for Minimal-Edit Program Repair." arXiv 2604.03113 (2026). https://arxiv.org/abs/2604.03113

- Treats over-editing as its own failure mode in program repair. It cuts average edit distance by up to 32.6% against standard fine-tuning on Defects4J and HumanEval-Java.

Bearing: more evidence that patch size relative to a reference is a standard, reportable metric.

## What is new in Rolecall's setup

- **A same-rules baseline.** The papers above compare a multi-agent system against a bare model, other frameworks or a role-free single agent. None we found gives the single agent every rule set the team uses. ChatDev, MetaGPT and Self-collaboration all confound "roles" with "more instructions." Rolecall's headline comparison (ADR 0002) isolates the team structure.
- **Roles built on existing rule sets.** The Roles are built from popular, independently written open-source rule sets rather than prompts written for the paper.
- **Seeded Traps scored by script.** Unvalidated input, unneeded dependencies, scope creep and broken callers measure the costs of over-building and regressions that the over-editing papers flag. These are measured on feature work, not on bug repair or single-function synthesis. No LLM is used in scoring, which avoids the model-graded metrics used by ChatDev, MetaGPT and the Anthropic research eval.
- **Feature tasks in a real full-stack repository**, including UI work, where most role-based coding papers use HumanEval, MBPP or generated app specs.
- **A shipping product in place of a research scaffold.** The Team is a stock agent framework (Claude Code agent teams), with each Arm in its own config dir and cost counted from every transcript.
- **A deliberately small task** (`04-item-duplicate`) to show where the team is overkill. The literature mostly reports only gains.

## Threats to validity the literature raises

1. **Compute, not structure.** More Agents, Tran and Kiela, and Anthropic's 80% finding all say extra tokens alone buy accuracy. A Team win at about 5x to 8x the cost may only show that spending more helps.
2. **Person-driven Team runs against headless baselines.** Agent teams need an interactive session, so a person drives each Team run. Even with scripted replies, the person can time things, intervene and clarify in ways the baselines never get. Answering whether they kept to the script helps but does not remove this.
3. **Small samples.** 54 Trials means 3 per task and Arm. Tran and Kiela, and the AGENTS.md paper, find differences of a few points that are not significant at much larger n. Report every Trial, and do not report means without spread.
4. **Contamination.** full-stack-fastapi-template is widely used, so the model may already know it (SWE-Bench+ found over 94% of issues predate the cutoff). This affects every Arm equally, but it may hide where the Roles help.
5. **Task specification.** Agentless and SWE-bench Verified show that underspecified tasks and leaked solutions distort results. The added line "No more information is available..." blocks clarification, which penalizes the Skeptic's main job (MAST FM-2.2). Note this as a design choice that cuts against the Team (kept on purpose, ADR 0007).
6. **Weak hidden tests.** SWE-Bench+ found 31% of passing patches suspicious. A Trap that only checks changed-file globs (scope creep) can miss creep inside allowed files, or flag a legitimate edit.
7. **Task type.** Anthropic, the agent teams docs and Kim et al. all expect the least multi-agent benefit on sequential, tightly coupled coding, so do not generalize results to research or review work.
8. **Fragile handoffs.** Shen et al. found agent teams fail through multi-author edits. Rolecall's single Builder avoids this, but a failure in the Lead's relaying or in task status (which the docs say "can lag") could count against the Team for tooling reasons, not design reasons. Separate these in the write-up.
9. **Rule files cost more without helping.** The AGENTS.md paper predicts the Same-rules baseline may cost more than Bare without doing better. That is not a flaw, but make sure the Same-rules Arm is not handicapped, for example by caveman's voice degrading its output.

## Suggested additions to the results write-up

- **A cost-matched comparison.** Alongside the per-Trial results, report results against Same-rules sessions given about the Team's token spend: best-of-N with the hidden tests unseen, or picked by the template's own tests only. Plot pass rate and Traps tripped against `costUsd` for every Trial, not just the means.
- **MAST tagging of every failed or Trap-tripping Team Trial**, with the 14 modes (by hand, or with the MAST LLM annotator labelled as such). Tag failed baseline Trials with the subset that applies to one agent (FM-1.1, 1.3, 1.5, 3.1 to 3.3), so failure profiles can be compared.
- **Patch size against `good.patch`**: excess lines or edit distance over the reference, and the number of hunks that can be reverted without failing any test (in the spirit of TRIM). This turns over-editing from a pass or fail Trap into a continuous measure.
- **Time and tokens before the first source edit**, and the split of Team tokens by Role, to show where the deliberation cost goes (Shen et al.).
- **The Same-rules versus Bare comparison reported in full**, as a replication of the AGENTS.md finding for the eight Upstreams. It is secondary to the headline, but it is evidence other people will want.
- **Spread and significance.** Report per-cell counts (for example, 2/3 passed) and an exact or paired test across tasks. Say plainly when there is no difference.
- **An audit of each task's specification** by someone who did not write it (in the SWE-bench Verified style), and a note on which hidden tests check behavior the prompt only implies.
- **A note on how far each Team run departed from the script**, and the share of Team Trials marked invalid, so readers can judge threat 2.
