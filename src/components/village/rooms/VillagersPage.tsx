"use client";

import { useState } from "react";
import type { AgentRow, SettingsRow } from "@/lib/agent/clientTypes";
import { DEFAULT_PERSONA, personaToSave } from "@/lib/agent/persona";
import { CHARACTER_KEYS, CHARACTER_LABELS, VILLAGER_COLORS } from "@/lib/agent/villagerLooks";
import { tierAllows, type Tier } from "@/lib/agent/mayorTools";
import { useVillagers, type VillagerInput } from "../../data/useVillagers";
import { ConfirmDialog } from "../ParchmentDialog";
import VillagerPortrait from "../VillagerPortrait";

// The Mayor's ledger → Villagers: who lives in the village, what each may do
// and spend, and adding, pausing or dismissing them (#55, #60). The owner's
// alone: the villagers can't change any of this.

const input = "mt-1 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1.5 text-sm font-normal outline-none";
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

// "Mayor", "Director · garden", "Worker for Gus" (#99).
export function rankOf(v: AgentRow, byId: (id: number | null) => AgentRow | undefined): string {
  if (v.isMayor) return "Mayor";
  if (v.tier === "worker") return `Worker${byId(v.managerId) ? ` for ${byId(v.managerId)!.name}` : ""}${v.area ? ` · ${v.area}` : ""}`;
  return `Director${v.area ? ` · ${v.area}` : ""}`;
}

function doing(v: AgentRow, villagePaused: boolean): string {
  if (v.status === "paused") return v.pausedBy === "mayor" ? "Resting (paused by the Mayor)" : "Resting (paused)";
  if (villagePaused) return "Asleep (village paused)";
  if (v.waiting) return `Waiting on you (${v.waiting})`;
  if (v.working) return "Working";
  return "Free";
}

