# Study notes: Robert Haas, "Committer review: an exercise in paranoia"

- Talk: PGConf.dev 2025, 50:29, published 2025-06-17. Video: https://youtu.be/3M8E_z1y_J0
- Source for these notes: the YouTube English subtitles (`v.en.vtt`), converted to plain text. The slides were not available, so anything that was only on a slide (the pyramid picture, the sample C function, the two photos) is known here only through what he said about it.
- Timestamps `[mm:ss]` are approximate (the transcript has one marker per minute; points inside a minute are estimated, so expect an error of up to about 30 seconds).
- Quotation marks are used only for wording that is in the transcript (lightly cleaned: fillers removed, caption typos fixed). Everything else is paraphrase.
- Sections 1-8 are "what he said". Section 9 is my own inference and is marked as such.

## 1. Structure of the talk

| Time | Part |
|---|---|
| 00:16 | Introduction; origin of the talk (extemporaneous remarks at the Advanced Patch Feedback Session, PGConf.dev 2024) |
| 01:18 | Agenda: part 1 "committer mindset", part 2 "actually reviewing patches" |
| 02:20-13:30 | Part 1: why committers are reluctant (responsibility, ease of mistakes, stress) |
| 13:34-14:35 | Part 2 opens: he will not give a full checklist, he gives four general principles |
| 14:35-16:40 | The four principles in brief |
| 16:40-25:10 | Principle 1: start with the big picture (the "patch review hierarchy of needs" pyramid) |
| 25:10-35:30 | Principle 2: consistency is critical (incl. the sample-code slide, 28:48-35:30) |
| 35:30-42:40 | Principle 3: be a pessimist |
| 42:40-44:50 | Principle 4: apply a spirit of maintainership |
| 45:06-50:29 | Q&A: CI vs buildfarm, when to relax paranoia, paranoia across the release cycle, GenAI for review |

He states the limits of his claims up front: "not all committers have the same mind ... I'll tell you what I believe people are generally thinking" [01:25]. He also says getting patches committed is hard for many reasons, "the overwhelming majority of which I cannot address in this talk" [02:10]; the mindset is only one of them.

## 2. Part 1: the committer mindset (why caution, even with good patches)

### 2.1 The committer, not the author, owns what goes wrong

- The perceived reluctance "basically comes from the fact that if you commit somebody's patch you - not they - are responsible for whatever goes wrong. There are no excuses and there is no statute of limitations." [02:45]
- Immediate duty: "If you break the build farm, you must fix it immediately." Night, weekend, planned holiday, natural disaster: none of it matters. "The build farm is a shared resource and you can't leave it broken." [03:00-03:25]
- Long-term duty: "Even many years later you may be called upon to defend the design, to fix bugs, or to maintain the code." [03:35]
- "Whenever you commit a patch you're accepting a certain amount of open-ended liability for the things that may go wrong in the future"; he compares it to writing blank checks, and calls it "a little bit of a miracle that we manage to commit a few thousand of them every year." [05:40-06:10]

### 2.2 War story: JIT and LLVM [03:45-05:40]

- Andres told him that when JIT was committed, the LLVM interfaces Postgres depended on "had been pretty stable for a while. Subsequent to that they have not been so stable."
- Most committers do not know those interfaces, so when something must be updated for a new LLVM version, "we're going to ask Andres, of course."
- Good news, and "this actually happens pretty commonly": someone else jumps in. Thomas Munro did a lot of the updating for newer LLVM versions.
- But the committer cannot know in advance: the external project "could change nothing or they could change all kinds of things"; "six other committers could show up and volunteer to help clean up the mess or everybody could be like 'Heh, your job.'"
- Lesson he draws: a dependency on an external moving interface is an open-ended liability taken by one person.

### 2.3 Authors usually do not help with the aftermath [06:10-07:25]

- "You tend not to get much help at all from the patch author." Fair reasons: time zones; the author did not know when the commit would happen.
- He has asked authors in advance to be available, and some agreed. Even in the best case, the discussion and the writing of follow-up fixes "tends to get left to the committer and the author stays out of it."
- "That naturally produces a certain amount of caution on the part of committers."

