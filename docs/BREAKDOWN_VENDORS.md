# Breakdown vendor directory

Entry: **Setup Home -> Breakdown & Operations -> Breakdown Vendors** (`/breakdown-vendors`). The route is registered under Setup for navigation highlighting but does not add a visible sidebar item. It is not an Inventory or Outside Work vendor master.

## Live implementation

- `app/breakdown-vendors/page.tsx`: native React directory, search/pagination, add/edit form, and confirmed archive/restore/delete controls.
- `app/api/breakdown-vendors/route.ts`: manager/admin-only management API. Dispatch-access accounts, mechanics, viewers, and unauthenticated requests cannot manage or read this directory. Cross-site writes are rejected.
- `lib/breakdown-vendors.ts`: validation, version-checked writes, duplicate safeguards, historical-use protection, and audit.
- `migrations/0149_breakdown_vendor_management.sql`: change log only. Existing directory and breakdown rows are not migrated or rewritten.
- `tests/breakdown-vendor-management.test.mjs`: behavior tests using SQLite queries, endpoint permission checks, React control interaction, Setup placement, and existing provider-picker integration.

## Data contracts

The directory edits the existing `roadside_service_providers` table. The existing state-scoped `/api/breakdown-service-providers` lookup is unchanged and reads active entries from that same table. Additions and corrections are available on the next provider lookup; a list already loaded on another screen must be searched/reloaded again.

Company name, city, and a two-letter state/province are required. Phone and ZIP/postal code are optional. Distinct locations remain separate. Matching normalized identities are rejected with instructions to edit or restore the existing entry rather than silently creating or reactivating it.

Archive removes an entry from subsequent active lookups; it does not remove historical snapshots. Edit preserves the directory ID and active/archived state. Restore is explicit. Permanent deletion requires confirmation, an archived entry, a current version, and no matching breakdown history; these predicates are checked again inside the database mutation.

Historical breakdowns store provider name/phone snapshots, not directory IDs. Historical-use detection is therefore conservative: matching current or formerly saved names OR phone numbers protect an entry. A shared brand name or phone can protect multiple locations. This is not an exact count of jobs performed by that directory ID. Unmatched legacy spellings are not treated as proven references. No directory action changes breakdown snapshots, invoices, repairs, or costs, including when a directory entry is deleted.

Edits, archives, restores, and deletions save the prior identity and actor in `roadside_vendor_change_log` in the same transaction as the mutation. Prior names/phones remain part of the history check even after renaming. The log deliberately has no foreign key to the directory so an explicitly deleted unused entry retains its audit. Actor references use `app_users`, not a separate users table.

The original add-provider-during-breakdown endpoint retains its existing behavior, including restoring an exact existing entry when explicitly re-added. This change does not redesign that workflow.
