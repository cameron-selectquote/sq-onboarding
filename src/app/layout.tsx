import type {ReactNode} from 'react';
import './organic.css';
import './app.css';
import {GenieLauncher} from './_components/genie';

export const metadata = {
  title: 'sprout',
  description: 'Onboarding + spend ledger — Hack Midwest 2026',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang='en'>
      <body>
        {children}
        {/* Global Genie launcher — a top-left button + overlay available on
            every page. The conversation persists across navigation via the
            shared store and only resets on a full refresh. */}
        <GenieLauncher />
      </body>
    </html>
  );
}
