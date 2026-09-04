# Current live implementation map

Use this file before changing a workflow. Replace the current implementation in place instead of adding another `v2`, `v3`, `legacy`, `original`, or enhancer unless there is a documented rollout reason.

| Area | Current implementation | Notes |
| --- | --- | --- |
| Manager Repair Board | `app/repair-board/planning-center.tsx` | Primary manager/admin workflow. Truck and trailer repairs stay separated. Assignment, unassign and Outside Vendor are explicit React actions here; no DOM injection is needed in Planning Center. |
| Dispatch Repair Board | `app/repair-board/dashboard-v2.tsx` via `role-aware-content.tsx` | Still used for dispatch clearance and should not be deleted until Dispatch is moved deliberately. |
| Technician Shop Jobs | `app/shop/page.tsx` + `app/api/shop/route.ts` | Unit-focused technician workflow. Preserve labor timer and parts behavior. |
| Repair Board API | `app/api/repair-board/route.ts` | Current route wrapper around Repair Board behavior. `original.ts` remains an implementation dependency until deliberately folded into one file. |
| PM / Annual setup | `app/pm-schedules/page.tsx`, `app/annual-schedules/page.tsx` | Setup/calculation screens, not the daily manager work queue. |
| Planned future repairs | `app/next-pm-repairs/page.tsx` | Adds work to the next PM or Annual. |
| Parts Desk | `app/parts-desk/page.tsx` | Daily shortages, receiving, reservations and stock work. |
| Outside Repairs | `app/outside-work/intake-v3.tsx` | Current outside-work shell. Retire older intake/parser generations only after parity is verified. |
| Roadside driver report | `app/report-breakdown/page.tsx` | Driver submission form. Do not simplify this flow without an explicit scoped request. |
| Roadside driver follow-up | `app/report-breakdown/driver-followup.tsx` | Tech arrived, receipt, rolling workflow. |
| Office breakdown workflow | `app/breakdowns/page.tsx` | Diagnosis, provider/ETA, status and closeout. |
| Work Order Review | `app/work-orders/page.tsx` + `app/api/work-orders/route.ts` | Manager review/corrections before billing; approved work can hand directly to billing. |
| Invoices | `app/invoices/page.tsx` + `app/api/invoices/route.ts` | Native `invoices`, `ready`, and `settings` views. `billing-view-enhancer.tsx` was retired. `invoice-page-enhancer.tsx` remains current for payment-term/print helpers until those are replaced directly. |
| Invoice eligibility | `lib/invoice-eligibility.ts` | Work-order invoices require all repairs to be completed and manager-reviewed. |
| Unit Hub | `app/unit/page.tsx` | Universal unit lookup and cross-workflow context. Global sidebar search opens this page directly. |
| Navigation / role shell | `app/app-nav.tsx`, `app/navigation-config.ts` | Today is the first office landing destination and Find Unit is available globally. `module-tabs.tsx` is compatibility-only and renders nothing. |
| Shared repair status vocabulary | `lib/status.ts` | Use shared helpers/constants instead of adding new repair-completion aliases. |
| Production regression command | `npm test` and `scripts/build-verified.sh` | `npm test` remains the raw full suite. `build-verified.sh` runs blocking regressions before the build, keeps the 12 named frozen breakdown/receipt failures in an explicit non-blocking quarantine, and runs `rendered-html.test.mjs` after the build output exists. |

## Change rule

When touching an area above:

1. Confirm the listed file is still the live implementation.
2. Prefer editing/replacing it directly.
3. Remove a superseded enhancer/version in the same change when it is no longer used.
4. Add/update tests for the workflow being changed.
5. Update this file if the live implementation changes.