import type { ReactNode } from "react";

const annualPrintCss = `
/* Annual inspection only: use the landscape sheet instead of shrinking the form.
   PM print sizing remains unchanged because every selector is anchored to the
   Annual title that only exists on the annual report. */
.sheet:has(.annual-title) .annual-title {
  padding: 9px 8px !important;
  font-size: 16px !important;
  line-height: 1.05 !important;
}
.sheet:has(.annual-title) .annual-title small {
  font-size: 7.4px !important;
  margin-top: 3px !important;
  letter-spacing: .01em;
}
.sheet:has(.annual-title) .annual-head {
  margin: 6px 7px 0 !important;
  font-size: 8.25px !important;
}
.sheet:has(.annual-title) .annual-head b,
.sheet:has(.annual-title) .annual-head strong {
  min-height: 22px !important;
  padding: 4px 6px !important;
}
.sheet:has(.annual-title) .annual-head b {
  font-size: 7.2px !important;
}
.sheet:has(.annual-title) .h2 {
  grid-template-columns: 82px 1fr 82px 1.65fr !important;
}
.sheet:has(.annual-title) .h4 {
  grid-template-columns: 64px .8fr 48px 1.35fr 50px .8fr 44px .65fr !important;
}
.sheet:has(.annual-title) .annual-cols {
  margin: 7px 7px 0 !important;
}
.sheet:has(.annual-title) .annual-cols .bar {
  font-size: 8px !important;
  line-height: 1.1 !important;
  padding: 4px 5px !important;
}
.sheet:has(.annual-title) .annual-item {
  grid-template-columns: 1fr 48px !important;
  min-height: 27px !important;
  font-size: 8.4px !important;
  line-height: 1.12 !important;
}
.sheet:has(.annual-title) .annual-item span,
.sheet:has(.annual-title) .annual-item b {
  padding: 5px 6px !important;
  display: flex;
  align-items: center;
}
.sheet:has(.annual-title) .annual-item b {
  justify-content: center;
  font-size: 8.2px !important;
}
.sheet:has(.annual-title) .remarks {
  margin: 7px 7px 0 !important;
  grid-template-columns: 92px 1fr !important;
  min-height: 50px !important;
  font-size: 8px !important;
}
.sheet:has(.annual-title) .remarks > b,
.sheet:has(.annual-title) .remarks > div {
  padding: 6px !important;
}
.sheet:has(.annual-title) .remarks > div {
  gap: 3px !important;
}
.sheet:has(.annual-title) .cert {
  margin: 5px 7px 0 !important;
  padding: 6px !important;
  font-size: 7.5px !important;
}
.sheet:has(.annual-title) .annual-sign {
  margin: 0 7px 7px !important;
  grid-template-columns: 1.55fr .75fr !important;
}
.sheet:has(.annual-title) .annual-sign > div {
  min-height: 96px !important;
  padding: 6px !important;
  font-size: 8px !important;
}
.sheet:has(.annual-title) .annual-sign strong {
  margin-top: 22px !important;
  font-size: 9px !important;
}
.sheet:has(.annual-title) .annual-sign svg {
  height: 76px !important;
}

@media print {
  .sheet:has(.annual-title) {
    min-height: 8.12in !important;
  }
}
`;

export default function AnnualPrintLayout({ children }: { children: ReactNode }) {
  return <>{children}<style>{annualPrintCss}</style></>;
}
