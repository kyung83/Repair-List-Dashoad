import type { ReactNode } from 'react';
import DiagnosticsTabs from '../diagnostics-tabs';
import GeotabConnectionPanel from './connection-panel';
import GeotabHealthPanel from './health-panel';

// Shadow mode is intentionally diagnostic only; legacy yard routing remains authoritative until cutover review.
export default function GeotabReviewLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DiagnosticsTabs />
      <GeotabConnectionPanel />
      <GeotabHealthPanel />
      <div id="geotab-review-detail">{children}</div>
    </>
  );
}
