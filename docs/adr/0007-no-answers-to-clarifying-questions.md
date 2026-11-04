# Clarifying questions get no answers, so every task must stand on its own

Every Trial's prompt ends with "No more information is available beyond this prompt; use your judgement." In a Team Trial, the same line is the scripted reply whenever the team asks a question. We considered having the runner answer questions from a fixed script per task, and rejected it for two reasons. First, the baselines run headless and can't ask anything, so only the Team would get the extra information, the kind of tilt ADR 0002 avoids. Second, each task's ambiguity sits in its Trap bait ("we'll want this on the users list later"), so any scripted answer would defuse or give away the Trap. We also rejected dropping the line from the prompt while still replying with it: the team would ask more, spend more, and learn nothing new.

This cuts against the Skeptic, whose job includes asking questions (MAST FM-2.2; related-work threat 5). It is judged instead on the assumptions it states and the scope it guards. Questions the Team asked are counted by hand from the transcripts during the MAST tagging, with no runner code for it unless the pilot shows they are common.

Consequences: the decision holds only if no prompt depends on an answer it can't get. Before the full benchmark, and for every task added later, someone who didn't write the task checks that the prompt can be done as written.
