# Northern Navistar one-click handoff (experimental)

After installing the extension in Chrome, authorized staff select an International truck on the Cloudflare **Admin / OEM Parts Lookup (Test)** screen and click **Open International Parts by VIN**. The app opens the normal Navistar VIN Catalog with only the last eight VIN characters as a temporary URL parameter. This extension runs on the official Navistar domain, removes that parameter and attempts to fill the visible VIN search field and submit Enter. If the site still requires selection of the result, select it manually.

Installation: download the folder containing manifest.json and content.js; visit chrome://extensions, enable Developer mode, Load unpacked, and select that folder. Disable the old v0.1 popup extension to avoid confusion.

Known limitations: browser redirects during sign-in may strip the parameter. Navistar may ignore synthetic Enter or change its UI. This is **not** a supported Navistar API or guaranteed one-click result. No login bypass, password or cookie access, scraping or dealer ordering. This prototype hasn't been validated live in an authenticated Navistar session. Removal requires only removing the extension. Only install if permitted by your company and Navistar's site rules.
