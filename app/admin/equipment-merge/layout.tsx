import type { ReactNode } from "react";
import DiagnosticsTabs from "../diagnostics-tabs";

export default function EquipmentMergeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DiagnosticsTabs />
      {children}
    </>
  );
}
