# Authoritative Geotab roster — 2026-08-20

This note records the fleet policy used by migration `0083_authoritative_geotab_roster.sql`.

- Tracked semis: 283 approved master-list units.
- GPS trailers: 599 approved units: 60 three-digit trailers named `TRL ###` with a space, plus 539 five-digit trailers using the bare number.
- Company cars/vehicles remain unchanged by the roster cleanup.
- Master Equipment is authoritative. Geotab supplies telemetry only after an explicit current `equipment_geotab_devices` assignment exists.
- Non-roster tracked semis and Geotab-linked trailers are archived, not deleted, so repair and maintenance history remains available.
- Manual trailers without a Geotab identity remain available and are not removed by this cleanup.
- Future equipment can opt into Geotab mileage using the Master Equipment device picker; untracked equipment remains manual.
