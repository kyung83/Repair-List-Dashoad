import type { ReactNode } from "react";
import SyncGeotabButton from "./sync-geotab-button";

export default function PmSchedulesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SyncGeotabButton />
    </>
  );
}
