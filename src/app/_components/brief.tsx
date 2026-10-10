"use client";

/**
 * Access-brief drafter. Picks a hire, calls POST /api/ai/draft-brief, and
 * renders the returned welcome blurbs. This is the one UI surface for the
 * second AI endpoint (BuildPlan §3 /api/ai/draft-brief) — a user-triggered AI
 * action, so unlike the other role views it keeps the result in client state
 * instead of refreshing the server page.
 */

import { useState } from "react";

interface BriefBlurb {
  appId: string;
  heading: string;
  body: string;
}

export function BriefDrafter({ hires }: { hires: { id: string; name: string }[] }) {
  const [hireId, setHireId] = useState(hires[0]?.id ?? "");
  const [blurbs, setBlurbs] = useState<BriefBlurb[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hireName = hires.find((h) => h.id === hireId)?.name ?? "";

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/draft-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hireId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        blurbs?: BriefBlurb[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setBlurbs(data.blurbs ?? []);
    } catch (err) {
      setError((err as Error).message);
      setBlurbs(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section className="panel" style={{ padding: 20, gap: 14 }}>
        <div className="field">
          <label htmlFor="brief-hire">Draft a welcome brief for</label>
          <select
            id="brief-hire"
            className="input"
            value={hireId}
            onChange={(e) => {
              setHireId(e.target.value);
              setBlurbs(null);
              setError(null);
            }}
          >
            {hires.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" disabled={busy || !hireId} onClick={draft}>
          {busy ? "Drafting…" : "Generate brief"}
        </button>
        {error && <span className="error">{error}</span>}
      </section>

      {blurbs !== null && (
        <section className="panel" style={{ gap: 6 }}>
          <div className="panel-head" style={{ paddingBottom: 6 }}>
            <span className="panel-title">{hireName}&rsquo;s access brief</span>
            <span className="tag tag-accent-2">AI drafted</span>
          </div>
          {blurbs.length === 0 && (
            <span className="empty">
              No active seats to brief yet. Grant this hire some licenses first.
            </span>
          )}
          <div className="rows">
            {blurbs.map((b) => (
              <div key={b.appId} className="row row-ledger" style={{ alignItems: "flex-start" }}>
                <div className="who-text">
                  <span className="who-name">{b.heading}</span>
                  <span className="who-sub" style={{ whiteSpace: "normal", lineHeight: 1.45 }}>
                    {b.body}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
