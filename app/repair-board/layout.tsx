import type { ReactNode } from 'react';

export default function RepairBoardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`nav[aria-label="Work needing attention"],nav[aria-label="Planning attention"]{display:none!important;}`}</style>
      {children}
    </>
  );
}
