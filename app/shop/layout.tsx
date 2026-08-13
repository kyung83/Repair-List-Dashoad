import type { ReactNode } from "react";
import FindNextJob from "./find-next-job";

export default function ShopLayout({children}:{children:ReactNode}){
  return <>
    <FindNextJob />
    {children}
  </>;
}
