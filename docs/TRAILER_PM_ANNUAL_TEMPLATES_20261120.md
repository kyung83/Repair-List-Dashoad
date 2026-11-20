# Dedicated Trailer PM / Trailer Annual checklists

Created 2026-11-20 from the existing default templates and the Federal Motor Carrier Safety Regulations, 49 CFR 396.17 and Appendix A to Part 396.

## Scope

- **Trailer PM:** 39 inspection/service items across 7 sections (previous generic PM: 86). Designed for dry vans, with explicit N/A options for equipment not fitted and flatbed, step-deck, and Conestoga differences.
- **Trailer Annual:** 40 safety inspection items across 10 sections (previous general annual: 49). Includes brakes and brake stroke, ABS, trailer coupling, lighting, loading, suspension, frame/sliders, tires, wheels, and *rear impact guard*, including age/type exemptions where applicable.
- **Truck** PM and Annual remain assigned to `default`, without edits to the default templates.
- New template keys: `trailer-service` (PM v1) and `trailer-annual-dot` (Annual v1). New trailer inspections use them when the assignments were still `default` at migration time.
- Existing `maintenance_checklist_runs` and `maintenance_checklist_items` are **unchanged**; started and completed inspections retain their snapshot. No maintenance history, labor, cost, parts, or due-date modifications.
- If a manager changed the trailer assignments away from `default` before deployment, migration intentionally leaves their selection alone.

## Annual regulatory coverage

The Annual is a guide for a **qualified inspector**, not a substitute for inspector qualifications, measurement and pass/fail decisions. It covers trailer-applicable items from Appendix A to Part 396, especially brake checks, couplers, lighting, safe loading, suspension, frame, tires, wheels, and rear impact guards. The inspector should mark N/A *only* when equipment is absent or an explicit exemption applies, and should document that determination. Completion and inspector sign-off continue through the existing Annual workflow.

Authoritative resources: https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/section-396.17 and https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-396/appendix-Appendix%20A%20to%20Part%20396.

## Why these are separate

A PM and an Annual can both involve brakes, lights and tires. This is intentional and doesn't automatically transfer an earlier PASS response to an Annual: the Annual must be separately inspected, documented and signed. No existing mechanic or manager workflow is replaced.
