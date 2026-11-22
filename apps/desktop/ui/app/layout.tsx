import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { tEnglish } from '../../shared/desktop-i18n/loader.js';
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
