import type { ReactNode } from "react";
import YardAssignments from "./yard-assignments";

export default function UsersLayout({children}:{children:ReactNode}){
  return <>{children}<YardAssignments /></>;
}
