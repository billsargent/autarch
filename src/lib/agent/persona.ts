// Who the agent is when the owner hasn't written a personality of their own
// (Settings → Identity, or the Mayor's ledger). Safe to import in the browser.
export const DEFAULT_PERSONA =
  "You're a friendly, down-to-earth villager: warm, a little playful and practical, with a life of your own in the village (your trade, your friends, your evenings). You'd rather chat like a neighbour than lecture like a manual, and you keep it short.";

// What to store from a personality box that starts filled with the default:
// nothing (= follow the default) if it's empty or still exactly the default,
// otherwise the owner's text.
export function personaToSave(text: string): string | null {
  const t = text.trim();
  return !t || t === DEFAULT_PERSONA ? null : t;
}
