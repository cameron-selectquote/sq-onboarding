import Link from 'next/link';
import {VIEW_LABELS, VIEW_PATHS, viewsFor} from '@/lib/access';
import {getPersona} from './_components/persona';

/**
 * Landing page: links to the current persona's role views, plus the live API
 * endpoints the views build against.
 */
export default async function Home() {
  const persona = await getPersona();
  const endpoints = [
    'POST /api/hires/import',
    'GET  /api/hires',
    'GET  /api/hires/:id',
    'GET  /api/hires/:id/checklist',
    'PATCH /api/tasks/:id',
    'POST /api/licenses/:id/grant',
    'POST /api/licenses/:id/revoke',
    'POST /api/pos',
    'GET  /api/assets',
    'POST /api/assets/:id/return',
    'GET  /api/catalog',
    'GET  /api/finance/summary',
    'POST /api/ai/match-template',
  ];
  return (
    <>
      <section className='panel'>
        <h1>Provision</h1>
        <p>Pick a role in the top bar. Your views:</p>
        <ul>
          {viewsFor(persona).map((v) => (
            <li key={v}>
              <Link href={VIEW_PATHS[v]}>{VIEW_LABELS[v]}</Link>
            </li>
          ))}
        </ul>
      </section>
      <section className='panel'>
        <h2>Live API endpoints</h2>
        <ul>
          {endpoints.map((e) => (
            <li key={e}>
              <code>{e}</code>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
