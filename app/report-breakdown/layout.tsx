import type { ReactNode } from 'react';
import PhotoUploadGuard from './photo-upload-guard';

export default function ReportBreakdownLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PhotoUploadGuard />
      {children}
    </>
  );
}
