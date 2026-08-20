import type { ReactNode } from 'react';
import DiagnosticsTabs from '../diagnostics-tabs';

// Each diagnostic concern now has its own page instead of stacking every repair tool on one screen.
export default function GeotabReviewLayout({ children }: { children: ReactNode }) {
  return <>
    <DiagnosticsTabs />
    {children}
  </>;
}
