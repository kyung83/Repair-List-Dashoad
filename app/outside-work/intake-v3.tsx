"use client";

import OutsideWorkIntakeV2 from "./intake-v2";
import AiReadingBridge from "./ai-reading-bridge";
import LiveOutsideRepairs from "./live-outside-repairs";
import ExistingRepairInvoiceBridge from "./existing-repair-invoice-bridge";
import VendorManager from "./vendor-manager";

export default function OutsideWorkIntakeV3(){
  return <div data-outside-work-ai-enabled="true">
    <style>{`
      [data-outside-work-ai-enabled="true"] > main > div > header > p:last-child { display: none !important; }
      [data-outside-work-ai-enabled="true"] > main > div > header + div { display: none !important; }
    `}</style>
    <AiReadingBridge/>
    <VendorManager/>
    <LiveOutsideRepairs/>
    <ExistingRepairInvoiceBridge/>
    <OutsideWorkIntakeV2/>
  </div>;
}
