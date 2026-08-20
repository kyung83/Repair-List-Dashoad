import type { ReactNode } from "react";
import BillingViewEnhancer from "./billing-view-enhancer";
import InvoicePageEnhancer from "./invoice-page-enhancer";

export default function InvoicesLayout({children}:{children:ReactNode}){
  return <>{children}<BillingViewEnhancer/><InvoicePageEnhancer/></>;
}
