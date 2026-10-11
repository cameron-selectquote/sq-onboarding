'use client';

/**
 * Onboarding Genie chat. Talks to POST /api/genie one turn at a time. The agent
 * (Strands + Bedrock, or the scripted fallback) does the reasoning server-side;
 * this component just renders the conversation and tracks which candidate the
 * user has confirmed so the publish step can target it.
 */

import {useEffect, useRef, useState} from 'react';
import {MiniMarkdown} from './MiniMarkdown';

interface ChatTurn {
  role: 'genie' | 'user';
  text: string;
  engine?: 'strands-bedrock' | 'scripted';
}

interface GenieReply {
  message: string;
  engine: 'strands-bedrock' | 'scripted';
  /** Opaque pending plan — the client round-trips it so adjustments persist. */
  plan?: unknown;
  /** Opaque pending offboard — round-tripped so the yes/no gate persists. */
  offboard?: unknown;
}

/** Pull a candidate id out of the Genie's reply so "publish" can target it. */
function candidateIdFrom(text: string): string | null {
  const single = text.match(/\bid:\s*(cand_[a-z0-9_]+)/i);
  if (single) return single[1] ?? null;
  // If several candidates were listed, don't auto-confirm one.
  const all = text.match(/cand_[a-z0-9_]+/gi) ?? [];
  return all.length === 1 ? all[0]! : null;
}

export function GenieChat({initialName}: {initialName?: string}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmedCandidateId, setConfirmedCandidateId] = useState<
    string | null
  >(null);
  const [plan, setPlan] = useState<unknown>(null);
  const [offboard, setOffboard] = useState<unknown>(null);
  const [engine, setEngine] = useState<'strands-bedrock' | 'scripted' | null>(
    null,
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Opening greeting + which engine is live.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/genie')
      .then((r) => r.json())
      .then((d: {greeting: string; engine: 'strands-bedrock' | 'scripted'}) => {
        if (cancelled) return;
        setEngine(d.engine);
        setTurns([{role: 'genie', text: d.greeting, engine: d.engine}]);
      })
      .catch(() => {
        if (!cancelled)
          setTurns([
            {role: 'genie', text: 'Hey, what can I help you with today?'},
          ]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-start from a candidate ("Run Genie" on the candidates page). Fires
  // once, after the greeting is on screen, so the Genie opens already focused
  // on that person instead of a blank prompt.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!initialName || autoStarted.current) return;
    if (turns.length === 0) return; // wait for the greeting
    autoStarted.current = true;
    void sendMessage(initialName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialName, turns.length]);

  useEffect(() => {
    endRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [turns]);

  /** Send a message (from the input box or auto-started from a candidate). */
  async function sendMessage(message: string) {
    const text = message.trim();
    if (!text || busy) return;
    // Snapshot the conversation so far as history for context (the agent is
    // stateless across requests), then optimistically add this user turn.
    const history = turns.map((t) => ({role: t.role, text: t.text}));
    setTurns((t) => [...t, {role: 'user', text}]);
    setBusy(true);
    try {
      const res = await fetch('/api/genie', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          message: text,
          history,
          confirmedCandidateId,
          plan,
          offboard,
        }),
      });
      const data = (await res.json()) as GenieReply & {error?: string};
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      setEngine(data.engine);
      setTurns((t) => [
        ...t,
        {role: 'genie', text: data.message, engine: data.engine},
      ]);
      // Carry the pending plan + offboard confirmation forward.
      setPlan(data.plan ?? null);
      setOffboard(data.offboard ?? null);
      const found = candidateIdFrom(data.message);
      if (found) setConfirmedCandidateId(found);
    } catch (err) {
      setTurns((t) => [
        ...t,
        {
          role: 'genie',
          text: `Something went wrong: ${(err as Error).message}`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const message = input.trim();
    if (!message) return;
    setInput('');
    void sendMessage(message);
  }

  return (
    <section className='panel genie' aria-label='Genie chat'>
      <div className='panel-head'>
        <span className='panel-title'>Genie</span>
        <div className='genie-head-right'>
          {engine && (
            <span
              className={
                engine === 'strands-bedrock' ? 'tag tag-accent-2' : (
                  'tag tag-neutral'
                )
              }
            >
              {engine === 'strands-bedrock' ?
                '● Strands + Bedrock'
              : 'Built-in planner'}
            </span>
          )}
          <div className='genie-help'>
            <button
              type='button'
              className='genie-help-btn'
              aria-label='What can Genie do?'
              aria-expanded={helpOpen}
              aria-haspopup='dialog'
              onClick={() => setHelpOpen((o) => !o)}
            >
              i
            </button>
            {helpOpen && (
              <>
                <div
                  className='genie-help-backdrop'
                  onClick={() => setHelpOpen(false)}
                />
                <div
                  className='genie-help-pop'
                  role='dialog'
                  aria-label='What Genie can do'
                >
                  <div className='genie-help-head'>
                    <span className='genie-help-title'>What I can do</span>
                    <button
                      type='button'
                      className='genie-help-close'
                      aria-label='Close'
                      onClick={() => setHelpOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <p className='genie-help-lead'>
                    I help you get things done — like setting someone up end to
                    end, keeping every seat and asset costed on the live ledger.
                    Try asking me to:
                  </p>
                  <ul className='genie-help-list'>
                    <li>
                      <strong>Find a candidate</strong> — search by full or
                      partial name, even with a typo. “Nora”, “Alvarez”, “Nora
                      Alverez”.
                    </li>
                    <li>
                      <strong>Build a 30-day plan</strong> — Day 1 essentials,
                      role &amp; tool access, and 30-day milestones, with the
                      software seats I&apos;ll grant.
                    </li>
                    <li>
                      <strong>Switch templates</strong> — “use the Designer
                      template”, “make them an Engineer”.
                    </li>
                    <li>
                      <strong>Adjust seats</strong> — “drop Slack”, “add Jira”,
                      “she doesn&apos;t need Figma”.
                    </li>
                    <li>
                      <strong>Skip tasks</strong> — “skip the badge”, “no
                      laptop”, and I won&apos;t run them.
                    </li>
                    <li>
                      <strong>Set the start date</strong> — “she starts March
                      15” or “start date 2026-03-15”.
                    </li>
                    <li>
                      <strong>Publish &amp; execute</strong> — “publish” creates
                      the hire, grants seats, orders the laptop, issues the
                      badge, and provisions email/SSO — each hitting the ledger.
                    </li>
                    <li>
                      <strong>Offboard someone</strong> — “offboard Quinn
                      Baker”. I show what it reclaims and ask you to confirm
                      before revoking seats or returning hardware.
                    </li>
                  </ul>
                  <p className='genie-help-foot'>
                    I never invent candidate data, and I only mark a task done
                    once it&apos;s actually run.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className='genie-log' role='log' aria-live='polite'>
        {turns.map((t, i) => (
          <div key={i} className={`genie-turn genie-${t.role}`}>
            <span className='genie-who'>
              {t.role === 'genie' ? 'Genie' : 'You'}
            </span>
            {t.role === 'genie' ?
              <div className='genie-text'>
                <MiniMarkdown text={t.text} />
              </div>
            : <p className='genie-text'>{t.text}</p>}
          </div>
        ))}
        {busy && (
          <div className='genie-turn genie-genie'>
            <span className='genie-who'>Genie</span>
            <p className='genie-text muted'>Thinking…</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className='genie-form'
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className='sr-only' htmlFor='genie-input'>
          Message Genie
        </label>
        <input
          id='genie-input'
          className='input'
          placeholder='Try a candidate name, e.g. Nora Alvarez'
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className='btn btn-primary' disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
