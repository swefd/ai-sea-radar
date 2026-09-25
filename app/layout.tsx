import type { ReactNode } from 'react';

import { RegisterTileCache } from '@/_app/tile-cache';
import '@/_app/styles/globals.css';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <RegisterTileCache />
        {children}
      </body>
    </html>
  );
}
