import ModuleTabs from "../module-tabs";

export default function DiagnosticsTabs() {
  return (
    <div style={{ background: "#f3f5f7", padding: "26px clamp(16px,4vw,46px) 0" }}>
      <ModuleTabs module="diagnostics" />
    </div>
  );
}
