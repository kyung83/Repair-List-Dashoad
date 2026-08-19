import type { ReactNode } from 'react';
import GeotabHealthPanel from './health-panel';

export default function GeotabReviewLayout({ children }: { children: ReactNode }) {
  return <><GeotabHealthPanel />{children}</>;
}
