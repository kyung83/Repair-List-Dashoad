import type {ReactNode} from "react";
import ManagerWorkOrderCorrections from "./manager-corrections";

export default function WorkOrdersLayout({children}:{children:ReactNode}){
  return <>
    <div style={{background:"#f3f5f7",padding:"20px 34px 0"}}><ManagerWorkOrderCorrections/></div>
    {children}
  </>;
}
