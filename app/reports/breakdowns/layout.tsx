import type { ReactNode } from "react";
import BreakdownReportActions from "./report-actions";

export default function BreakdownReportsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <BreakdownReportActions />
      <div id="breakdown-report-print-scope">{children}</div>
    </>
  );
}
