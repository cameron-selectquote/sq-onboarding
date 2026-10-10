"use client";

import { useState, type FormEvent } from "react";
import { importHires, loadCatalog, matchTemplate } from "../_components/api";
import { usePoll } from "../_components/usePoll";

/** Seeded manager; the manager report filters on this id. */
const DEFAULT_MANAGER_ID = "u_mgr";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Demo beat 1: import a hire. Optionally ask the AI matcher for a template +
 * stack from a job title, then POST /api/hires/import.
 */
export function ImportHireForm({ onImported }: { onImported: () => void | Promise<void> }) {
  const catalog = usePoll(loadCatalog);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [roleName, setRoleName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [appIds, setAppIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const templates = catalog.data?.templates ?? [];
  const apps = catalog.data?.apps ?? [];
  const effectiveRole = roleName || templates[0]?.roleName || "";

  async function onSuggest() {
    if (!title.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const { match } = await matchTemplate(title.trim());
      const known = templates.some((t) => t.roleName === match.roleName);
      if (known) setRoleName(match.roleName);
      setAppIds(match.suggestedAppIds.filter((id) => apps.some((a) => a.id === id)));
      setMessage({
        tone: "ok",
        text: known
          ? `Suggested ${match.roleName} (${Math.round(match.confidence * 100)}% confidence)`
          : `No template for "${match.roleName}". Pick a role manually.`,
      });
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !effectiveRole || !startDate) return;
    setBusy(true);
    setMessage(null);
    try {
      const { created } = await importHires([
        {
          name: name.trim(),
          email: email.trim(),
          roleName: effectiveRole,
          startDate,
          managerId: DEFAULT_MANAGER_ID,
          appIds,
        },
      ]);
      const c = created[0];
      setMessage({
        tone: "ok",
        text: c
          ? `Imported ${c.hire.name}: ${c.taskCount} tasks, ${c.licenseCount} seats`
          : "Imported",
      });
      setName("");
      setEmail("");
      setTitle("");
      setAppIds([]);
      await onImported();
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function toggleApp(id: string) {
    setAppIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <section className="panel" aria-labelledby="import-heading">
      <h2 id="import-heading">Import a hire</h2>
      <form onSubmit={(e) => void onSubmit(e)}>
        <div className="form-grid">
          <label className="field">
            Name
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            Job title (for AI match)
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="field">
            <button
              type="button"
              className="secondary"
              disabled={busy || !title.trim()}
              onClick={() => void onSuggest()}
            >
              Suggest template
            </button>
          </div>
          <label className="field">
            Role template
            <select value={effectiveRole} onChange={(e) => setRoleName(e.target.value)}>
              {templates.map((t) => (
                <option key={t.id} value={t.roleName}>
                  {t.roleName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Start date
            <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
        </div>

        <fieldset>
          <legend>Seats to grant</legend>
          <div className="checks">
            {apps.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={appIds.includes(a.id)}
                  onChange={() => toggleApp(a.id)}
                />{" "}
                {a.name}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="actions">
          <button type="submit" disabled={busy || !effectiveRole}>
            Import hire
          </button>
          {message ? (
            <span role="status" className={message.tone === "error" ? "error" : "muted"}>
              {message.text}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
