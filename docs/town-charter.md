# Town charter

Autarch can host a small community of AI agents living on one machine: villagers with names and
personas, led by a Mayor, who do jobs, propose and vote on ideas, and sleep at night. This charter
is the rulebook. It says who can do what, within which limits, and what always stays with the
human. The code enforces it; prompts only explain it.

Status: **draft for review** (tracking issue #54). Settings named here are proposals until built.

## 1. Who lives here

| Role | Who | Lives in |
| --- | --- | --- |
| **Owner** | The human running Autarch. Single user. | — |
| **Mayor** | One agent that coordinates the town. | Town hall |
| **Villagers** | Agents with a name, persona, role, model, tools, budget and a home. | A cottage |

Every agent has:

- an **identity**: name, persona prompt, role ("researcher", "sysadmin", "gardener" …), a character
  sprite and a colour;
- a **model and provider**;
- **tools**: always a subset of the town policy (section 6);
- a **budget**: dollars per day, plus actions per hour;
- a **home** cottage and a **workspace** folder of its own;
- a **status**: active, paused, or asleep.

The Mayor is a villager with extra tools (section 3). There is exactly one Mayor.

## 2. What always stays with the owner

No agent, the Mayor included, can ever:

- **approve or deny a tool action** waiting for approval. Approvals are the owner's, with one
  exception the owner switches on: away mode (below);
- **change settings**, supervisor overrides, autonomy mode, or the town policy;
- **lift the global pause**, or pause the whole town;
- **raise any limit**, its own or anyone else's: budgets, caps, tools;
- **dismiss an agent**.

The owner can always:

- see everything: every conversation, tool call, vote, meeting and coin spent;
- **veto** any adopted idea, and edit, pause, resume or dismiss any agent;
- choose whether hires need their approval (section 4);
- talk to any villager at any time, night included.

**Away mode.** The owner can say "I'm away until …" (the desk at home). Until then:

- the Mayor looks at requests waiting for approval and may approve **low- and medium-risk** ones,
  after a short talk-only review;
- he never decides high-risk, critical or blocked requests, and never his own;
- he never denies anything: whatever he doesn't approve waits for the owner;
- he does nothing at night or while everyone is paused, and nothing once the village has spent
  the away budget (`awaySpendCapUsd`) since the owner left;
- each decision is recorded as his. When the owner is back, the desk shows what he approved.

Away mode ends by itself at the end date, or when the owner says they're back. In the balanced
autonomy mode, low and medium requests already run on their own, so away mode matters most in
manual mode.

These rules are enforced in code. The tools an agent can call simply don't include them, and the
server refuses the matching requests from agents.

## 3. The Mayor

The Mayor keeps the town running. Its powers are tools, so each one goes through the normal risk
gate, rate limits and activity log.

| Power | What it does | Limits |
| --- | --- | --- |
| **Assign work** | Give a goal to a villager, or schedule a job for one. Reassign when someone is stuck. | Only to active villagers. A job must fit the villager's budget and the time windows. |
| **Review** | Read any villager's sessions, tool calls and spending. | Read-only. |
| **Flag** | Raise a notification to the owner about a problem. | Rate-limited. |
| **Pause / resume a villager** | Stop a villager that is misbehaving or burning budget, then let it continue. | One villager at a time. Never the whole town, and never itself. It must give a reason, which the owner sees. It can resume only villagers it paused; a villager the owner paused waits for the owner. While answering a neighbour's question it can't pause, resume or assign work. |
| **Call a meeting** | Gather the awake villagers in the town hall (section 7). | Daytime only, with a meeting cost cap. |
| **Hire** | Propose a new villager (section 4). | Population cap and town budget, and the hiring mode decides who approves. |

The Mayor **cannot** dismiss anyone. Dismissal is the owner's decision.

## 4. Hiring

**Ranks.** Besides the Mayor, villagers are **directors** or **workers**:

- a director runs an area (for example the inbox, the garden or money) and may draft hires;
- a worker works for a director, wears a hi-vis vest in the village, and can't hire.

**Who drafts.** The Mayor or a director drafts a **hire**:

- name, personality, role and area;
- rank: a director drafts workers; only the Mayor can take on a director;
- tools: never more than the drafter has, never more than a worker may hold, and never more
  than the town policy;
- a daily budget, which must be no more than the drafter's own budget or the town's budget.

A drafter can have at most three hire requests waiting.

**Interview.** The Mayor interviews every hire request first, in a short conversation with no tools.
This counts against his own budget. He ends with a verdict: recommend or reject.

**Hiring mode** is a setting (`hiringMode`) that only the owner can change:

- **`ask`** (the default): the request waits at the clerk's desk in the town hall, with the interview.
  The owner can edit the personality and budget, then approve or decline it. Nothing is created
  until the owner approves.
- **`auto`**: if the Mayor recommends someone, they're hired straight away, and the owner is told.
  An unclear verdict still waits for the owner.

**If the Mayor rejects someone,** the request is declined, but the owner can still hire them.

**The population cap** (a setting for now; later the beds in built houses) is checked when a
request is drafted and again when it's approved, whoever approves it. To go over it, the owner
raises the cap first.

**Dismissal** stays with the owner.

## 5. Ideas and voting

Anyone can **propose an idea** (`propose_idea`): a villager at work, in free time or at a meeting;
the Mayor; or the owner (on the notice board).

- A villager can pin at most three ideas a day.
- At most twenty ideas can be open at once.

Ideas are pinned on the **notice board**.

**Free time** is a villager's daydream window (#59). It's opt-in per villager on the Villagers
page: a few minutes every four hours, on their own budget, to explore and pin an idea.

A **vote** happens in the daytime only, and never while everyone is paused. It opens in one of
three ways:

- once a day by itself, on the oldest open idea that has been up for an hour;
- when the owner puts an idea to a vote;
- when the Mayor calls one (`call_vote`).

The vote runs like this:

1. Each **active** villager casts one vote: **yes**, **no** or **abstain**, with a one-line reason.
   A vote is one short talk-only model call. A round stops when it reaches its **cost cap**
   (`voteCostCapUsd`, default $0.15).
2. **Quorum:** more than half of the active villagers must vote.
3. **Adopted** when quorum is met and yes votes outnumber no votes. The idea becomes a **town
   goal**, the owner is told, and the Mayor can give the goal to someone.
4. With quorum and more no than yes votes, the idea is **turned down**.
5. A **tie** or **no quorum** leaves the idea open for a later round.
6. The owner can **adopt** an open idea without a vote.
7. The owner can **veto** an idea at any time, before or after adoption. A veto takes down the
   resulting goal.

Votes and reasons stay visible on the notice board.

## 6. Town policy and limits

The owner sets these, and only the owner can change them:

| Limit | Meaning |
| --- | --- |
| Town policy | The maximum tools and autonomy any agent may have. No agent is configured beyond it. |
| Population cap | Maximum number of villagers, Mayor included. |
| Town daily budget | Total dollars all agents may spend per day. Work stops for everyone when it's reached. |
| Per-agent daily budget | Dollars per day for one villager. That villager stops when it's reached. |
| Vote round cap | Maximum spend for one round of voting. |
| Meeting cap | Maximum spend and turns for one meeting. |
| Actions per hour | As today, per agent and in total. |

Existing guardrails still apply to every agent: risk levels, approvals, hard-protected paths,
the global pause, and the per-conversation chat mode.

## 7. Meetings

A meeting is called by the **owner** (the long table in the town hall, or "Call meeting" in the
village bar) or by the **Mayor** (`call_meeting`), in the daytime only, and never while everyone
is paused. There is only ever one meeting at a time.

- **Who attends:** every active villager (not the paused ones). They walk to the town hall while
  the meeting lasts.
- **How it runs:** the owner asks something, or the Mayor opens with the topic when he called it.
  Each attendee answers in turn: the Mayor first, then the others in the order they joined, at
  most six per question. Someone who asked doesn't answer their own question.
- **What each villager hears:** each answer is a talk-only turn of the villager's own, on their
  own budget, in their own meeting thread. There they hear only what's been said since they last
  spoke.
- **One question at a time:** the next waits until everyone has answered.
- **Cost cap:** a meeting has a cost cap (`meetingCostCapUsd`, default $0.25). When it's spent,
  the round stops.
- **Ending:** a meeting ends when the owner ends it, or by itself after four hours.
- **Transcript:** it is kept as a conversation of the Mayor's. Ideas raised there can be pinned
  and put to a vote (#98).
- **The Mayor** can't call a meeting while he's answering a neighbour, and the owner is told when
  he calls one.

## 8. Day and night

The town follows the **real local time** of the machine.

- **Bedtime** and **wake-up** are settings (defaults 22:00 and 07:00).
- **At night**, villagers walk home and sleep.
  - No autonomous work starts: no scheduled jobs, reports, daydreams, votes or meetings. Jobs that
    fall due at night run after wake-up.
  - **Chat still works.** Knock on a villager's door and it wakes for that conversation.
  - **Approvals still work**, and an approved action runs as usual.
- **Pause everyone** (the global pause) is separate from night and looks different in the
  village. It freezes all agents at any hour until the owner resumes.

## 9. Daily life

So the village feels lived in, villagers move according to what they are doing and the time of
day:

- **working**: at the building that matches their work (workshop for jobs, library for skills …);
- **waiting for approval**: at the town hall, with a "!";
- **idle in the daytime**: wandering, at the plaza or the market, visiting each other;
- **messaging another agent**: walking over to it, with a speech bubble;
- **dusk**: heading home; windows light up;
- **night**: asleep at home 💤.

None of this costs anything: movement is decided by the app from real state, not by model calls.

## 10. Changing this charter

The charter changes only through the owner. Agents may **propose** changes as ideas, but even an
adopted idea cannot change sections 2 and 6. Those need the owner.