### 2.4 Mistakes are easy; everybody makes them [07:28-10:30]

- "We have an incredible number of extremely talented people working on PostgreSQL and all of them regularly introduce serious bugs. I also regularly introduce serious bugs when I commit things." [07:40]
- "Data corruption bugs and server crashes make it into the source tree quite often." Some are not caught before release; those caught quickly still make work; smaller errors are more common. [08:00]
- War story 1, his first known data-corrupting bug [08:30-09:30]: reported by Jeff Davis ("my heart just sank"). It reached release and shipped "I think for over a year". It was "basically a 1-line omission": one more function needed an update than the number of functions he found. Jeff added asserts and comments, but the core fix was one line. "I don't know and will never know how many people suffered data loss as a result of that mistake on my part but it probably isn't zero." (He does not name the commit or the feature in the spoken text; it was on the slide.)
- War story 2, pg_overexplain [09:31-10:30]: a new contrib module, two reviewers, "one of whom was Tom Lane". The buildfarm broke anyway; three commits that same evening to fix it; next morning more "silly things" found by people who read the commit. One intended commit became six, and "numbers 2, 3, 4, 5, and 6 are all public documentation of how foolish I was in commit number one."

### 2.5 Stress, embarrassment, fear [10:32-13:30]

- Being a committer is a privilege, but non-committers imagine a satisfied person typing `git push`; in his experience and that of committers he spoke with, it is the opposite. "Committing patches is stressful." [11:25]
- Difference among committers: he finds it "somewhat stressful"; a few others "described levels of stress that far exceeded what I was describing and that seemed quite extreme." [11:35]
- Result: "painstaking and exhaustive verification of a patch set to the best of their ability before they push it - and then things still go wrong and they have to scramble." [11:50]
- Evidence he offers: "there are some great patches written by committers that sit on the mailing list for years without being committed", because the committer is "afraid of what will go wrong". Sometimes another committer who needs the fix later picks it up: now that person "only [has] to be responsible for the aftermath and not also writing the patch." Everybody wins "except perhaps for the users who had to wait a couple of extra years". [12:05-12:55]
- Public embarrassment "weighs rather heavily on the minds of a lot of people"; "in extreme cases people might even be afraid that they're actually going to lose their commit privileges." [13:00-13:30]

## 3. Part 2: the four principles in brief [14:35-16:40]

He declines to give a full checklist: there are too many things to check, it is "quite difficult to remember all the things that you're supposed to check for every single patch", and other talks cover it [13:50-14:30].

1. Start with the big picture. "If the design of the patch is incorrect in some fundamental way then it really doesn't matter whether the patch contains typos." [14:40]
2. Consistency is critical. New things are fine, "but the departures from existing practice need to be well justified ... it should be more than your personal preference." [15:00]
3. Be a pessimist. Every thread has at least one person who thinks the patch is good: the author. "Being a good reviewer requires questioning the assumption that the author got the patch right." [15:20-16:00]
4. Apply a spirit of maintainership. It is easy to make "getting that patch committed, ideally in something close to its present form, ideally as soon as possible, your overriding goal". But the project goes on; the question is how the patch affects the project overall, "not just about whether it is good in isolation." [16:00-16:50]

## 4. Principle 1: start with the big picture (the pyramid) [16:40-25:10]

He calls it "a sort of patch review hierarchy of needs". All levels must be right; lower levels are more foundational. Bottom to top, as he describes it:

### Level 1 (base): understandability and desirability [16:55-17:55]

- Understandability: "Is the idea that the author is proposing clear enough that we can actually evaluate it in some meaningful way?"
- Desirability: "Is it actually a good idea?"
- "There is very little point in doing detailed review, let alone fixing typos, if we don't have any idea what the patch is attempting to accomplish or we don't want that."

### Level 2: architecture and design [17:55-19:55]

"If we agree on the goal then do we agree on the way that the patch goes about that goal, at least in broad strokes?" He lists:

- Safety: "does the patch violate some invariants in the code which are going to result in it doing bad things like crashing the system or eating your data?" [18:15]
- Performance: is the design conducive to good performance; and even for a non-performance patch, "whether a design has been chosen which is likely to regress the performance of other things." [18:30-18:45]
- Maintainability: "Are we going to be able to maintain this code? Is it going to need to be constantly updated? Are there going to be updates that will need to be made to this code by future patches that someone will be likely to miss when they are reviewing those patches?" [18:45-19:05]
- User interface: new or modified SQL syntax, "or even just a function that could be called"; psql features too. [19:05-19:40]
- API: things that are strictly internal still have "maybe not a UI but an API ... Is it going to be something that is usable?" [19:40-19:55]

### Level 3: patch set structure, comments, code structure [19:55-22:40]

- Other committers may differ: "I suspect that some people would quibble with the way that I've divided things between the yellow and orange layers" [20:00].
- Patch set structure: split logically, each patch a separate change that could be applied separately, in the submitted order. A split by directory is "not useful at all". Infrastructure first, dependants after. [20:20-21:05]
- Commit messages and code comments: often missing, he thinks often because of low confidence in English. "I would much rather have some comments in the best English that you can manage than no comments at all"; rewriting comments is much less work than writing them after working out the code by inspection. [21:05-21:55]
- Code structure: sensible subroutines; code in the right directory and the right part of the codebase. [22:00-22:25]
- "I often do some manual verification at this stage as well." [22:30]

### Level 4: detailed review [22:40-23:20]

- Line-by-line review of the whole patch.
- Documentation, tests, tests passing, CI passing. He does not care much about docs and tests in the initial review, "unless of course the lack of documentation leads to the patch not being understandable".
- Difference among reviewers: "we have a few people who are extremely good at grasping the meaning of a patch set that isn't documented but I am not one of those people and I really like to be told what you thought you were trying to accomplish." [22:55-23:15]

### Level 5 (top): final polishing [23:20-23:40]

Coding style, pgindent, typos, grammar of comments. Then the patch can be committed.

### Remarks on using the pyramid [23:40-25:10]

- "Too many people start at the top and they never get to the lower levels of the pyramid and that's really a shame, because actually even if you're not a coder at all you might be able to comment on the UI, for example, and if you're a user you could comment on desirability." [23:40-24:10]
- Bottom-to-top is "an aspirational goal". On a complex patch he may comment on small things and "totally miss the design problems", which he finds on the second or third read. [24:15-24:45]
- Sometimes he writes a long email on small things, then three quarters through sees "some killer problem" that makes the text useless, and throws it away. [24:46-25:05]
- He asks for better comments and commit messages early, only so that he can understand the patch. [25:05]

## 5. Principle 2: consistency [25:10-35:30]

He calls it "a real bedrock principle of reviewing PostgreSQL patches". It "can feel like nitpicking" [25:46]. His reasons:

1. It refutes "political objections": if someone dislikes something and you can answer "because the other 10 cases that we already have in the source tree are like that", then "it isn't a problem you've created and it's not your patch's fault." [26:00-26:30]
2. It avoids bugs: adapting existing code makes it less likely to miss something crucial. [26:35-26:50]
3. Readability and maintainability: code that looks like other Postgres code is easier to understand. He marks this as "actually really important". [26:50-27:10]
4. User experience: inconsistency can "creep out into the user experience". Example, which he calls silly: if each new DDL object type picked its own verb, tables would be DROPped and functions REMOVEd, "a hodge-podge". [27:10-28:00]

Scope: both high level ("is the architecture consistent with what we've done elsewhere?") and low level (is the code written the way similar code is written). [28:00-28:20]

"Coding micro-practices": "numerous little things that we almost always do in the same way and which you're encouraged not to deviate from", unless there is a compelling reason. He says this is one thing that makes it hard to become a skilled Postgres hacker. [28:20-28:48]

### The sample-code slide [28:48-35:30]

A short C function (on the slide; not in the transcript) that is pgindent-clean, compiles without warnings, "and if you're really lucky it might even work". Problems he lists:

