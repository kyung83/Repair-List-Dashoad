# Current live implementation map

Use this file before changing a workflow. Replace the current implementation in place instead of adding another `v2`, `v3`, `legacy`, `original`, or enhancer unless there is a documented rollout reason.

## Cleanup phase status

The September 2026 stabilization/cleanup phase is complete as a **baseline-stability phase**: blocking regressions run before deploy, the known frozen failures are exact-name quarantined, the application build/deploy/health path is green, and unrelated production work is no longer blocked by stale assertions.

That does **not** mean all structural debt is resolved. Carry these items into deliberately scoped redesign/refactor work:

1. Live `v2`/`v3` implementation chains still exist and make future changes more expensive. They were audited and found unsafe to delete blindly; they should be collapsed one chain at a time in separate PRs.
2. DOM-coupled enhancement code still exists. Several components discover or modify controls by DOM shape, `aria-label`, option text, headings, or visible copy. Rewording or restructuring those screens can silently break the attachment logic.
3. Twelve frozen breakdown/receipt assertions remain quarantined by exact test name. They are not one kind of problem; the classification below records whether the underlying behavior was removed, moved, renamed, or actually changed.
4. Source-text regex tests remain technical debt. When a screen is intentionally changed, prefer replacing its source grep/regex assertions with behavior-level coverage rather than merely updating strings.

Keep future changes small: build UI on an existing seam in one PR; collapse a version chain, remove a DOM enhancer, or change a business contract in separate PRs.

| Area | Current implementation | Notes |
| --- | --- | --- |
| Manager Repair Board | `app/repair-board/planning-center.tsx` | Primary manager/admin workflow. Truck and trailer repairs stay separated. Attention bucket counts, filtering, and row priority use one shared matcher backed by `lib/status.ts`. Assignment, unassign and Outside Vendor are explicit React actions here; no DOM injection is needed in Planning Center. |
| Dispatch Repair Board | `app/repair-board/dashboard-v2.tsx` via `role-aware-content.tsx` | Still used for dispatch clearance and should not be deleted until Dispatch is moved deliberately. |
| Technician Shop Jobs | `app/shop/page.tsx` + `app/api/shop/route.ts` | Unit-focused technician workflow. The current maintenance checklist wrapper resolves to `maintenance-checklist-panel-v3.tsx`, which still composes `maintenance-checklist-panel-v2.tsx` and `technician-repair-tools-v2.tsx`; these versioned files are live dependencies. Preserve labor timer and parts behavior. |
| Repair Board API | `app/api/repair-board/route.ts` | Current route wrapper around Repair Board behavior. `original.ts` remains an implementation dependency until deliberately folded into one file. |
| PM / Annual setup | `app/pm-schedules/page.tsx`, `app/annual-schedules/page.tsx` | Setup/calculation screens, not the daily manager work queue. |
| Planned future repairs | `app/next-pm-repairs/page.tsx` | Adds work to the next PM or Annual. |
| Parts Desk | `app/parts-desk/page.tsx` | Daily shortages, receiving, reservations and stock work. |
| Outside Repairs | `app/outside-work/intake-v3.tsx` | Current outside-work shell. Its create flow still composes `intake-v2.tsx`; that intake uses `invoice-parser-v3.js`, which builds on `invoice-parser-v2.js` and the base parser. These are live dependencies, not removable duplicates. |
| Roadside driver report | `app/report-breakdown/page.tsx` | Driver submission form. Initial public breakdown POSTs are capped at 30 per 15 minutes per connecting IP before multipart form processing. Do not simplify this flow without an explicit scoped request. |
| Roadside driver follow-up | `app/report-breakdown/driver-followup.tsx` | Tech arrived, receipt, rolling workflow. |
| Office breakdown workflow | `app/breakdowns/page.tsx` | Diagnosis, provider/ETA, status and closeout. |
| Work Order Review | `app/work-orders/page.tsx` + `app/api/work-orders/route.ts` | Manager review/corrections before billing; approved work can hand directly to billing. |
| Invoices | `app/invoices/page.tsx` + `app/api/invoices/route.ts` | Native `invoices`, `ready`, and `settings` views. `billing-view-enhancer.tsx` was retired. `invoice-page-enhancer.tsx` remains current for payment-term/print helpers until those are replaced directly. |
| Invoice eligibility | `lib/invoice-eligibility.ts` | Work-order invoices require all repairs to be completed and manager-reviewed. |
| Unit Hub | `app/unit/page.tsx` | Universal unit lookup and cross-workflow context. Global sidebar search opens this page directly. |
| Navigation / role shell | `app/app-nav.tsx`, `app/navigation-config.ts` | Today is the first office landing destination and Find Unit is available globally. `module-tabs.tsx` is compatibility-only and renders nothing. |
| Shared repair status vocabulary | `lib/status.ts` | Use shared helpers/constants instead of adding new repair-completion aliases. |
| Production regression command | `npm test` and `scripts/build-verified.sh` | `npm test` remains the raw full suite. `build-verified.sh` runs blocking regressions before the build and keeps the 12 named frozen breakdown/receipt failures in an explicit non-blocking quarantine. The former `codex-preview=development` rendered-HTML assertion and its bare-Node Cloudflare stubs were retired because they only verified a development marker rather than production behavior. |

