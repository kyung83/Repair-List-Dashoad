# Navistar VIN helper (experimental, local Chrome extension)

This is a **manual, user-initiated UI helper**, not a Navistar API or an embedded parts catalog. It needs to be tested against the authenticated Navistar VIN Catalog; site changes may break its search-field detection.

## Test without changing production
1. In Chrome, open `chrome://extensions`, enable Developer mode, and select **Load unpacked**. Select this folder, not the repository root.
2. Sign in to the existing Navistar VIN Catalog at `https://oecnpc.navistar.com/npc/myportal/` in a normal tab. Do not send us your password.
3. Click the extension icon, enter the last eight VIN characters (or a full 17-character VIN), and select **Find truck in Navistar**.
4. Check whether it populates the site's Chassis/VIN search input and triggers suggestions/results. You might still need to select the matching vehicle manually.

## Security and limitations
- Requests only `activeTab` and `scripting`. It injects code into the active tab only after the user clicks the button and only if that tab is the exact Navistar domain and `/npc/` path.
- Does not access cookies, passwords, network responses or protected internal endpoints. No background script, remote server, telemetry, storage, purchasing or order submission.
- It does not remove Navistar's framing restrictions or bypass login. Use only with your authorized dealer access and in accordance with portal terms.
- Doesn't integrate with the Cloudflare unit selector yet. Enter or paste the last eight characters manually into the extension popup during this pilot.
- Rollback: disable/remove this local extension. No production or inventory changes.
