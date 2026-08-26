import RepairBoardDashboard from "./dashboard-v2";
import RepairBoardSelfAssignPanel from "./self-assign-panel";
import s from "./repair-board.module.css";
import ModuleTabs from "../module-tabs";

// Production refresh: keep expanded Repair Board assignment controls de-duplicated.
export default function RepairBoardPage() {
  return (
    <>
      <style>{`
        .${s.page} { background: #fff; }
        .${s.stack}>section:nth-child(2) { order: -1; }
        .${s.openRow} select[aria-label^="Assign Unit"] { display: none !important; }
        .${s.unitFacts}:has(> div > select) { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        .${s.unitFacts} > div:has(> select) { display: none !important; }
      `}</style>
      <div className="board-module-tabs"><ModuleTabs module="shop" /></div>
      <RepairBoardSelfAssignPanel />
      <RepairBoardDashboard />
    </>
  );
}
