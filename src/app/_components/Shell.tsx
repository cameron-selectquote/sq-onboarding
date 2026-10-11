import Link from 'next/link';
import type {ReactNode} from 'react';
import {initials} from './format';

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

/**
 * Sidebar + main frame shared by every role view. There's no auth yet, so the
 * "Viewing as" card links back to the role picker at "/".
 */
export function Shell({
  nav,
  active,
  whoLabel = 'Viewing as',
  who,
  children,
  fill = false,
}: {
  nav: NavItem[];
  active: string;
  whoLabel?: string;
  who: string;
  children: ReactNode;
  /** When true, the main column fills the viewport height (no page scroll) so
   *  a child panel can grow to full height. Used by the Genie chat. */
  fill?: boolean;
}) {
  return (
    <div className={fill ? 'shell shell-fill' : 'shell'}>
      <nav className='side' aria-label='Main'>
        <Link href='/' className='side-brand'>
          <span className='brand-dot' />
          <span>
            <span className='side-brand-name'>Provision</span>
            <span className='side-brand-co'>SelectQuote</span>
          </span>
        </Link>
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className='side-link'
            aria-current={item.href === active ? 'page' : undefined}
          >
            <span>{item.label}</span>
            {item.badge !== undefined && <span>{item.badge}</span>}
          </Link>
        ))}
        <span className='side-spacer' />
        <Link href='/' className='side-who' title='Switch role'>
          <span>{whoLabel}</span>
          <span>{who}</span>
        </Link>
      </nav>
      <main className='main'>{children}</main>
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
    <div className='head'>
      <div className='head-text'>
        <span className='eyebrow'>{eyebrow}</span>
        <h1 className='title'>{title}</h1>
      </div>
      {children && <div className='actions'>{children}</div>}
    </div>
  );
}

/** Link-based segmented control: filters live in the URL, no client state. */
export function SegLinks({
  options,
  active,
}: {
  options: {href: string; label: string}[];
  active: string;
}) {
  return (
    <div className='seg'>
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          className='seg-opt'
          aria-current={o.href === active ? 'page' : undefined}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export function Avatar({name, size}: {name: string; size?: 'sm' | 'lg'}) {
  return (
    <span className={size ? `avatar avatar-${size}` : 'avatar'}>
      {initials(name)}
    </span>
  );
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
  tone?: 'good' | 'warn';
}) {
  return (
    <div className={tone ? `kpi is-${tone}` : 'kpi'}>
      <span className='kpi-label'>{label}</span>
      <span className='kpi-value'>
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {sub && <span className='kpi-sub'>{sub}</span>}
    </div>
  );
}

export function Meter({
  label,
  value,
  pct,
  hot,
  note,
}: {
  label: string;
  value: string;
  pct: number;
  hot?: boolean;
  note?: string;
}) {
  return (
    <div className='meter'>
      <div className='meter-head'>
        <span style={{fontWeight: 600}}>{label}</span>
        <span>{value}</span>
      </div>
      <div className='bar'>
        <div
          className={hot ? 'bar-fill is-hot' : 'bar-fill'}
          style={{width: `${Math.min(pct, 100)}%`}}
        />
      </div>
      {note && <span className='meter-note'>{note}</span>}
    </div>
  );
}
