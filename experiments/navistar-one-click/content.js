(() => {
  const url = new URL(location.href);
  const vin = (url.searchParams.get("northern_vin") || "").toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{8}$/.test(vin)) return;
  // Never persist the VIN in local storage or send it to other domains.
  // Remove only our own parameter after receiving the handoff.
  url.searchParams.delete("northern_vin");
  try { history.replaceState(history.state, "", url.pathname + url.search + url.hash); } catch {}
  let attempts = 0;
  const find = () => [...document.querySelectorAll("input")].find(e =>
    /enter chassis or vin/i.test(e.placeholder || "") ||
    /chassis|vin/i.test(e.getAttribute("aria-label") || ""));
  const timer = setInterval(() => {
    const field = find();
    if (!field && ++attempts < 40) return;
    clearInterval(timer);
    if (!field) return;
    field.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, vin);
    field.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data:vin }));
    field.dispatchEvent(new Event("change", { bubbles:true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, key:"Enter", code:"Enter" }));
    field.dispatchEvent(new KeyboardEvent("keyup", { bubbles:true, key:"Enter", code:"Enter" }));
    // Do not auto-click a vehicle suggestion: the dealer may return multiple matches.
  }, 250);
})();