## Versioned file audit

Audit date: **2026-09-08**.

- Repository paths currently include **14 `v2` paths and 3 `v3` paths**.
- The versioned application files are still in live dependency chains: Dispatch uses `dashboard-v2.tsx`; Outside Repairs uses `intake-v3.tsx` -> `intake-v2.tsx` -> `invoice-parser-v3.js` -> `invoice-parser-v2.js`; the technician maintenance wrapper uses `maintenance-checklist-panel-v3.tsx`, which composes `maintenance-checklist-panel-v2.tsx` and `technician-repair-tools-v2.tsx`.
- The remaining `v2` names belong to the Parts Inventory v2 rollout: migrations `0092`-`0094`, the internal deployment-health route, its D1 scenario/test assets, and the pull-request validation workflow. Migration filenames are schema history and must not be deleted as duplicate code.
- Result: **nothing is safely deletable by filename alone, but the version chains remain unresolved structural debt**. Collapse or rename them only in deliberately scoped refactors that update all live imports, routes, tests, and operational references together.

## DOM-coupled enhancement debt

Audit date: **2026-09-08**.

The following eight app components currently use DOM discovery/mutation patterns of the same general class as the retired billing enhancer; several inspect visible text, option text, headings, labels, or `aria-label` values to find the controls they augment:

- `app/invoices/invoice-page-enhancer.tsx`
- `app/equipment/bulk-archive-enhancer.tsx`
- `app/equipment/geotab-tracking-enhancer.tsx`
- `app/repair-board/repair-card-outside-vendor.tsx`
- `app/repair-board/repair-board-unassign.tsx`
- `app/shop/found-repair-control.tsx`
- `app/outside-work/ai-reading-bridge.tsx`
- `app/admin/geotab-review/health/page.tsx`

Do not remove these blindly. When the owning screen is redesigned, move the behavior into explicit React props/state/actions and retire the DOM attachment in a separate, testable PR. Avoid adding new visible-copy selectors.

## Regression quarantine review

- Review date: **2026-10-15**.
- Owner: **Repair Dashboard maintainers**.
- Scope: review all 12 exact-name frozen breakdown/receipt exemptions in `scripts/build-verified.sh` and remove each exemption as soon as its frozen workflow is deliberately repaired or the assertion is no longer valid.
- Guardrail: quarantine applies by exact test name, not by test file. Every other assertion in those files remains blocking, including new public-endpoint or rate-limiting coverage added to `tests/roadside-public-access.test.mjs`.

### Quarantined assertion classification

