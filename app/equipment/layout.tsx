import type { ReactNode } from 'react';
import GeotabTrackingEnhancer from './geotab-tracking-enhancer';

export default function EquipmentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <GeotabTrackingEnhancer />
    </>
  );
}
