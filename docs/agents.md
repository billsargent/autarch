# How villagers remember

Each villager keeps what it knows in a few places, each with one job. The town charter
(`docs/town-charter.md`) says what villagers may do; this page says where their memory lives.
Agreed by the owner on 2026-10-24 (#66, #67).

| What | Where | Written by | Read |
| --- | --- | --- | --- |
| **What I'm working on, and where it stands** | **Goals**, each with **notes** | The villager, with `manage_goal` (`addNote` adds a dated line) | In every work window, in the prompt (the latest notes of each goal); in full with `list_goals`; by the owner on the notice board |
| **How to do things** | **Skills**: markdown playbooks in `<workspace>/skills/` | The villager (or the owner, in the library) | In every session, in the prompt |
| **What happened** | The **diary** (journal) | Automatically, after every session that did something: which tools ran, how it ended, what it cost. The villager can still add its own entries (`update_journal`) and notes about neighbours (`note_about`). | By the owner (cottages, and the bookshelves at home); the villager reads its own |
| **What was said earlier in a long conversation** | **Conversation summaries** | Automatically, when a conversation grows past the context budget | In that conversation's turns |
| **Telling the owner something** | **`message_owner`** | The villager | Left in the conversation; with severity success, warning or critical also a letter in the mailbox |

## What changed

- **Goal notes replace `notes/plan.md` (#68).** A free-form plan file was easy to forget and
  invisible to the owner. Notes live on the goal they belong to, show up in the prompt, and can
  be read on the notice board. An old `plan.md` is moved once into the notes of an
  "Ongoing work" goal and renamed `plan.md.imported` (#71).
- **The diary writes itself (#69).** Villagers often forgot to journal. Now every work window,
  and every chat that used tools, gets a short entry with no model call. Talk-only turns
  (answering a neighbour, meetings, votes, interviews, reviews) and approval follow-ups don't.
- **One messaging tool (#70).** `notify_human` and `post_message` overlapped. `message_owner`
  replaces both: severity `info` (the default) just leaves a message in the conversation, and
  anything louder also rings the bell. Tool lists that named the old tools now name the new one.
  The old names still work for calls already in flight.
- **Summaries** are unchanged, apart from now being incremental and counted in the turn's cost
  (#30, #31).

In the village, all of this is per villager: their own goals and notes (plus the town's goals),
their own diary, and the shared skills.