- `extern` on a function definition (convention: only on the declaration). [29:35]
- Variables not declared in the innermost scope. [29:50]
- Names: a `HeapTuple` named `h` (convention: `tuple`, `tup`, `htup`, `dbtup`); a `Form_pg_database` named `dbstruct` (convention: something with "form"). [30:00-30:25]
- `palloc0` where every byte is overwritten: wasted overhead. [30:30]
- `++i` vs `i++`: "A committer might or might not call you on" it; the tree has `i++` about nine times as often. (Explicit committer-to-committer variation.) [30:40-31:00]
- Calling `SearchSysCache` directly, not the `SearchSysCache1` macro. [31:00]
- First serious bug: missing `ObjectIdGetDatum` around `oids[i]`; he says it works on one endianness and fails on the other, so the author can test and not see it, but "the build farm will tell the committer". [31:15-31:45]
- `h == NULL` in place of `HeapTupleIsValid`. [31:50]
- Non-standard error message for a missing catalog tuple. [31:55]
- Second serious bug: `ReleaseSysCache` invalidates a pointer just stored in the result array; it may seem to work because caches are not clobbered by default; "probably every committer has made [this one] multiple times". [32:00-32:50]

Points he draws from it:

- "Any reviewer with some knowledge of C can find every one of these problems": grep for similar examples and compare carefully. [33:00-33:25]
- "There is no way that we are going to end up with 500 messages that say cache lookup failed for database %u and one message that has this alternative error text." [33:35-33:55]
- Committers spend "quite a lot of time" on this even after they trust the overall structure. He packed "more than a dozen errors" into one short function; "just imagine ... a 4,000 line patch". [33:55-34:35]
- An audience member (not captioned) challenged one point, seemingly the Datum/Oid one. He answered "We do have code like this actually but anyway let's take that one offline", then defended the claim: the lookup key is a Datum, not an Oid; "It might work on your machine, it won't work on all of them." [34:35-35:30] (So this single item was disputed in the room; the transcript does not show how it ended.)

## 6. Principle 3: be a pessimist [35:30-42:40]

- He jokes that people may be "dismayed to hear Robert Haas calling for more pessimism". [35:35]
- His own review failures usually do not come from missing knowledge. When knowledge is the risk, "I realize I'm not qualified to review this patch and I stop and I wait for somebody else who is qualified and will be able to fix whatever breaks", or he takes time to learn the area "well enough that I feel like I can be responsible for it". [36:00-36:45]
- "A mistake that I make all the time is thinking that a certain kind of error probably won't be present and therefore I don't need to check for it exhaustively." [36:45]
- Example: assuming the author can implement a singly linked list. People submit "lots" of broken ones: "linked lists, hash tables, binary searches, all sorts of fundamental algorithms people do them wrong." [36:56-37:30]
- "Authors miss all kinds of things: they miss design flaws, they don't check all the different parts of the code, they miss regressions". "Extreme pessimism in my experience is still often not enough pessimism." [37:30-37:55]

Techniques:

- `git grep` a lot. If the patch changes something related to identifier XYZ, grep it and look for places not adjusted. War story: his first committed patch, the grantable TRUNCATE privilege; he found `ACL_DELETE`, added `ACL_TRUNCATE`, and visited every use of `ACL_DELETE`. The same works in review: find the existing analogue of what is added, grep for it. [37:57-39:05]
- Think about pairings: "What operations logically go together?" Allocate/deallocate, create file/remove file, set global/clear global. Sometimes a built-in mechanism (memory contexts) does it. The question: does the code you see imply other code that must exist, and does that code exist? [39:05-39:58]
- System-wide consequences: this "really benefits from having more knowledge of the system, so it is I think a key role of committers to notice when some part of the code that might be quite far removed needs to be modified as a logical consequence". Example: `CREATE STRAWBERRY` implies `ALTER`/`DROP`/`RENAME TO`/`OWNER TO`, and also pg_dump ("they need to be dumped and restored just like all of the other objects") and maybe a psql command. [39:58-40:59]
- Functional regressions: "If this patch did have a bug someplace where might it be", then poke there. [41:00]
- Performance regressions: "if there were something that this patch slowed down what might it be and under what circumstances", then benchmark to confirm or rule out. [41:10-41:30]
- "Pessimism about your pessimism": it is easy to guess where the bug is, test, find nothing and say all is well, when "the problem was actually in your test". He recommends temporary debugging code (his preference), a debugger or a profiler, to prove the new code is hit. "You got to make sure your test or your benchmark is doing what you think it's doing otherwise the results are not valid." People are "very, very often too optimistic": they do not find the bad cases, or do not hit them. [41:30-42:40]

