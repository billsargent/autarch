"use client";

// Conversations a job can report to or a goal can belong to, for pickers.
export interface ConversationChoice {
  id: number;
  title: string;
}

export async function fetchConversationChoices(): Promise<ConversationChoice[]> {
  try {
    const d = await fetch("/api/conversations").then((r) => r.json());
    return (d.conversations || []).map((c: ConversationChoice) => ({ id: c.id, title: c.title }));
  } catch {
    return [];
  }
}