export default function VillagersPage({ settings, tools }: { settings: SettingsRow; tools: Array<{ name: string; description: string }> }) {
  const { villagers, loaded, add, update, dismiss } = useVillagers();
  const [editing, setEditing] = useState<AgentRow | "new" | null>(null);
  const [leaving, setLeaving] = useState<AgentRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (leaving) {
    return (
      <ConfirmDialog
        title={`Say goodbye to ${leaving.name}?`}
        message={
          <>
            {leaving.name} leaves the village: their jobs stop and nobody can talk to them any more. Their conversations,
            diary and spending stay on record. This can&apos;t be undone.
          </>
        }
        confirmLabel={`Dismiss ${leaving.name}`}
        onConfirm={async () => {
          const res = await dismiss(leaving.id);
          setError(res.ok ? null : res.error);
          setLeaving(null);
        }}
        onCancel={() => setLeaving(null)}
      />
    );
  }

  if (editing) {
    return (
      <VillagerEditor
        villager={editing === "new" ? null : editing}
        villagers={villagers}
        settings={settings}
        tools={tools}
        onCancel={() => setEditing(null)}
        onSave={async (patch) => {
          const res = editing === "new" ? await add(patch) : await update(editing.id, patch);
          if (res.ok) setEditing(null);
          return res;
        }}
      />
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="village-pixel text-sm">Villagers</h3>
        <p className="mt-0.5 text-xs text-[#6b4a2e]">
          Everyone living in the village. Each has their own personality, look, model, tools and budget, and their own
          cottage, diary and conversations. Only you can add, change, pause or dismiss them.
        </p>
      </div>
      {!loaded && <p className="text-sm">Counting heads…</p>}
      <ul className="space-y-2">
        {villagers.map((v) => {
          const budget = v.dailyBudgetUsd;
          const share = budget ? Math.min(100, (v.spentToday / budget) * 100) : 0;
          return (
            <li key={v.id} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-3">
              <div className="flex flex-wrap items-center gap-3">
                <VillagerPortrait character={v.character} color={v.color} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="village-pixel text-sm">
                    {v.name} <span className="font-sans text-xs font-normal text-[#6b4a2e]">· {v.role}</span>
                  </p>
                  <p className="text-[11px] font-semibold text-[#8a5a2b]">
                    {v.tier === "worker" && <span aria-hidden>🦺 </span>}
                    {rankOf(v, (id) => villagers.find((x) => x.id === id))}
                  </p>
                  <p className="text-xs text-[#6b4a2e]">{doing(v, settings.paused)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setEditing(v)} className="village-btn px-2 py-1 text-[11px]">
                    ✎ Edit
                  </button>
                  <button
                    onClick={async () => {
                      const res = await update(v.id, { status: v.status === "paused" ? "active" : "paused" });
                      setError(res.ok ? null : res.error);
                    }}
                    className={`village-btn px-2 py-1 text-[11px] ${v.status === "paused" ? "village-btn-go" : ""}`}
                  >
                    {v.status === "paused" ? "▶ Let them work" : "⏸ Pause"}
                  </button>
                  <button
                    onClick={async () => {
                      const res = await update(v.id, { daydream: !v.daydream });
                      setError(res.ok ? null : res.error);
                    }}
                    aria-pressed={Boolean(v.daydream)}
                    title="A few minutes every four hours, on their own budget, to explore and pin an idea for the village"
                    className={`village-btn px-2 py-1 text-[11px] ${v.daydream ? "village-btn-go" : ""}`}
                  >
                    💭 Free time {v.daydream ? "on" : "off"}
                  </button>
                  {!v.isMayor && (
                    <button onClick={() => setLeaving(v)} className="village-btn village-btn-danger px-2 py-1 text-[11px]">
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 text-[11px] text-[#6b4a2e]">
                Spent today: <strong>{usd(v.spentToday)}</strong>
                {budget != null ? ` of ${usd(budget)}` : " (no budget of their own)"}
                {budget != null && (
                  <div className="mt-1 h-2 overflow-hidden rounded-sm border border-[#3b2716] bg-[#e8dcc2]" role="meter" aria-label={`${v.name}'s budget used`} aria-valuenow={Math.round(share)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full" style={{ width: `${share}%`, background: share >= 100 ? "#b3261e" : share > 75 ? "#c58a1b" : "#5f8a3c" }} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-xs text-[#b3261e]">{error}</p>}
      <button onClick={() => setEditing("new")} className="village-btn village-btn-primary px-3 py-2 text-xs">
        + Welcome a new villager
      </button>
    </section>
  );
}

function VillagerEditor({
  villager,
  villagers,
  settings,
  tools,
  onSave,
  onCancel,
}: {
  villager: AgentRow | null;
  villagers: AgentRow[];
  settings: SettingsRow;
  tools: Array<{ name: string; description: string }>;
  onSave: (patch: VillagerInput) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel: () => void;
}) {
  const [tier, setTier] = useState<"director" | "worker">(villager?.tier === "worker" ? "worker" : "director");
  const [area, setArea] = useState(villager?.area ?? "");
  const [managerId, setManagerId] = useState<number | null>(villager?.managerId ?? null);
  const rank: Tier = villager?.isMayor ? "mayor" : tier;
  // The Mayor's own tools are only ever his (#58), and workers can't hire (#99).
  const townTools = tools.filter((t) => settings.enabledTools.includes(t.name) && tierAllows(rank, t.name));
  const managers = villagers.filter((v) => v.id !== villager?.id && (v.isMayor || v.tier === "director"));
  const [name, setName] = useState(villager?.name ?? "");
  const [role, setRole] = useState(villager?.role ?? "Villager");
  // Starts with the default personality written out, ready to edit.
  const [persona, setPersona] = useState(villager?.persona ?? DEFAULT_PERSONA);
  const [character, setCharacter] = useState(villager?.character ?? CHARACTER_KEYS.find((c) => c !== "master") ?? "villager");
  const [color, setColor] = useState(villager?.color ?? VILLAGER_COLORS[1]);
  const [model, setModel] = useState(villager?.model ?? "");
  const [allTools, setAllTools] = useState(villager?.enabledTools == null);
  const [ownTools, setOwnTools] = useState<string[]>(villager?.enabledTools ?? townTools.map((t) => t.name));
  const [budget, setBudget] = useState(villager?.dailyBudgetUsd != null ? String(villager.dailyBudgetUsd) : "");
  const [perHour, setPerHour] = useState(villager?.maxActionsPerHour != null ? String(villager.maxActionsPerHour) : "");
  const [error, setError] = useState<{ field: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const fieldError = (f: string) =>
    error?.field === f ? (
      <span role="alert" className="mt-1 block text-[11px] font-semibold text-[#b3261e]">
        {error.text}
      </span>
    ) : null;

  async function save() {
    setSaving(true);
    setError(null);
    const res = await onSave({
      name,
      role,
      persona: personaToSave(persona),
      character,
      color,
      model: model.trim() || null,
      enabledTools: allTools ? null : ownTools.filter((t) => tierAllows(rank, t)),
      ...(villager?.isMayor ? {} : { tier, area: area.trim() || null, managerId: tier === "worker" ? managerId : null }),
      dailyBudgetUsd: budget.trim() === "" ? null : Number(budget),
      maxActionsPerHour: perHour.trim() === "" ? null : Number(perHour),
    });
    if (!res.ok) {
      const m = /^(\w+): (.*)$/.exec(res.error);
      setError(m ? { field: m[1], text: m[2] } : { field: "", text: res.error });
    }
    setSaving(false);
  }

  return (
    <section className="space-y-3">
      <h3 className="village-pixel text-sm">{villager ? `${villager.name}'s details` : "Welcome a new villager"}</h3>
      <div className="flex items-center gap-3 rounded border-2 border-dashed border-[#c9b27a] p-3">
        <VillagerPortrait character={character} color={color} size={48} />
        <p className="text-sm">
          <span className="village-pixel">{name || "Someone new"}</span>
          <span className="block text-xs text-[#6b4a2e]">{role || "Villager"}</span>
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">
          Name
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} data-autofocus className={input} />
          {fieldError("name")}
        </label>
        <label className="block text-xs font-semibold">
          Role in the village
          <input name="role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Librarian, Fisherman, Night watch" className={input} />
          {fieldError("role")}
        </label>
      </div>
      {!villager?.isMayor && (
        <div className="grid gap-3 rounded border-2 border-[#d8c49a] p-3 sm:grid-cols-3">
          <fieldset>
            <legend className="text-xs font-semibold">Rank</legend>
            <div className="mt-1 flex gap-1.5" role="radiogroup" aria-label="Rank">
              {(["director", "worker"] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={tier === t} onClick={() => setTier(t)} className={`village-btn px-2.5 py-1 text-[11px] ${tier === t ? "village-btn-go" : ""}`}>
                  {t === "director" ? "Director" : "🦺 Worker"}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-[11px] text-[#6b4a2e]">{tier === "director" ? "Runs an area, and may draft hires." : "Works for a director; can't hire."}</span>
          </fieldset>
          <label className="block text-xs font-semibold">
            Area
            <input name="area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. inbox, garden, money" className={input} />
            {fieldError("area")}
          </label>
          {tier === "worker" && (
            <label className="block text-xs font-semibold">
              Works for
              <select name="managerId" value={managerId ?? ""} onChange={(e) => setManagerId(e.target.value ? Number(e.target.value) : null)} className={input}>
                <option value="">Nobody in particular</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.isMayor ? "Mayor" : m.role})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <label className="block text-xs font-semibold">
        Personality
        <textarea name="persona" value={persona} onChange={(e) => setPersona(e.target.value)} rows={4} className={`${input} resize-y`} />
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 font-normal text-[11px] text-[#6b4a2e]">
          Who they are, in your words — edit or add to the default.
          {persona.trim() !== DEFAULT_PERSONA && (
            <button type="button" onClick={() => setPersona(DEFAULT_PERSONA)} className="underline">
              Start again from the default
            </button>
          )}
        </span>
        {fieldError("persona")}
      </label>
      <fieldset>
        <legend className="text-xs font-semibold">Look</legend>
        <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Look">
          {CHARACTER_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={character === k}
              aria-label={CHARACTER_LABELS[k]}
              title={CHARACTER_LABELS[k]}
              onClick={() => setCharacter(k)}
              className={`rounded p-1 ${character === k ? "bg-[#e3b04b]" : "hover:bg-[#ead9b4]"}`}
            >
              <VillagerPortrait character={k} color={character === k ? color : undefined} size={32} />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-xs font-semibold">Colour</legend>
        <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
          {VILLAGER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-sm border-2 ${color === c ? "border-[#3b2716] ring-2 ring-[#e3b04b]" : "border-[#3b2716]/40"}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </fieldset>
      <label className="block text-xs font-semibold">
        Model
        <input name="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={`The town's (${settings.modelName})`} className={input} />
        {fieldError("model")}
      </label>
      <fieldset>
        <legend className="text-xs font-semibold">Tools</legend>
        <label className="mt-1 flex items-center gap-2 text-xs">
          <input type="checkbox" name="allTools" checked={allTools} onChange={(e) => setAllTools(e.target.checked)} />
          Everything the town allows ({townTools.length} tools)
        </label>
        {!allTools && (
          <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
            {townTools.map((t) => (
              <li key={t.name}>
                <label className="flex items-center gap-2 text-xs" title={t.description}>
                  <input
                    type="checkbox"
                    name={`tool-${t.name}`}
                    checked={ownTools.includes(t.name)}
                    onChange={(e) => setOwnTools((cur) => (e.target.checked ? [...cur, t.name] : cur.filter((x) => x !== t.name)))}
                  />
                  <span className="font-mono">{t.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <span className="mt-0.5 block text-[11px] text-[#6b4a2e]">A villager never gets more than the town&apos;s tool policy (Tools page).</span>
        {fieldError("enabledTools")}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">
          Daily budget (USD)
          <input name="dailyBudgetUsd" type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No budget of their own" className={input} />
          {fieldError("dailyBudgetUsd")}
        </label>
        <label className="block text-xs font-semibold">
          Actions per hour
          <input name="maxActionsPerHour" type="number" min={1} value={perHour} onChange={(e) => setPerHour(e.target.value)} placeholder={`The town's (${settings.maxActionsPerHour})`} className={input} />
          {fieldError("maxActionsPerHour")}
        </label>
      </div>
      {error && !["name", "role", "persona", "model", "enabledTools", "dailyBudgetUsd", "maxActionsPerHour", "area"].includes(error.field) && (
        <p className="text-xs text-[#b3261e]">{error.text}</p>
      )}
      <div className="flex gap-2">
        <button onClick={() => void save()} disabled={saving || !name.trim()} className="village-btn village-btn-primary px-4 py-2 text-xs">
          {saving ? "Saving…" : villager ? "Save changes" : `Welcome ${name.trim() || "them"}`}
        </button>
        <button onClick={onCancel} className="village-btn px-3 py-2 text-xs">
          Cancel
        </button>
      </div>
    </section>
  );
}