## 7. Principle 4: spirit of maintainership [42:40-44:50]

- "We need to do what's good for all of us, not what's good for somebody who has a really serious problem that they need to solve that day." [43:00]
- The accumulation argument: there are often arguments that a patch "is worth a 3% performance regression or worth a user interface wart or worth an annual code maintenance task, and sometimes those people are 100% correct because some patches are worth those things, but if we accepted 10 patches like that every release, then every release we'd have a 30% performance regression, 10 user interface warts, and 10 annual code maintenance tasks". [43:10-43:45]
- "So we have to be super judicious about incurring those costs and sometimes the answer is just time. We wait and see, we gather more information", to learn if the change is important enough to enough people. [43:45-44:05]
- Respect: "the patch author always has good reasons to believe that their patch is beneficial to the project. We shouldn't just tell people: go away, your idea sucks." [44:05-44:20]
- The asymmetry to watch: be cautious "especially if the downsides are going to be borne by everyone, and the upside is something that's only going to benefit the people who use the feature." [44:20-44:40]

## 8. Q&A [45:06-50:29]

- Can the buildfarm-type checks run before a committer spends time? [45:06-46:20] Progress exists through CI (Andres and others). "We do not have parity between CI and the build farm" (caption says "party"), so the buildfarm still finds more. A priority should be to let CI catch more; it "would lower everybody's blood pressure".
- Noah (surname not given): paranoia looks like a ratchet that only goes up; when do you relax? [46:20-48:10] Answer: look at "our actual error rate after the paranoia ... If nothing ever goes wrong and we just spend a bunch of time being paranoid then apparently we're too paranoid." The evidence says otherwise: he went through the commits from February and "about 20% of them were post-commit fixups", and "I think another 15% or so were bug fixes from commits longer ago". The direction should be to catch mistakes earlier with less manual load on the committer, not to be less paranoid; "until we have better tools, unless we see the error rate start to decline ... we're going to have to keep up with the paranoia."
- How does paranoia change over the release cycle? [48:11-49:12] "What should happen is the paranoia should be highest at the end; what actually happens is it declines at the end because people are desperate to get their patches in and then what sometimes happens is a flurry of reverts". Feature freeze (caption: "feature phrase") limits the damage because it removes human judgment after that point. That it is needed so badly "shows that people's spirit of maintainership is not always quite at the level that perhaps it should be."
- Can GenAI help committers review before CI? [49:12-50:20] "I definitely would not rule out the possibility that it will get there but right now I would say definitely not ... we all know that AIs hallucinate quite a lot and you can see from examples like this how even a tiny amount of hallucination gives you an uncommittable patch, so that doesn't feel like we've got the necessary level of reliability there yet." (Said in June 2025. His reason is worded about AI output in a patch; the question was about AI review.)

## 8a. Where he says committers differ (collected)

- Mindset is his belief about what committers "generally" think, not a common position [01:25].
- Stress level: his is moderate, some others described much more [11:35].
- Where the line is between "structure/comments" and "detailed review" in the pyramid [20:00].
- Some reviewers can read an undocumented patch set; he cannot and wants to be told the intent [22:55].
- `++i` vs `i++`: a committer "might or might not" object [30:40].
- One sample-code claim was disputed from the audience [34:35].
- End-of-cycle behaviour: people become less careful than they should [48:20].

## 9. My inferences (not said in the talk)

These are my reading of what the talk means for an idea-level reviewer such as PG Roast. He did not say them.

