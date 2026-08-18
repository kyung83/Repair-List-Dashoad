import type { ReactNode } from "react";
import ModuleTabs from "../../module-tabs";

export default function RepairHistoryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="reports-history-tabs"><ModuleTabs module="reports" /></div>
      {children}
    </>
  );
}
