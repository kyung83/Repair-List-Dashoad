import type { ReactNode } from 'react';
import BulkArchiveEnhancer from './bulk-archive-enhancer';
import GeotabTrackingEnhancer from './geotab-tracking-enhancer';

export default function EquipmentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <GeotabTrackingEnhancer />
      <BulkArchiveEnhancer />
    </>
  );
}
