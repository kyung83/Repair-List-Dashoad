# Geotab GPS / Yard Reliability Pilot

Status: **Phase 2 — Shadow Mode**

## Objective

Provide a structured location result for every active, correctly mapped Northern equipment unit even when Geotab does not return a fresh observation in a given request. The application-level target is near-continuous result availability; freshness is measured separately.

The pilot does **not** promise that every physical Geotab device is always online. A missing upstream response changes freshness/health status, not equipment existence.

## Hard invariants

1. **Missing upstream data never erases last-known-good operational data.**
2. **Telemetry never creates, infers, repairs, or guesses an equipment-to-Geotab identity.** Only a current row in `equipment_geotab_devices` authorizes telemetry writes.
3. **Every active, mapped, unarchived, unmerged equipment row has one structured shadow-state row.**
4. **Only newer valid observations may replace known GPS observations.**
5. **A partial or degraded fleet response must not cascade into fleet-wide unknown locations.**
6. **Lease expiry is controlled only by `locked_until`.** `heartbeat_at` is informational; a heartbeat extends `locked_until`.
7. **Operational storage is bounded.** D1 stores current/last-known-good state, not permanent GPS history.

## Storage model

### `geotab_unit_state`

One current/last-known-good row per equipment record. Stores device identity consumed from the mapping table, latest valid GPS observation, communication state, resolved yard, and timestamps.

This table is bounded by fleet size and does not grow with GPS reporting frequency.

### `geotab_sync_leases`

One row per pipeline. The GPS pilot uses `gps-shadow`.

A run may acquire the lease only if it is expired or already owned by the same run. Healthy runs extend `locked_until` while working. Crashed runs recover automatically after expiry.

### `geotab_sync_runs`

Operational diagnostics only. Rows older than 90 days are removed and a database trigger caps the table at 5,000 rows.

### `geotab_yard_zones`

Yard definitions begin from the existing configured display names. The first successful exact-name discovery pins the Geotab zone ID. Future resolution prefers that ID so a display-name change does not silently break yard assignment.

### `geotab_feed_cursors`

Reserved for later `GetFeed` rollout. GPS shadow mode currently proves the reliability contract before feed-based ingestion is introduced.

## Shadow-mode data flow

1. Acquire the `gps-shadow` lease.
2. Load the expected active fleet strictly from current `equipment_geotab_devices` assignments.
3. Run a cheap API/authentication canary.
4. Fetch current `DeviceStatusInfo` and yard zones.
5. Compare returned expected devices with the expected mapped fleet.
6. Trip the circuit breaker when response completeness is abnormally low.
7. For each expected unit:
   - accept a new GPS position only when valid and newer than the stored observation;
   - calculate the yard from pinned/resolved zones;
   - preserve the prior state when the current cycle omits the device;
   - preserve the prior yard when yard-zone configuration is incomplete;
   - retain communication/freshness status separately from location existence.
8. Write only changed state rows.
9. Compare the shadow yard with the legacy `equipment.current_yard` result.
10. Record run health and categorized differences.
11. Release the lease.

## Shadow comparison categories

- **Equivalent** — legacy and shadow yard agree.
- **Improvement** — legacy is blank but shadow retains/resolves a yard.
- **Regression** — legacy has a yard but shadow has none. This blocks health from being considered clean and requires review before cutover.
- **Changed** — both systems have a yard but disagree.

Shadow mode is intentionally read-only with respect to technician routing. The legacy yard writer still controls Shop and Repair Board access until the pilot is reviewed and approved for cutover.

## Freshness model

Initial pilot thresholds are intentionally conservative and may be tuned from observed production cadence.

Non-trailer assets:
- `LIVE`: GPS observation <= 15 minutes old
- `RECENT`: <= 60 minutes old
- `STALE`: older than 60 minutes

Trailers:
- `LIVE`: <= 60 minutes old
- `RECENT`: <= 6 hours old
- `STALE`: older than 6 hours

