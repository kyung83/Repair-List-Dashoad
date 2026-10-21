# Norlow Fleet Operations

Standalone Cloudflare application for repairs, direct Geotab DVIR synchronization, PM/equipment visibility, and parts inventory.

## Architecture

- Cloudflare Worker and vinext application
- D1 as the source of truth for repairs, equipment, PM status, DVIR cache, parts, vendors, and repair-part usage
- R2 for future repair attachments and inventory documents
- Direct MyGeotab API integration; no Google Apps Script dependency
- Geotab imports remain paused until service-account permissions are verified and dashboard access control is enabled

## Dedicated Geotab service account

An administrator must save a **non-personal, limited-permission MyGeotab service account** under
**Setup Center → Geotab Connection** (`/admin/geotab-review/connection`).
Its password is encrypted in the Cloudflare D1 `geotab_runtime_credentials` table using
`GEOTAB_CONFIG_PRIVATE_KEY` or `AUTH_BOOTSTRAP_TOKEN` (Worker secret).

All DVIR, GPS, yard, mileage, device, photo, repair-certification and diagnostic calls
use the same saved account and encrypted shared session. The old `GEOTAB_USERNAME`/
`GEOTAB_PASSWORD` deployment bindings and bundled encrypted login are never used
as fallbacks; the retired personal `jtomaski` username is rejected. Deployment
will not publish the new Worker unless a dedicated account record exists in remote D1.
This preflight validates the account name and presence, not its Geotab permissions.
Check the Geotab Connection panel to verify live authentication and permissions before
disabling or deleting a prior account. Never commit credentials or fleet data to this repository.

## Inventory

The `/inventory` workspace supports parts, stock levels, reorder thresholds, costs, locations, preferred vendors, and stock adjustment. The API also supports applying a part to a repair, which records repair usage and decrements available stock transactionally.

## Private data migration

Existing Google Sheet repair and inventory records must be loaded directly into D1 through an authenticated administrative import or Wrangler command. They must not be stored in repository migration files because this repository is public.
