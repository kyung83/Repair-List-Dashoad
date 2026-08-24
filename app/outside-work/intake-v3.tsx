"use client";

import OutsideWorkIntakeV2 from "./intake-v2";
import AiReadingBridge from "./ai-reading-bridge";

export default function OutsideWorkIntakeV3(){
  return <>
    <AiReadingBridge/>
    <OutsideWorkIntakeV2/>
  </>;
}
