import type { ReactNode } from "react";
import DispatchBreakdownAccessStyle from "./dispatch-access-style";

export default function BreakdownsLayout({children}:{children:ReactNode}){
  return <><DispatchBreakdownAccessStyle />{children}</>;
}
