import type {ReactNode} from 'react';
import './globals.css';
import {Nav} from './_components/Nav';
import {getPersona} from './_components/persona';

export const metadata = {
  title: 'Provision',
  description: 'Onboarding + spend ledger — Hack Midwest 2026',
};

export default async function RootLayout({children}: {children: ReactNode}) {
  const persona = await getPersona();
  return (
    <html lang='en'>
      <body>
        <a className='skip-link' href='#main'>
          Skip to content
        </a>
        <Nav persona={persona} />
        <main id='main' className='container'>
          {children}
        </main>
      </body>
    </html>
  );
}