`NO_DATA` means no valid GPS observation has ever been safely associated with the current mapped device.

## Circuit breaker

The pilot preserves last-known-good state rather than promoting a suspiciously incomplete response. Initial guard:

- at least 20 expected mapped units; and
- fewer than 50% of expected device statuses returned.

The threshold is deliberately conservative for the shadow period. Production telemetry collected during the pilot should determine a tighter final threshold before cutover.

## Identity policy

The GPS pipeline consumes `equipment_geotab_devices WHERE current = 1`.

If an active equipment record has a legacy Geotab ID but lacks a clean current assignment, it is counted as an identity health error. GPS ingestion does not repair that relationship and does not guess from unit number, VIN, or prior telemetry.

## Storage retention

- Current unit state: retained indefinitely as a single overwritten row per equipment item.
- Geotab historical GPS: remains in Geotab; not cloned into D1.
- Sync-run diagnostics: 90-day retention plus 5,000-row hard cap.
- Feed cursors and leases: fixed-size control tables.

## Health presentation

No separate daily dashboard is required.

- Managers/admins receive a compact Geotab health indicator in the existing application header.
- Detailed GPS shadow health is embedded in the existing **Admin → Geotab Review** page.
- The health panel exposes structured coverage, freshness, offline devices, identity issues, shadow-vs-legacy improvements/regressions, last run status, and pinned zone IDs.

Healthy operation should require no routine review. Attention is surfaced only when the integration needs investigation.

## Rollout phases

### Phase 1 — Foundation

Schema, bounded storage, common client, lease, result contract, identity invariant, circuit breaker, and health reporting.

### Phase 2 — Shadow Mode

Run the new GPS/yard engine beside the legacy sync. Do not change Shop routing. Categorize differences as equivalent, improvement, regression, or changed.

### Phase 3 — Prove It

Observe normal driving, parked units, overnight behavior, yard transitions, offline devices, API errors, zone changes, and missing device responses. Review all regressions and unexplained changed-yard results.

### Phase 4 — Cutover

Only after shadow results are accepted:

1. change Shop/Repair Board yard reads to the reliability state;
2. stop the legacy clear-then-repopulate writer in the same controlled release;
3. retain last-known-good/freshness semantics in the operational UI.

### Phase 5 — Expand

Reuse the proven reliability framework for odometer, DVIR, and other mission-critical Geotab-derived data. Do not create separate one-off reliability models.

## Acceptance criteria before cutover

1. Every active, current-mapped unit produces a structured result.
2. Omitting a known unit from a simulated/current response never erases its known yard.
3. Unknown or ambiguous telemetry never creates or changes an equipment mapping.
4. Two simultaneous GPS runs result in one lease owner; a crashed owner becomes recoverable after expiry.
5. Heartbeats extend `locked_until`; `heartbeat_at` never independently grants ownership.
6. Reprocessing the same observation is idempotent.
7. An older GPS observation cannot overwrite a newer stored observation.
8. A partial response preserves prior state for unresolved units.
9. A fleet-wide abnormal response trips the circuit breaker and preserves last-known-good state.
10. API/auth failure is distinguishable from an individual device being stale/offline.
11. Yard-zone IDs are pinned and used after initial discovery.
12. Result coverage and telemetry freshness are reported separately.
13. Diagnostic storage remains bounded under sustained operation.
14. GPS, odometer, DVIR, and other future pipelines use independent leases.
15. Shadow-mode regressions are reviewed and resolved before any technician-facing cutover.

## Explicitly not included in the current shadow pilot

- `GetFeed` GPS ingestion and persisted feed-cursor advancement.
- Technician/Shop reads from `geotab_unit_state`.
- Removal of the legacy yard writer.
- Odometer reliability pipeline.
- DVIR reliability pipeline.

Those items follow only after the GPS/yard shadow contract proves reliable in production.
