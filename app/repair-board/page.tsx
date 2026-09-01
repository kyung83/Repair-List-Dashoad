import RepairBoardDashboard from "./dashboard-v2";
import RepairBoardSelfAssignPanel from "./self-assign-panel";
import RepairCardOutsideVendor from "./repair-card-outside-vendor";
import s from "./repair-board.module.css";

// Keep one working assignment control when a Repair Board unit is expanded. Production refresh 2026-08-26.
export default function RepairBoardPage() {
  return (
    <>
      <style>{`
        .${s.page} { background: #fff; }
        .${s.stack}>section:nth-child(2) { order: -1; }
        .${s.openRow} select[aria-label^="Assign Unit"] { display: none !important; }
        .${s.detailGrid} > div:nth-child(2) > b:first-child { display: none !important; }
        .${s.detailGrid} > div:nth-child(2) > select.${s.fieldSelect}:first-of-type { display: none !important; }
      `}</style>
      <RepairBoardSelfAssignPanel />
      <RepairBoardDashboard />
      <RepairCardOutsideVendor />
    </>
  );
}
