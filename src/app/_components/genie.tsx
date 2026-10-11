'use client';

/**
 * Onboarding Genie chat. Talks to POST /api/genie one turn at a time. The agent
 * (Strands + Bedrock, or the scripted fallback) does the reasoning server-side;
 * this component just renders the conversation and tracks which candidate the
 * user has confirmed so the publish step can target it.
 */

import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {MiniMarkdown} from './MiniMarkdown';
import {shortDate} from './format';
import {getGenieState, setGenieState, subscribeGenie} from './genie-store';

/** A structured recovered-spend card the chat renders as a visual panel. */
interface ReclaimCard {
  type: 'reclaim';
  kind: 'pending' | 'done';
  hireName: string;
  seats: {label: string; monthly: number}[];
  assets: {label: string; residual: number}[];
  monthlyRecovered: number;
  oneTimeRecovered: number;
}

/** A read-only status card for "pull up a person". */
interface StatusCard {
  type: 'status';
  hireName: string;
  roleName: string;
  startDate: string;
  managerName: string | null;
  offboarding: boolean;
  statusLabel: string;
  done: number;
  total: number;
  pct: number;
  nextTask: string | null;
  seats: {label: string; status: string; monthly: number}[];
  assets: {label: string; residual: number}[];
  monthlyRecurring: number;
}

/** A simple table of candidates the chat renders as a card. */
interface CandidateTableCard {
  type: 'candidates';
  rows: {
    id: string;
    name: string;
    title: string;
    roleName: string | null;
    manager: string | null;
    startDate: string | null;
    onboarded: boolean;
  }[];
}

type GenieCard = ReclaimCard | StatusCard | CandidateTableCard;

interface ChatTurn {
  role: 'genie' | 'user';
  text: string;
  engine?: 'strands-bedrock' | 'scripted';
  card?: GenieCard | null;
}

interface GenieReply {
  message: string;
  engine: 'strands-bedrock' | 'scripted';
  /** Opaque pending plan — the client round-trips it so adjustments persist. */
  plan?: unknown;
  /** Opaque pending offboard — round-tripped so the yes/no gate persists. */
  offboard?: unknown;
  /** Opaque in-progress template build — round-tripped across turns. */
  templateDraft?: unknown;
  /** Optional structured card to render alongside the message (render-only). */
  card?: GenieCard | null;
}

const money0 = (n: number): string =>
  `$${Math.round(n).toLocaleString('en-US')}`;

/** Visual recovered-spend panel for the offboard preview/result. */
function ReclaimCardView({card}: {card: ReclaimCard}) {
  const done = card.kind === 'done';
  return (
    <div className={`reclaim-card${done ? ' is-done' : ''}`} role='group'>
      <div className='reclaim-card-head'>
        <span className='reclaim-card-title'>
          {done ?
            `${card.hireName} offboarded`
          : `Reclaim preview · ${card.hireName}`}
        </span>
        <span className={`tag ${done ? 'tag-accent-2' : 'tag-neutral'}`}>
          {done ? 'Recovered' : 'Recoverable'}
        </span>
      </div>

      {card.seats.length > 0 && (
        <div className='reclaim-card-section'>
          <span className='reclaim-card-label'>
            Seats {done ? 'revoked' : 'to revoke'}
          </span>
          {card.seats.map((s, i) => (
            <div key={i} className='reclaim-card-row'>
              <span>{s.label}</span>
              <span className='reclaim-card-amt'>{money0(s.monthly)}/mo</span>
            </div>
          ))}
        </div>
      )}

      {card.assets.length > 0 && (
        <div className='reclaim-card-section'>
          <span className='reclaim-card-label'>
            Hardware {done ? 'returned' : 'to return'}
          </span>
          {card.assets.map((a, i) => (
            <div key={i} className='reclaim-card-row'>
              <span>{a.label}</span>
              <span className='reclaim-card-amt'>{money0(a.residual)}</span>
            </div>
          ))}
        </div>
      )}

      <div className='reclaim-card-totals'>
        <div className='reclaim-card-total'>
          <span className='reclaim-card-total-value'>
            {money0(card.monthlyRecovered)}/mo
          </span>
          <span className='reclaim-card-total-label'>recurring</span>
        </div>
        <div className='reclaim-card-total'>
          <span className='reclaim-card-total-value'>
            {money0(card.oneTimeRecovered)}
          </span>
          <span className='reclaim-card-total-label'>one-time</span>
        </div>
      </div>
    </div>
  );
}

