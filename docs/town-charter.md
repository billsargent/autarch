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

- **approve or deny a tool action** waiting for approval. Approvals are human-only;
- **change settings**, supervisor overrides, autonomy mode, or the town policy;
- **lift the global pause**, or pause the whole town;
- **raise any limit**, its own or anyone else's: budgets, caps, tools;
- **dismiss an agent**.

The owner can always:

- see everything: every conversation, tool call, vote, meeting and coin spent;
- **veto** any adopted idea, and edit, pause, resume or dismiss any agent;
- choose whether hires need their approval (section 4);
- talk to any villager at any time, night included.

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

The Mayor (or the owner) drafts a **hire**:

- name, persona and role;
- model and provider;
- tools, chosen from the town policy and never more;
- a daily budget, which must fit the town budget;
- a home and a character sprite.

**Hiring mode** is a setting (`hiringMode`):

- **`ask`** (default): the draft appears in the town hall as a **hire request**. The owner can
  edit it, approve it, or turn it down. Nothing is created until approved.
- **`auto`**: the Mayor may hire on its own, as long as the town stays under the **population
  cap** and the **town daily budget**. The owner is notified of every hire and can dismiss the new
  villager at any time.

In both modes a hire that would break a cap is refused.

## 5. Ideas and voting

Anyone can **propose an idea**: a villager during daytime work or a daydream, the Mayor, or the
owner. Ideas are pinned on the **notice board**.

A **vote** opens in the daytime, either on a schedule or when the Mayor calls a meeting.

1. Each **awake, active** villager casts one vote: **yes**, **no** or **abstain**, with a one-line
   reason. A vote is one short model call, and a round has a **cost cap**.
2. **Quorum:** more than half of the active villagers must vote.
3. **Adopted** when quorum is met and yes votes outnumber no votes. The idea becomes a **goal**,
   and the Mayor assigns it.
4. A **tie** or **no quorum** leaves the idea open for a later round.
5. The owner can **veto** an idea at any time, before or after adoption. A veto cancels the
   resulting goal and any jobs created for it.

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

A meeting is called by the **Mayor** or the **owner**, in the daytime.

- All awake villagers walk to the town hall and take seats.
- The Mayor moderates and picks who speaks next. Everyone else speaks only when picked, which
  keeps the cost bounded.
- A meeting ends on the Mayor's call, the owner's call, or when it hits its turn or cost cap.
- The transcript is saved as a conversation. Ideas raised there can be pinned and put to a vote.

The owner can take the head of the table and speak to everyone, or open a private side thread
with one villager.

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