| Quarantined assertion | Current classification | October review decision |
| --- | --- | --- |
| `reported breakdowns are claimed into diagnostics instead of showing a separate diagnostics advance button` | **Brittle source-text assertion; behavior still exists.** The test looks for exact `row.*` JSX strings. The current page still exposes `Claim Breakdown` for an unclaimed selected breakdown inside the diagnosis flow. | Replace with behavior/helper coverage; do not reintroduce old JSX merely to satisfy the regex. |
| `driver second screen has exactly Tech Has Arrived, Upload Receipt, and one combined Repair Finished Rolling control` | **Mixed: workflow intent still exists; picker assertion is obsolete.** The three driver actions remain, but the hidden-input/ref-click picker expected by this test was replaced by a native visible file input. | Keep the three-action behavior contract if still desired; rewrite the picker portion around the native control. |
| `driver receipt keeps the existing picker behavior and does not rewrite input files` | **Superseded picker implementation.** The old `receiptInputRef.current?.click()` pattern is no longer the live picker. | Retire/update the old picker assertion unless the hidden programmatic picker is intentionally restored. |
| `driver receipt photos are resized before the POST request` | **Removed feature, not a never-built design.** Receipt resize/compression landed in `90d77531` and was explicitly removed in `043f542d` (`Make driver receipt upload-only`). | Decide whether client-side compression should return. Restore behavior + test, or retire the assertion. |
| `driver receipt upload handles non-json and iPhone pattern errors safely` | **Partially removed receipt behavior.** Generic response-text/413 handling remains, while special iPhone-pattern handling and the old "uploaded and read" path were removed with the upload-only change. | Define the desired mobile error contract, then test that behavior directly. |
| `breakdown provider UI has one provider workflow with add-provider fields` | **Brittle wording/source assertion; workflow still exists.** The single provider search/add flow remains, but labels changed (for example `Company Name` became `Company`). | Replace visible-copy regexes with provider-selection/add behavior coverage. |
| `browser breakdown card allows managers to change the repair type in diagnostics` | **Brittle wording/source assertion; edit behavior still exists.** The current diagnosis UI uses `Our Repair Category` / `Save Our Diagnosis` and still PATCHes the repair-type endpoint. | Test the diagnosis save contract rather than exact labels/variable names. |
| `repair type update validates the category and keeps the linked repair title synchronized` | **Actual contract/model change.** The live route no longer uses the old static `REPAIR_CATEGORIES.has(...)` / `repair_category` contract; it requires category + notes, writes `repair_needed`, and synchronizes the linked repair title/description. | Product/contract decision required: keep the current diagnosis model and rewrite the test, or deliberately restore static-category validation. |
| `driver receipt still prepares and compresses the selected image after native selection` | **Removed feature.** The native picker landed while compression existed; compression was then explicitly removed by `043f542d`. | Same decision as the resize test: restore compression or retire this assertion. |
| `Repair Board handoff removes active outside vendor work from the shop board` | **Behavior still exists; UI implementation moved.** The Repair Board API still filters `Outside - Waiting on...` statuses, but the old test also expects `OutsideVendorTransferPanel` wiring from the former board page. The current page is role-aware and manager actions live in Planning Center. | Rebuild coverage around Repair Board API filtering + current Planning Center outside-vendor action. |
| `public breakdown submission rejects cross-site browser posts` | **Security mechanism changed; protection remains.** The old assertion expected Origin equality. The live POST rejects `Sec-Fetch-Site: cross-site` before rate limiting/form parsing. | Replace source regex with a request-level test that verifies cross-site requests receive 403. |
| `breakdown page loads only the breakdown state directory and auto-fills company and phone` | **Brittle source-format assertion; behavior remains.** The page still requests providers with state (and optional city), and selecting a provider fills name + phone; the regex expects older spacing/exact source text. | Replace with behavior-level provider query/selection coverage. |

## Test migration rule for redesign work

Source-text tests were useful during rapid iteration but should not remain the primary contract for screens being redesigned. In particular, do not keep fixing tests such as `planning-center-workflow.test.mjs` by changing one expected label after another.

When touching a screen:

1. Extract pure decision logic where practical (bucket classification, allowed actions, href construction, payload construction).
2. Test those functions or request/response behavior directly.
3. Use source-text assertions only for narrow structural invariants that cannot reasonably be exercised another way.
4. Change UI wording independently from behavior tests.
5. Keep version-chain collapse, DOM-enhancer retirement, and business-logic changes in separate PRs from the visible redesign whenever possible.

## Change rule

When touching an area above:

1. Confirm the listed file is still the live implementation.
2. Prefer editing/replacing it directly.
3. Remove a superseded enhancer/version in the same change only when its replacement is complete and parity is verified.
4. Add/update behavior-level tests for the workflow being changed.
5. Update this file if the live implementation or deferred-debt status changes.