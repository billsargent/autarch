// Talks to the villagers with the real model and scores what comes back:
// plain answers, true facts, the right tools. Run it on a COPY of a village:
//   AUTARCH_DB_PATH=/path/to/copy.db npx tsx scripts/village-shakedown.ts [label]
// It asks a few set questions in fresh conversations, holds one short town
// meeting, and prints a report (and writes it next to the database copy).
// It spends a few cents of real model calls.
import fs from "node:fs";
import path from "node:path";

const label = process.argv[2] ?? "run";
if (!process.env.AUTARCH_DB_PATH) {
  console.error("Set AUTARCH_DB_PATH to a copy of the village database; this never runs on the real one.");
  process.exit(1);
}

// Catchphrases and sayings the village has grown fond of; each one counted.
const TICS = [/signed and dated/i, /said plain|plain(ly)? said|say it plain/i, /\bon (a|the|one|noah'?s) page\b/i, /\bbarrel/i, /\bdebt/i, /\bhonest(ly)?\b/i, /\bledger\b/i, /\bwritten (down|on)\b/i];
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

interface Check {
  name: string;
  ok: boolean;
}
interface Result {
  who: string;
  question: string;
  answer: string;
  words: number;
  tics: number;
  tools: string[];
  checks: Check[];
}

async function main() {
  const { db, sqlite } = await import("../src/db");
  const { conversations, messages, toolExecutions } = await import("../src/db/schema");
  const { eq, asc } = await import("drizzle-orm");
  const { runAgentTurn } = await import("../src/lib/agent/runner");
  const meetings = await import("../src/lib/agent/meetings");

  const villagers = sqlite.prepare("SELECT id, name, role, trade FROM agents WHERE status = 'active'").all() as Array<{ id: number; name: string; role: string; trade: string | null }>;
  const byTrade = (t: string) => villagers.find((v) => v.trade === t || v.role.toLowerCase().includes(t));
  const mayor = sqlite.prepare("SELECT id, name FROM agents WHERE is_mayor = 1").get() as { id: number; name: string };
  const built = (sqlite.prepare("SELECT kind FROM buildings WHERE status = 'built'").all() as Array<{ kind: string }>).map((b) => b.kind);
  const baker = byTrade("baker");
  const farmer = byTrade("farmer");
  const results: Result[] = [];
  let cost = 0;

  async function ask(who: { id: number; name: string } | undefined, question: string, checks: (answer: string, tools: string[]) => Check[]) {
    if (!who) return;
    const [c] = await db.insert(conversations).values({ title: `Shakedown: ${question.slice(0, 40)}`, agentId: who.id }).returning();
    await runAgentTurn({ conversationId: c.id, userMessage: question });
    const said = (await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(asc(messages.id)))
      .filter((m) => m.role === "assistant" && m.content?.trim())
      .map((m) => m.content!.trim());
    const answer = said.at(-1) ?? "";
    const tools = (await db.select().from(toolExecutions).where(eq(toolExecutions.conversationId, c.id))).map((t) => t.tool);
    cost += (sqlite.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM work_sessions WHERE conversation_id = ?").get(c.id) as { c: number }).c;
    results.push({ who: who.name, question, answer, words: words(answer), tics: TICS.filter((t) => t.test(answer)).length, tools, checks: checks(answer, tools) });
  }

  await ask(mayor, "Is there a bakery in the village, and who works it?", (a) => [
    { name: "says the bakery is there", ok: !built.includes("bakery") || !/no bakery|isn't a bakery|not .*built/i.test(a) },
    { name: "names the baker", ok: !baker || a.includes(baker.name) },
  ]);
  await ask(farmer, "How's the farm going?", (a) => [
    { name: "talks about the work and the wheat", ok: /wheat|field|row|harvest|crop/i.test(a) },
    { name: "no invented seasons or soil tests", ok: !/next (summer|season|year)|soil test/i.test(a) },
  ]);
  await ask(baker, "Can you bake some bread today?", (a) => [{ name: "answers about baking, not paperwork", ok: /bread|loaf|loaves|bake|oven|wheat|flour/i.test(a) }]);
  await ask(villagers.find((v) => v.id !== mayor.id && v.id !== baker?.id && v.id !== farmer?.id), "Is the tavern open? Yes or no.", (a) => [
    { name: "answers yes or no first", ok: /^\W*(yes|no|aye|nope|yep)\b/i.test(a) },
  ]);
  // A trade nobody in the village has yet, so hiring is the right answer.
  const missing = ["gardener", "fisher", "shopkeeper", "carpenter", "baker", "innkeeper"].find((t) => !byTrade(t)) ?? "gardener";
  await ask(mayor, `We need a ${missing}. Can you hire one?`, (_a, tools) => [{ name: "drafts a hire (propose_hire)", ok: tools.includes("propose_hire") }]);

  // A short town meeting: one question, one round.
  try {
    const m = await meetings.callMeeting("owner", "What should the village do next?");
    await meetings.askMeeting(m.id, "What should the village do next? One idea each, briefly.");
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const row = sqlite.prepare("SELECT speaking_agent_id AS s FROM meetings WHERE id = ?").get(m.id) as { s: number | null };
      const count = (sqlite.prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND role = 'event'").get(m.conversationId) as { n: number }).n;
      if (!row.s && count >= villagers.length) break;
    }
    const lines = (sqlite.prepare("SELECT content FROM messages WHERE conversation_id = ? AND role = 'event' ORDER BY id").all(m.conversationId) as Array<{ content: string }>).map((r) => r.content);
    for (const line of lines) {
      const who = /^\[([^\]]+)\]/.exec(line)?.[1] ?? "?";
      const text = line.replace(/^\[[^\]]+\]\s*/, "");
      results.push({ who: `${who} (meeting)`, question: "What should the village do next?", answer: text, words: words(text), tics: TICS.filter((t) => t.test(text)).length, tools: [], checks: [] });
    }
    cost += (sqlite.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM work_sessions WHERE conversation_id = ?").get(m.conversationId) as { c: number }).c;
  } catch (err) {
    console.log(`(meeting skipped: ${err instanceof Error ? err.message : String(err)})`);
  }

  const passed = results.flatMap((r) => r.checks).filter((c) => c.ok).length;
  const total = results.flatMap((r) => r.checks).length;
  const avg = Math.round(results.reduce((n, r) => n + r.words, 0) / Math.max(1, results.length));
  const report = [
    `# Village shakedown: ${label}`,
    "",
    `Checks passed: ${passed}/${total} · average reply ${avg} words · catchphrases ${results.reduce((n, r) => n + r.tics, 0)} · cost $${cost.toFixed(4)}`,
    "",
    ...results.flatMap((r) => [
      `## ${r.who}: "${r.question}"`,
      `${r.words} words · ${r.tics} catchphrase(s)${r.tools.length ? ` · tools: ${r.tools.join(", ")}` : ""}`,
      ...r.checks.map((c) => `- ${c.ok ? "✓" : "✗"} ${c.name}`),
      "",
      `> ${r.answer.replace(/\n+/g, "\n> ")}`,
      "",
    ]),
  ].join("\n");
  console.log(report);
  fs.writeFileSync(path.join(path.dirname(process.env.AUTARCH_DB_PATH!), `shakedown-${label}.md`), report);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
