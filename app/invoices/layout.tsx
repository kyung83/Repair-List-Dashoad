import type { ReactNode } from "react";
import InvoicePageEnhancer from "./invoice-page-enhancer";

export default function InvoicesLayout({children}:{children:ReactNode}){
  return <>{children}<InvoicePageEnhancer/></>;
}
