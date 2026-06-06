const BASE = (import.meta.env.VITE_BACKEND_URL as string) || "/api";

export type TripInput = {
  city: string;
  days: number;
  budget_usd: number;
  interests: string[];
  dietary: string[];
};

export type SessionState = {
  session_id: string;
  status: string;
  plan_markdown: string | null;
  awaiting_input: { type: string; [k: string]: unknown } | null;
  city: string;
  days: number;
  budget_usd: number;
  interests: string[];
  dietary: string[];
};

async function jsonReq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function createSession() {
  return jsonReq<{ session_id: string }>("/sessions", { method: "POST" });
}

export async function submitInput(sessionId: string, payload: TripInput) {
  return jsonReq<{ session_id: string; started: boolean }>(
    `/sessions/${sessionId}/input`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function uploadPhoto(sessionId: string, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE}/sessions/${sessionId}/photo`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export async function submitEdit(sessionId: string, text: string) {
  return jsonReq(`/sessions/${sessionId}/edit`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function acceptPlan(sessionId: string) {
  return jsonReq(`/sessions/${sessionId}/accept`, { method: "POST" });
}

export async function adjustBudget(
  sessionId: string,
  body: { accept_reduced?: boolean; new_budget_usd?: number },
) {
  return jsonReq(`/sessions/${sessionId}/adjust-budget`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getSessionState(sessionId: string) {
  return jsonReq<SessionState>(`/sessions/${sessionId}/state`);
}

export function pdfUrl(sessionId: string) {
  return `${BASE}/sessions/${sessionId}/pdf`;
}

/**
 * Fetch the generated PDF and trigger a real browser download. Using a blob (instead of
 * an <a href target=_blank>) keeps the SPA mounted — no navigation away, no session reset —
 * and surfaces backend errors (409 plan-not-ready / 404 session-gone) to the caller.
 */
export async function downloadPdf(sessionId: string) {
  const res = await fetch(pdfUrl(sessionId));
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${detail}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trip-${sessionId.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function streamUrl(sessionId: string) {
  return `${BASE}/sessions/${sessionId}/stream`;
}
