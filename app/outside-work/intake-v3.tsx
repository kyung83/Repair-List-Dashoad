"use client";

import OutsideWorkIntakeV2 from "./intake-v2";
import AiReadingBridge from "./ai-reading-bridge";

export default function OutsideWorkIntakeV3(){
  return <div data-outside-work-ai-enabled="true">
    <style>{`
      [data-outside-work-ai-enabled="true"] > main > div > header > p:last-child { display: none !important; }
      [data-outside-work-ai-enabled="true"] > main > div > header + div { display: none !important; }
    `}</style>
    <AiReadingBridge/>
    <OutsideWorkIntakeV2/>
  </div>;
}
