import type {ReactNode} from 'react';
import './organic.css';
import './app.css';

export const metadata = {
  title: 'Provision',
  description: 'Onboarding + spend ledger — Hack Midwest 2026',
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang='en'>
      <body>{children}</body>
    </html>
  );
}