/** Read-only onboarding-status panel for "pull up a person". */
function StatusCardView({card}: {card: StatusCard}) {
  return (
    <div className='status-card' role='group'>
      <div className='status-card-head'>
        <span className='status-card-title'>{card.hireName}</span>
        <span
          className={`tag ${card.offboarding ? 'tag-neutral' : 'tag-accent-2'}`}
        >
          {card.offboarding ? 'Offboarding' : card.statusLabel}
        </span>
      </div>

      <div className='status-card-meta'>
        <span>{card.roleName}</span>
        <span>·</span>
        <span>Starts {shortDate(card.startDate)}</span>
        {card.managerName && (
          <>
            <span>·</span>
            <span>Mgr {card.managerName}</span>
          </>
        )}
      </div>

      {card.total > 0 && (
        <div className='status-card-progress'>
          <div className='status-card-bar'>
            <div
              className='status-card-bar-fill'
              style={{width: `${card.pct}%`}}
            />
          </div>
          <span className='status-card-progress-label'>
            {card.done}/{card.total} tasks · {card.pct}%
          </span>
        </div>
      )}
      {card.nextTask && !card.offboarding && (
        <div className='status-card-next'>
          <span className='status-card-label'>Up next</span>
          <span>{card.nextTask}</span>
        </div>
      )}

      <div className='status-card-section'>
        <span className='status-card-label'>
          Software ({card.seats.length})
        </span>
        {card.seats.length === 0 ?
          <span className='muted' style={{fontSize: 13}}>
            No seats yet
          </span>
        : card.seats.map((s, i) => (
            <div key={i} className='status-card-row'>
              <span>
                {s.label}
                {(s.status === 'idle' || s.status === 'reclaim') && (
                  <span className='pill pill-blocked' style={{marginLeft: 6}}>
                    {s.status}
                  </span>
                )}
              </span>
              <span className='status-card-amt'>{money0(s.monthly)}/mo</span>
            </div>
          ))
        }
      </div>

      <div className='status-card-section'>
        <span className='status-card-label'>
          Hardware ({card.assets.length})
        </span>
        {card.assets.length === 0 ?
          <span className='muted' style={{fontSize: 13}}>
            No hardware assigned
          </span>
        : card.assets.map((a, i) => (
            <div key={i} className='status-card-row'>
              <span>{a.label}</span>
              <span className='status-card-amt'>{money0(a.residual)}</span>
            </div>
          ))
        }
      </div>

      {card.monthlyRecurring > 0 && (
        <div className='status-card-foot'>
          Recurring spend: <strong>{money0(card.monthlyRecurring)}/mo</strong>
        </div>
      )}
    </div>
  );
}

