import Link from "next/link";
import type { ReactNode } from "react";
import { ROLE_LABELS, canSwitchRole, navFor } from "@/lib/access";
import { currentSession } from "@/server/auth";
import { getServices } from "@/server/store";
import { RolePicker } from "./RolePicker";
import { initials } from "./format";

/**
 * Sidebar + main frame shared by every page. The nav is derived from the
 * session's viewing role (lib/access.ts navFor), so a page can't list links
 * its viewer may not open. Pages pass only the active href.
 *
 * The user block under the avatar signs out, and — for real admins only —
 * holds the role picker.
 */
export async function Shell({
  active,
  children,
  fill = false,
}: {
  active: string;
  children: ReactNode;
  /** When true, the main column fills the viewport height (no page scroll) so
   *  a child panel can grow to full height. Used by the Genie chat. */
  fill?: boolean;
}) {
  const session = await currentSession();
  const sections = session ? navFor(session.viewAs) : [];
  const isAdmin = session ? canSwitchRole(session.role) : false;
  const hires = isAdmin ? (await (await getServices()).repo.hires.list()).map((h) => ({ id: h.id, name: h.name })) : [];

  return (
    <div className={fill ? "shell shell-fill" : "shell"}>
      <nav className="side" aria-label="Main">
        <Link href="/home" className="side-brand">
          <span className="brand-dot" />
          <span>
            <span className="side-brand-name">Provision</span>
            <span className="side-brand-co">SelectQuote</span>
          </span>
        </Link>
        {sections.map((section) => (
          <div key={section.title ?? "top"} className="side-section">
            {section.title && <span className="side-section-title">{section.title}</span>}
            {section.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="side-link"
                aria-current={item.href === active ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <span className="side-spacer" />
        {session && (
          <details className="side-user">
            <summary>
              <span className="avatar avatar-sm" aria-hidden>
                {initials(session.name)}
              </span>
              <span className="side-user-text">
                <span className="side-user-name">{session.name}</span>
                <span className="side-user-role">
                  {session.viewAs === session.role ? ROLE_LABELS[session.role] : `Viewing as ${ROLE_LABELS[session.viewAs]}`}
                </span>
              </span>
            </summary>
            <div className="side-user-menu">
              {isAdmin && <RolePicker viewAs={session.viewAs} hireId={session.hireId} hires={hires} />}
              <form method="post" action="/api/session/logout">
                <button type="submit" className="btn btn-ghost btn-block">
                  Sign out
                </button>
              </form>
            </div>
          </details>
        )}
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="head">
      <div className="head-text">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="title">{title}</h1>
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

/** Link-based segmented control: filters live in the URL, no client state. */
export function SegLinks({ options, active }: { options: { href: string; label: string }[]; active: string }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <Link key={o.href} href={o.href} className="seg-opt" aria-current={o.href === active ? "page" : undefined}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export function Avatar({ name, size }: { name: string; size?: "sm" | "lg" }) {
  return <span className={size ? `avatar avatar-${size}` : "avatar"}>{initials(name)}</span>;
}

export function Kpi({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className={tone ? `kpi is-${tone}` : "kpi"}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

export function Meter({ label, value, pct, hot, note }: { label: string; value: string; pct: number; hot?: boolean; note?: string }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span>{value}</span>
      </div>
      <div className="bar">
        <div className={hot ? "bar-fill is-hot" : "bar-fill"} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {note && <span className="meter-note">{note}</span>}
    </div>
  );
}
