import RepairBoardDashboard from "./dashboard-v2";
import s from "./repair-board.module.css";

export default function RepairBoardPage() {
  return (
    <>
      <style>{`.${s.stack}>section:nth-child(2){order:-1}`}</style>
      <RepairBoardDashboard />
    </>
  );
}
