# Norlow Fleet Operations

Standalone Cloudflare application for repairs, direct Geotab DVIR synchronization, PM/equipment visibility, and parts inventory.

## Architecture

- Cloudflare Worker and vinext application
- D1 as the source of truth for repairs, equipment, PM status, DVIR cache, parts, vendors, and repair-part usage
- R2 for future repair attachments and inventory documents
- Direct MyGeotab API integration; no Google Apps Script dependency
- Geotab yard presence is scheduled every 10 minutes, and fleet/DVIR synchronization is scheduled every 2 hours. Successful production sync requires valid service-account credentials and the required MyGeotab permissions.
- Dashboard access control is enforced at the Worker boundary; unauthenticated application and API requests are redirected or rejected before application handlers run.

## Required encrypted Worker secrets

- `GEOTAB_DATABASE`
- `GEOTAB_USERNAME`
- `GEOTAB_PASSWORD`

Use a dedicated limited-permission MyGeotab service account. Never commit real credentials or fleet data to this public repository.

## Inventory

The `/inventory` workspace supports parts, stock levels, reorder thresholds, costs, locations, preferred vendors, and stock adjustment. The API also supports applying a part to a repair, which records repair usage and decrements available stock transactionally.

## Private data migration

Existing Google Sheet repair and inventory records must be loaded directly into D1 through an authenticated administrative import or Wrangler command. They must not be stored in repository migration files because this repository is public.