- Only a part of the talk is about ideas. Levels 1-2 of the pyramid and principle 4 are idea/design level. Principle 2 applies at the design level too (architecture and UI consistent with what exists). Most of principle 3 and the whole sample-code part need the code. An idea-level tool can borrow the questions "what else must exist as a consequence" (the STRAWBERRY list) and "if this were slow or broken, where", but cannot verify the answers.
- "Rejected" and "not committed" are different things in his account. Much of the reluctance comes from the cost to one person (liability, stress), not from a defect in the proposal: good patches by committers themselves wait for years. A tool that predicts "will not get in" should say which of the two it means.
- A proposal with a large post-commit liability and no credible owner for the aftermath (author who disappears, external dependency that moves, an area few committers know) is harder to get committed, by his logic in 2.1-2.3. He gives the facts; the predictive rule is mine.
- His accumulation argument (3%, a wart, an annual task) suggests an objection of the form "this cost is paid by everyone, the benefit goes to the feature's users" is the strongest idea-level objection, and that a cost confined to the feature's users is a weak one. He states the asymmetry; the ranking is mine.
- "Sometimes the answer is just time" suggests a verdict between accept and reject: not now, more evidence of demand needed.
- "Pessimism about your pessimism" was said about tests and benchmarks. Applied to a reviewer tool: an objection is worth nothing until the failure scenario is shown to be reachable in this proposal.
- His GenAI answer and his "500 messages" remark together imply that precision matters more than volume: one invented objection makes a review as unusable as one invented line makes a patch.

## 10. The pyramid versus the "four levels" wording in the PG Roast issue (my comparison)

The issue describes a "hierarchy of committer needs" with four levels: (1) is the problem/idea properly stated, (2) is it actually a good idea, will we regret it forever, (3) is the design right (touch points, compatibility, standards), (4) only then, is the implementation right. What the talk says:

- Name: "a sort of patch review hierarchy of needs" [16:40]. He does not say "committer needs".
- Five levels, not four (section 4). The level names in the spoken text are "understandability" and "desirability" (base), "architecture and design" (which he calls "the second level of the pyramid" [17:55]), then patch set structure / comments / code structure, then detailed review, then "final polishing". He refers to two of the layers by slide colour ("yellow and orange" [20:00]); the slide itself was not available.
- The issue's levels 1 and 2 are one level in the talk, with two questions asked in that order ("the absolutely most fundamental question ... is understandability ... the second is similar: desirability" [16:55-17:40]).
- "Will we regret it forever" is not in his words for desirability. The nearest material is in part 1 ("no statute of limitations" [02:45], "defend the design" years later [03:35]) and in principle 4 [43:10].
- The issue's level 3 examples (touch points, compatibility, standards) are not his. His list for architecture and design is safety, performance, maintainability, user interface, API [18:15-19:55]. He does not mention compatibility or the SQL standard anywhere in the talk.
- The issue's level 4 ("implementation") covers his levels 3, 4 and 5.
- "Stop at the first failing level": he says there is "very little point" in detailed review when the base fails [17:40] and that detailed review makes sense once levels 1-2 are sorted [19:55]. He does not state a hard stop rule, and he calls bottom-to-top order "an aspirational goal" that he cannot always follow, because design problems often show only on a second or third read of the code [24:15-25:05].

## 11. "Will not get committed" versus "should be rejected" (my inference, with the talk's basis)

What he said: the reluctance to commit comes from the committer's responsibility for the aftermath [02:45], from open-ended liability [05:40], from little author help [06:10] and from stress [11:25]. His evidence is that "great patches written by committers" wait "for years" because the committer is "afraid of what will go wrong" [12:05]; a later committer may take one and be "responsible for the aftermath" only [12:40]. A committer who is not qualified in an area waits for one who is [36:10]. "Sometimes the answer is just time" [43:45].

What I infer for PG Roast: a patch can stay uncommitted with no defect in the idea. So the output should carry the verdict on the idea and design (levels 1-2) apart from a "committability" field (who would own the aftermath, what liability that person signs for, whether the author will stay), and it should have a visible "not now, show demand" outcome that is not counted as a rejection. He did not propose any of this; the fields are in `prompts/committer-paranoia.md`.
