import type { ReactNode } from 'react';

export default function RepairBoardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`nav[aria-label="Planning attention"]{display:none!important;}`}</style>
      {children}
    </>
  );
}
