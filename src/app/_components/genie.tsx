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
}

/** Pull a candidate id out of the Genie's reply so "publish" can target it. */
function candidateIdFrom(text: string): string | null {
  const single = text.match(/\bid:\s*(cand_[a-z0-9_]+)/i);
  if (single) return single[1] ?? null;
  // If several candidates were listed, don't auto-confirm one.
  const all = text.match(/cand_[a-z0-9_]+/gi) ?? [];
  return all.length === 1 ? all[0]! : null;
}

export function GenieChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmedCandidateId, setConfirmedCandidateId] = useState<
    string | null
  >(null);
  const [plan, setPlan] = useState<unknown>(null);
  const [engine, setEngine] = useState<'strands-bedrock' | 'scripted' | null>(
    null,
  );
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
            {role: 'genie', text: 'Hey, who do we want to onboard today?'},
          ]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [turns]);

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput('');
    // Snapshot the conversation so far as history for context (the agent is
    // stateless across requests), then optimistically add this user turn.
    const history = turns.map((t) => ({role: t.role, text: t.text}));
    setTurns((t) => [...t, {role: 'user', text: message}]);
    setBusy(true);
    try {
      const res = await fetch('/api/genie', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message, history, confirmedCandidateId, plan}),
      });
      const data = (await res.json()) as GenieReply & {error?: string};
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      setEngine(data.engine);
      setTurns((t) => [
        ...t,
        {role: 'genie', text: data.message, engine: data.engine},
      ]);
      // Carry the pending plan forward (null once published).
      setPlan(data.plan ?? null);
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

  return (
    <section className='panel genie' aria-label='Onboarding Genie chat'>
      <div className='panel-head'>
        <span className='panel-title'>Onboarding Genie</span>
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
          Message the Onboarding Genie
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
