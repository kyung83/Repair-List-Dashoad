import type { ReactNode } from 'react';
import BreakdownPhotoRequestCompressor from './breakdown-photo-request-compressor';

export default function ReportBreakdownLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <BreakdownPhotoRequestCompressor />
      {children}
    </>
  );
}
