import type { ReactNode } from "react";

const annualPrintCss = `
@media print {
  .annual-title { padding: 8px !important; font-size: 13px !important; }
  .annual-title small { font-size: 6.2px !important; margin-top: 2.5px !important; }
  .annual-head { font-size: 7.2px !important; margin: 4px 6px 0 !important; }
  .annual-head b,
  .annual-head strong { padding: 3px 4px !important; min-height: 17px !important; }
  .annual-head b { font-size: 6.4px !important; }
  .annual-cols { margin: 5px 6px 0 !important; }
  .annual-cols .bar { font-size: 7.4px !important; padding: 3px 4px !important; }
  .annual-item {
    grid-template-columns: 1fr 40px !important;
    min-height: 18px !important;
    font-size: 7.5px !important;
    line-height: 1.12 !important;
  }
  .annual-item span,
  .annual-item b { padding: 3.5px 4px !important; }
  .remarks {
    margin: 5px 6px 0 !important;
    grid-template-columns: 76px 1fr !important;
    font-size: 6.8px !important;
    min-height: 32px !important;
  }
  .remarks > b,
  .remarks > div { padding: 4px !important; }
  .cert { margin: 4px 6px 0 !important; font-size: 6.4px !important; padding: 5px !important; }
  .annual-sign { margin: 0 6px 6px !important; }
  .annual-sign > div { padding: 5px !important; font-size: 7px !important; min-height: 76px !important; }
  .annual-sign strong { margin-top: 17px !important; font-size: 8px !important; }
  .annual-sign svg { height: 68px !important; }
}
`;

export default function AnnualPrintLayout({ children }: { children: ReactNode }) {
  return <>{children}<style>{annualPrintCss}</style></>;
}
