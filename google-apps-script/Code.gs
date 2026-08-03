/**
 * NORLOW REPAIR DASHBOARD CONNECTOR
 * Deploy as a Google Apps Script Web App from the spreadsheet project.
 * The spreadsheet remains the source of truth.
 */

const REPAIR_SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('REPAIR_SPREADSHEET_ID');
const DASHBOARD_API_TOKEN = PropertiesService.getScriptProperties().getProperty('DASHBOARD_API_TOKEN');
const REPAIR_SHEET = 'Repair List';
const DVIR_SHEET = 'DVIR Defects';
const PM_SHEET = "Truck PM'S";
const EQUIPMENT_SHEET = 'Equipment Info';

function doGet(e) {
  try {
    if (!dashboardAuthorized_((e && e.parameter && e.parameter.token) || '')) return json_({ ok: false, error: 'Unauthorized' });
    const action = String((e && e.parameter && e.parameter.action) || 'dashboard');
    if (action !== 'dashboard') return json_({ ok: false, error: 'Unknown action' });
    return json_(getDashboardData_());
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!dashboardAuthorized_(body.token || '')) return json_({ ok: false, error: 'Unauthorized' });
    if (body.action === 'markRepaired') return json_(markDashboardDefectRepaired_(body));
    if (body.action === 'saveRepair') return json_(saveRepair_(body));
    if (body.action === 'completeRepair') return json_(completeRepair_(body));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error) });
  }
}

function getDashboardData_() {
  if (!REPAIR_SPREADSHEET_ID) throw new Error('Set REPAIR_SPREADSHEET_ID in Apps Script Properties.');
  const ss = SpreadsheetApp.openById(REPAIR_SPREADSHEET_ID);
  return {
    repairs: readRepairs_(ss.getSheetByName(REPAIR_SHEET)),
    dvir: readDvir_(ss.getSheetByName(DVIR_SHEET)),
    pm: readPm_(ss.getSheetByName(PM_SHEET)),
    equipment: readEquipment_(ss.getSheetByName(EQUIPMENT_SHEET)),
    updatedAt: new Date().toISOString(),
    preview: false
  };
}

function readRepairs_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getDisplayValues();
  return rows.map(function(row, index) {
    return { id: 'repair-' + (index + 2), unit: row[0], issue: row[1], parts: row[2], status: row[4], driver: row[5], location: row[6] };
  }).filter(function(item) { return item.unit && item.issue; });
}

function saveRepair_(body) {
  if (!REPAIR_SPREADSHEET_ID) throw new Error('Repair spreadsheet is not configured');
  const sheet = SpreadsheetApp.openById(REPAIR_SPREADSHEET_ID).getSheetByName(REPAIR_SHEET);
  if (!sheet) throw new Error('Repair List sheet not found');
  const values = [
    String(body.unit || '').trim(),
    String(body.issue || '').trim(),
    String(body.parts || '').trim(),
    new Date(),
    String(body.status || 'New').trim(),
    String(body.driver || '').trim(),
    String(body.location || '').trim()
  ];
  if (!values[0] || !values[1]) throw new Error('Unit and repair needed are required');
  const match = String(body.id || '').match(/repair-(\d+)/);
  const row = match ? Number(match[1]) : Math.max(2, sheet.getLastRow() + 1);
  sheet.getRange(row, 1, 1, 7).setValues([values]);
  return { ok: true, id: 'repair-' + row };
}

function completeRepair_(body) {
  const match = String(body.id || '').match(/repair-(\d+)/);
  if (!match) throw new Error('Repair row not found');
  const sheet = SpreadsheetApp.openById(REPAIR_SPREADSHEET_ID).getSheetByName(REPAIR_SHEET);
  if (!sheet) throw new Error('Repair List sheet not found');
  sheet.getRange(Number(match[1]), 5).setValue('Completed');
  return { ok: true, id: body.id };
}

function readDvir_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getDisplayValues();
  return rows.map(function(row, index) {
    return {
      id: 'dvir-' + (index + 2), asset: row[0], driver: row[1], defect: row[2], comments: row[3],
      photos: extractLink_(sheet.getRange(index + 2, 5)) || row[4], repaired: String(row[5]).toUpperCase() === 'TRUE',
      logId: row[6], defectId: row[7]
    };
  }).filter(function(item) { return item.asset && item.defect; });
}

function readPm_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getDisplayValues();
  return rows.map(function(row) {
    const lastType = row[5] ? '20B' : row[3] ? '20A' : row[1] ? '40' : '';
    const lastMileage = row[5] || row[3] || row[1];
    return { unit: row[0], pmType: lastType, status: lastMileage ? 'Last PM: ' + lastMileage + ' mi' : '', driver: '', location: '' };
  }).filter(function(item) { return item.unit; });
}

function readEquipment_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getDisplayValues();
  const result = [];
  rows.forEach(function(row) {
    if (row[0]) result.push({ unit: row[0], serviceDate: row[1], annualDate: row[2], notes: row[3], type: 'Trailer' });
    if (row[5]) result.push({ unit: row[5], serviceDate: '', annualDate: row[6], notes: '', type: 'Truck' });
  });
  return result;
}

function markDashboardDefectRepaired_(body) {
  const ss = SpreadsheetApp.openById(REPAIR_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(DVIR_SHEET);
  if (!sheet) throw new Error('DVIR Defects sheet not found');
  const row = findDvirRow_(sheet, body.logId, body.defectId, body.id);
  if (!row) throw new Error('DVIR defect row not found');

  // Update Geotab first when the existing repair function is available.
  if (typeof markDefectRepairedInGeotab_ === 'function') {
    markDefectRepairedInGeotab_(String(body.logId || ''), String(body.defectId || ''));
  }
  sheet.getRange(row, 6).setValue(true);
  return { ok: true, row: row };
}

function findDvirRow_(sheet, logId, defectId, fallbackId) {
  const rows = sheet.getRange(2, 7, Math.max(1, sheet.getLastRow() - 1), 2).getDisplayValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === String(logId || '') && rows[i][1] === String(defectId || '')) return i + 2;
  }
  const match = String(fallbackId || '').match(/dvir-(\d+)/);
  return match ? Number(match[1]) : 0;
}

function extractLink_(cell) {
  const formula = cell.getFormula();
  const match = formula && formula.match(/HYPERLINK\("([^"]+)"/i);
  return match ? match[1] : '';
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function dashboardAuthorized_(token) {
  return Boolean(DASHBOARD_API_TOKEN) && String(token) === String(DASHBOARD_API_TOKEN);
}
