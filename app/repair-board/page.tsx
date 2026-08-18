import RepairBoardDashboard from "./dashboard-v2";
import RepairBoardSelfAssignPanel from "./self-assign-panel";
import s from "./repair-board.module.css";
import ModuleTabs from "../module-tabs";

export default function RepairBoardPage() {
  return (
    <>
      <style>{`
        .${s.page} { background: #fff; }
        .${s.stack}>section:nth-child(2) { order: -1; }
      `}</style>
      <div className="board-module-tabs"><ModuleTabs module="shop" /></div>
      <RepairBoardSelfAssignPanel />
      <RepairBoardDashboard />
    </>
  );
}