/** Simple candidate pipeline table for "show me the candidates". */
function CandidateTableView({card}: {card: CandidateTableCard}) {
  if (card.rows.length === 0) return null;
  return (
    <div className='cand-card' role='group'>
      <table className='cand-table'>
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Role</th>
            <th>Manager</th>
            <th>Start</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {card.rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.title}</td>
              <td>{r.roleName ?? '—'}</td>
              <td>{r.manager ?? '—'}</td>
              <td>{r.startDate ? shortDate(r.startDate) : '—'}</td>
              <td>
                {r.onboarded ?
                  <span className='pill pill-done'>Onboarded</span>
                : <span className='pill pill-none'>New</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  // Conversation state lives in a shared module store so it persists across
  // route navigation (and across the overlay + the standalone page), and only
  // resets on a full browser refresh.
  const state = useSyncExternalStore(
    subscribeGenie,
    getGenieState,
    getGenieState,
  );
  const turns = state.turns as ChatTurn[];
  const engine = state.engine;

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Opening greeting + which engine is live. We only consider the chat
  // "started" once the greeting turn has actually landed — not merely when a
  // fetch was kicked off. This matters because the overlay unmounts GenieChat
  // when closed: if a mount's fetch is cancelled on unmount before it resolves,
  // the next mount must retry rather than skip and show an empty chat.
  useEffect(() => {
    if (state.started && state.turns.length > 0) return;
    let cancelled = false;
    fetch('/api/genie')
      .then((r) => r.json())
      .then((d: {greeting: string; engine: 'strands-bedrock' | 'scripted'}) => {
        if (cancelled) return;
        // Don't clobber a conversation that's already in progress.
        if (getGenieState().turns.length > 0) {
          setGenieState({started: true, engine: d.engine});
          return;
        }
        setGenieState({
          started: true,
          engine: d.engine,
          turns: [{role: 'genie', text: d.greeting, engine: d.engine}],
        });
      })
      .catch(() => {
        if (cancelled || getGenieState().turns.length > 0) return;
        setGenieState({
          started: true,
          turns: [
            {
              role: 'genie',
              text: 'Hi, I\u2019m Genie. What can I help you with today?',
            },
          ],
        });
      });
    return () => {
      cancelled = true;
    };
    // Re-run if the store was reset (started back to false) or the greeting
    // hasn't landed yet.
  }, [state.started, state.turns.length]);

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
    const snapshot = getGenieState();
    const history = snapshot.turns.map((t) => ({role: t.role, text: t.text}));
    setGenieState((prev) => ({turns: [...prev.turns, {role: 'user', text}]}));
    setBusy(true);
    try {
      const res = await fetch('/api/genie', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          message: text,
          history,
          confirmedCandidateId: snapshot.confirmedCandidateId,
          plan: snapshot.plan,
          offboard: snapshot.offboard,
          templateDraft: snapshot.templateDraft,
        }),
      });
      const data = (await res.json()) as GenieReply & {error?: string};
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      const found = candidateIdFrom(data.message);
      setGenieState((prev) => ({
        engine: data.engine,
        turns: [
          ...prev.turns,
          {
            role: 'genie',
            text: data.message,
            engine: data.engine,
            card: data.card ?? null,
          },
        ],
        // Carry the pending plan + offboard + template-draft state forward.
        plan: data.plan ?? null,
        offboard: data.offboard ?? null,
        templateDraft: data.templateDraft ?? null,
        confirmedCandidateId: found ?? prev.confirmedCandidateId,
      }));
    } catch (err) {
      setGenieState((prev) => ({
        turns: [
          ...prev.turns,
          {
            role: 'genie',
            text: `Something went wrong: ${(err as Error).message}`,
          },
        ],
      }));
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
                      <strong>Show the candidates</strong> — “show me the
                      candidates” lists everyone in the pipeline as a table.
                    </li>
                    <li>
                      <strong>Find a candidate</strong> — search by full or
                      partial name, even with a typo. “Nora”, “Alvarez”, “Nora
                      Alverez”.
                    </li>
                    <li>
                      <strong>Pull up a person</strong> — “pull up Nora”, “what
                      does Sam have”. I show their onboarding status and the
                      software/hardware they hold — no onboarding started.
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
                      <strong>Revoke a seat</strong> — “revoke Nora&apos;s Figma
                      seat”. I revoke it for real and credit the recovered spend
                      to the reclaim view.
                    </li>
                    <li>
                      <strong>Build a template</strong> — “create a template”
                      and I&apos;ll ask you for the role, tasks, and seats one
                      at a time, then save it.
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
                {t.card?.type === 'reclaim' && (
                  <ReclaimCardView card={t.card} />
                )}
                {t.card?.type === 'status' && <StatusCardView card={t.card} />}
                {t.card?.type === 'candidates' && (
                  <CandidateTableView card={t.card} />
                )}
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

/**
 * Global Genie launcher: a button pinned top-left on every page that pops the
 * Genie chat open as an overlay. The chat conversation itself lives in the
 * shared module store (genie-store), so opening/closing the overlay — or
 * navigating between pages — never restarts the conversation. A full browser
 * refresh is what resets it.
 */
export function GenieLauncher() {
  const [open, setOpen] = useState(false);

  // Esc closes the overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type='button'
        className='genie-launch'
        aria-haspopup='dialog'
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className='genie-launch-dot' aria-hidden />
        Genie
      </button>

      {open && (
        <div className='genie-overlay' role='presentation'>
          <div
            className='genie-overlay-backdrop'
            onClick={() => setOpen(false)}
          />
          <div
            className='genie-overlay-panel'
            role='dialog'
            aria-modal='true'
            aria-label='Genie chat'
          >
            <div className='genie-overlay-bar'>
              <button
                type='button'
                className='genie-overlay-close'
                aria-label='Close Genie'
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <GenieChat />
          </div>
        </div>
      )}
    </>
  );
}
