# Norlow Repair Dashboard

Fleet repair software backed by the **Repair Dashboad code** Google Sheet.

## Included

- Open repair list
- DVIR defect cards, comments, photos, and mark-repaired action
- PM status
- Truck and trailer equipment lookup
- Global search and responsive mobile layout
- Google Apps Script connector that keeps credentials out of GitHub

## Connect the live Google Sheet

1. Open the Google Sheet and choose **Extensions → Apps Script**.
2. Add `google-apps-script/Code.gs` to the existing Apps Script project. Keep the existing Geotab functions in the same project.
3. In **Project Settings → Script Properties**, add `REPAIR_SPREADSHEET_ID` with the spreadsheet ID from the sheet URL.
4. Deploy the Apps Script project as a Web App that executes as the owner. Choose the narrowest access setting that works for your company; this repository does not make that choice automatically.
5. Set the deployed URL as the hosted app's `SHEET_API_URL` environment variable.

Until the connector URL is configured, the dashboard clearly displays preview data.
