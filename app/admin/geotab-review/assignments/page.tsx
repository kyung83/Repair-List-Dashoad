"use client";

import { useState } from "react";
import GeotabAssignmentRepairPanel from "../assignment-repair-panel";
import GeotabDeviceReleasePanel from "../device-release-panel";

export default function GeotabAssignmentsPage() {
  const [version, setVersion] = useState(0);
  return <>
    <GeotabDeviceReleasePanel onReleased={() => setVersion(current => current + 1)} />
    <GeotabAssignmentRepairPanel key={version} />
  </>;
}
