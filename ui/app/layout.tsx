import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { tEnglish } from '../../src/desktop-i18n/messages.js';
import './globals.css';

export const metadata: Metadata = {
  title: tEnglish('app.title'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
