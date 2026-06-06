import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { downloadPdf } from "@/api/client";

// Open every link in the rendered plan (OSM / Wikivoyage sources) in a new tab so clicking
// one never navigates the SPA away — that unloads React and the in-progress session is lost.
const mdComponents: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  },
};

export function PlanView({
  markdown,
  sessionId,
  finalized,
  onAccept,
}: {
  markdown: string;
  sessionId: string;
  finalized: boolean;
  onAccept: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setBusy(true);
    try {
      await downloadPdf(sessionId);
    } catch (e: any) {
      setError(e?.message || "Не удалось скачать PDF");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 border border-slate-200">
      <div className="markdown-plan">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {markdown}
        </ReactMarkdown>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!finalized && (
          <button
            type="button"
            onClick={onAccept}
            className="bg-halyk hover:bg-halyk-dark text-white font-medium px-4 py-2 rounded"
          >
            Принять план
          </button>
        )}
        {finalized && (
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="bg-halyk hover:bg-halyk-dark text-white font-medium px-4 py-2 rounded disabled:opacity-50"
          >
            {busy ? "Готовлю PDF…" : "Скачать PDF"}
          </button>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
