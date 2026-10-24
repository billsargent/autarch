"use client";

import { useCallback, useEffect, useState } from "react";

// The Mayor's ledger → Providers (#61): the town's own model provider (set on
// Identity & model) and any others, their keys (write-only), the models they
// offer, and prices per model.

export interface ProviderInfo {
  id: number;
  name: string;
  kind: "deepseek" | "openai" | "anthropic";
  baseUrl: string;
  keySet: boolean;
}
interface Price {
  id: number;
  providerId: number;
  model: string;
  input: number;
  output: number;
  cacheHit: number | null;
}
interface State {
  town: { name: string; kind: string; baseUrl: string | null; model: string; keySet: boolean };
  providers: ProviderInfo[];
  prices: Price[];
}

const KIND_LABEL = { deepseek: "DeepSeek", openai: "OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio…)", anthropic: "Anthropic" };
const input = "mt-1 w-full rounded border-2 border-[#3b2716] bg-[#fffaf0] px-2 py-1 text-xs font-normal outline-none";

export function useProviders() {
  const [state, setState] = useState<State | null>(null);
  const reload = useCallback(async () => {
    try {
      setState(await fetch("/api/providers", { cache: "no-store" }).then((r) => r.json()));
    } catch {
      /* keep what we have */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(reload, 0);
    return () => clearTimeout(t);
  }, [reload]);
  return { state, reload };
}

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.ok ? null : ((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

export default function ProvidersPage() {
  const { state, reload } = useProviders();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState({ name: "", kind: "openai", baseUrl: "", apiKey: "" });
  const [keys, setKeys] = useState<Record<number, string>>({});
  const [models, setModels] = useState<Record<number, string[] | string>>({});
  const [price, setPrice] = useState({ providerId: 0, model: "", input: "", output: "", cacheHit: "" });

  const run = async (p: Promise<string | null>) => {
    setError(await p);
    await reload();
  };
  const listModels = async (id: number) => {
    setModels((m) => ({ ...m, [id]: "Asking…" }));
    const res = await fetch(`/api/providers/${id}/models`);
    const data = await res.json().catch(() => ({}));
    setModels((m) => ({ ...m, [id]: res.ok ? data.models : data.error ?? "Couldn't list them." }));
  };
  if (!state) return <p className="text-sm">Reading the ledger…</p>;
  const nameOf = (id: number) => (id ? state.providers.find((p) => p.id === id)?.name ?? "?" : "Town");

  const modelList = (id: number) => {
    const m = models[id];
    if (!m) return null;
    return typeof m === "string" ? <p className="mt-1 text-[11px] text-[#6b4a2e]">{m}</p> : <p className="mt-1 max-h-24 overflow-auto font-mono text-[11px]">{m.join(" · ") || "No models listed."}</p>;
  };

  return (
    <section className="space-y-3 text-xs">
      <div>
        <h3 className="village-pixel text-sm">Providers</h3>
        <p className="mt-0.5 text-[#6b4a2e]">
          Where the villagers&apos; thinking comes from. The town&apos;s own provider is set on Identity &amp; model; add others here and
          pick one per villager (Villagers page) or per conversation. Keys are never shown again once saved, and villagers can&apos;t read them.
        </p>
      </div>
      <div className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2.5">
        <p className="font-semibold">The town&apos;s own · {KIND_LABEL[state.town.kind as keyof typeof KIND_LABEL] ?? state.town.kind}</p>
        <p className="text-[11px] text-[#6b4a2e]">
          {state.town.baseUrl || "https://api.deepseek.com"} · model {state.town.model} · {state.town.keySet ? "key set" : "no key"}
        </p>
        <button onClick={() => void listModels(0)} className="village-btn mt-1 px-2 py-0.5 text-[11px]">
          List its models
        </button>
        {modelList(0)}
      </div>
      {state.providers.map((p) => (
        <div key={p.id} className="rounded border-2 border-[#3b2716] bg-[#fffaf0] p-2.5">
          <p className="font-semibold">
            {p.name} · {KIND_LABEL[p.kind]}
          </p>
          <p className="text-[11px] text-[#6b4a2e]">
            {p.baseUrl} · {p.keySet ? "key set" : "no key"}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <input type="password" autoComplete="off" placeholder={p.keySet ? "New key (leave empty to keep)" : "API key"} value={keys[p.id] ?? ""} onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))} className="min-w-0 flex-1 rounded border-2 border-[#3b2716] bg-white px-2 py-0.5" aria-label={`${p.name} key`} />
            <button disabled={!keys[p.id]} onClick={() => void run(send(`/api/providers/${p.id}`, "PATCH", { apiKey: keys[p.id] })).then(() => setKeys((k) => ({ ...k, [p.id]: "" })))} className="village-btn px-2 py-0.5 text-[11px]">
              Save key
            </button>
            <button onClick={() => void listModels(p.id)} className="village-btn px-2 py-0.5 text-[11px]">
              List models
            </button>
            <button onClick={() => void run(send(`/api/providers/${p.id}`, "DELETE"))} className="village-btn village-btn-danger px-2 py-0.5 text-[11px]">
              Remove
            </button>
          </div>
          {modelList(p.id)}
        </div>
      ))}
      <fieldset className="rounded border-2 border-dashed border-[#c9b27a] p-2.5">
        <legend className="font-semibold">Add a provider</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block font-semibold">
            Name
            <input name="providerName" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="e.g. OpenRouter, Ollama, Claude" className={input} />
          </label>
          <label className="block font-semibold">
            Kind
            <select name="providerKind" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })} className={input}>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block font-semibold">
            Address (optional)
            <input name="providerUrl" value={adding.baseUrl} onChange={(e) => setAdding({ ...adding, baseUrl: e.target.value })} placeholder="e.g. http://localhost:11434/v1 for Ollama" className={input} />
          </label>
          <label className="block font-semibold">
            Key (optional for local servers)
            <input name="providerKey" type="password" autoComplete="off" value={adding.apiKey} onChange={(e) => setAdding({ ...adding, apiKey: e.target.value })} className={input} />
          </label>
        </div>
        <button
          disabled={!adding.name.trim()}
          onClick={() => void run(send("/api/providers", "POST", adding)).then(() => setAdding({ name: "", kind: "openai", baseUrl: "", apiKey: "" }))}
          className="village-btn village-btn-primary mt-2 px-3 py-1 text-xs"
        >
          + Add provider
        </button>
      </fieldset>
      <div>
        <p className="font-semibold">Prices per model (USD per million tokens)</p>
        <p className="text-[11px] text-[#6b4a2e]">A model without a price here uses the town&apos;s prices on the Limits page.</p>
        <ul className="mt-1 divide-y-2 divide-[#e6d6b0] rounded border-2 border-[#3b2716] bg-[#fffaf0]">
          {state.prices.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-2 py-1">
              <span className="flex-1 font-mono">
                {nameOf(p.providerId)}/{p.model}
              </span>
              <span>
                in ${p.input} · out ${p.output}
                {p.cacheHit != null ? ` · cached $${p.cacheHit}` : ""}
              </span>
              <button onClick={() => void run(send(`/api/prices?id=${p.id}`, "DELETE"))} className="text-[11px] underline">
                remove
              </button>
            </li>
          ))}
          {state.prices.length === 0 && <li className="px-2 py-1 text-[#6b4a2e]">No prices yet.</li>}
        </ul>
        <div className="mt-1.5 flex flex-wrap items-end gap-1.5">
          <select name="priceProvider" value={price.providerId} onChange={(e) => setPrice({ ...price, providerId: Number(e.target.value) })} className="rounded border-2 border-[#3b2716] bg-white px-1 py-0.5">
            <option value={0}>Town</option>
            {state.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input name="priceModel" placeholder="model" value={price.model} onChange={(e) => setPrice({ ...price, model: e.target.value })} className="w-36 rounded border-2 border-[#3b2716] bg-white px-1 py-0.5" />
          {(["input", "output", "cacheHit"] as const).map((k) => (
            <input key={k} name={`price-${k}`} type="number" step="0.0001" min={0} placeholder={k === "cacheHit" ? "cached in" : k} value={price[k]} onChange={(e) => setPrice({ ...price, [k]: e.target.value })} className="w-20 rounded border-2 border-[#3b2716] bg-white px-1 py-0.5" />
          ))}
          <button
            disabled={!price.model.trim() || price.input === "" || price.output === ""}
            onClick={() =>
              void run(send("/api/prices", "PUT", { providerId: price.providerId, model: price.model, input: Number(price.input), output: Number(price.output), cacheHit: price.cacheHit === "" ? null : Number(price.cacheHit) })).then(() =>
                setPrice({ ...price, model: "", input: "", output: "", cacheHit: "" }),
              )
            }
            className="village-btn px-2 py-0.5 text-[11px]"
          >
            Set price
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-[#b3261e]">{error}</p>}
    </section>
  );
}
