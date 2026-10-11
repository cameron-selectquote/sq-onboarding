import Link from 'next/link';
import {getServices} from '@/server/store';
import {portalUrlFor} from '@/lib/candidates';
import {Avatar, PageHead, Shell} from '../../_components/Shell';

export const dynamic = 'force-dynamic';

/**
 * Candidate pipeline (the Genie's input + output). Shows pre-hire candidates
 * and whether the Genie has published them into onboarding yet — so you can
 * watch a candidate flip from "new" to "onboarding" with a live portal link
 * after running the Genie.
 */
export default async function Candidates() {
  const {repo} = await getServices();
  const [candidates, users] = await Promise.all([
    repo.candidates.list(),
    repo.users.list(),
  ]);
  const managerName = new Map(users.map((u) => [u.id, u.name]));

  const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name));
  const onboarding = sorted.filter((c) => c.status === 'onboarding').length;

  return (
    <Shell active='/specialist/candidates'>
      <PageHead
        eyebrow={`${candidates.length} candidates · ${onboarding} onboarding`}
        title='Candidate pipeline'
      />
      <div className='panel' style={{gap: 0, paddingTop: 8}}>
        <div className='row row-candidate is-head' role='row'>
          <span>Candidate</span>
          <span>Title / Role</span>
          <span>Hiring manager</span>
          <span>Status</span>
          <span>Portal</span>
        </div>
        {sorted.map((c) => (
          <div
            key={c.id}
            className='row row-candidate'
            style={{borderTop: '1px solid var(--color-divider)'}}
          >
            <div className='who'>
              <Avatar name={c.name} />
              <div className='who-text'>
                <span className='who-name'>{c.name}</span>
                <span className='who-sub'>{c.resumeFile ?? '—'}</span>
              </div>
            </div>
            <span>
              {c.title}
              {c.roleName ? '' : ' (no role on file)'}
            </span>
            <span>
              {c.hiringManagerId ?
                (managerName.get(c.hiringManagerId) ?? '—')
              : '—'}
            </span>
            <span>
              {c.status === 'onboarding' ?
                <span className='pill pill-done'>Onboarding</span>
              : <span className='pill pill-none'>New</span>}
            </span>
            <span>
              {c.hireId ?
                <Link href={portalUrlFor(c.hireId)}>Open portal</Link>
              : <Link
                  href={`/specialist/genie?candidate=${encodeURIComponent(c.id)}`}
                >
                  Run Genie
                </Link>
              }
            </span>
          </div>
        ))}
      </div>
    </Shell>
  );
}
