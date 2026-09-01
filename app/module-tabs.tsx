import type { ModuleName } from "./navigation-config";

// The collapsible application sidebar is now the single navigation system.
// Keep this compatibility component temporarily because older pages still import it;
// rendering nothing prevents duplicate nested navigation while those imports age out.
export default function ModuleTabs({ module: _module }: { module: ModuleName }) {
  return null;
}
