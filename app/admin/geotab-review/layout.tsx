import type { ReactNode } from 'react';
import GeotabHealthPanel from './health-panel';

// Shadow mode is intentionally diagnostic only; legacy yard routing remains authoritative until cutover review.
export default function GeotabReviewLayout({ children }: { children: ReactNode }) {
  return <><GeotabHealthPanel />{children}</>;
}
