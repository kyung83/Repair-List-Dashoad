export function buildYardCheckGoogleScript(origin:string) {
  const apiUrl = `${origin.replace(/\/$/, '')}/api/integrations/yard-check/repair-board`;
  return `/**
 * Northern Logistics Yard Check comparison
 *
 * 1) Paste this entire file into Extensions > Apps Script in the coworker's Google Sheet.
 * 2) Save and reload the spreadsheet.
 * 3) Use Northern Yard Check > Set API Key.
 * 4) Use Northern Yard Check > Configure Yard Check Source.
 * 5) Run Refresh Comparison.
 */

const NORTHERN_REPAIR_BOARD_API = '${apiUrl}';
const NORTHERN_IMPORT_TAB = 'Repair Board Import';
const NORTHERN_COMPARE_TAB = 'Yard Check Comparison';
const NORTHERN_PROP_API_KEY = 'NORTHERN_YARD_API_KEY';
const NORTHERN_PROP_SOURCE_TAB = 'NORTHERN_YARD_SOURCE_TAB';
const NORTHERN_PROP_UNIT_HEADER = 'NORTHERN_YARD_UNIT_HEADER';
const NORTHERN_PROP_YARD = 'NORTHERN_YARD_FILTER';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Northern Yard Check')
    .addItem('Set API Key', 'setNorthernYardApiKey')
    .addItem('Configure Yard Check Source', 'configureNorthernYardCheck')
    .addSeparator()
    .addItem('Refresh Repair Board Import', 'refreshNorthernRepairBoardImport')
    .addItem('Refresh Comparison', 'refreshNorthernYardCheckComparison')
    .addSeparator()
    .addItem('Install 5-Minute Auto Refresh', 'installNorthernYardCheckAutoRefresh')
    .addItem('Remove Auto Refresh', 'removeNorthernYardCheckAutoRefresh')
    .addToUi();
}

function setNorthernYardApiKey() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Northern Yard Check API Key',
    'Paste the read-only API key generated in Northern Logistics Setup > Yard Check API.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var key = String(response.getResponseText() || '').trim();
  if (!key) throw new Error('API key cannot be blank.');
  PropertiesService.getScriptProperties().setProperty(NORTHERN_PROP_API_KEY, key);
  ui.alert('API key saved in Script Properties. It was not written into a spreadsheet cell.');
}

function configureNorthernYardCheck() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var source = ui.prompt(
    'Yard Check Source Tab',
    'Enter the exact tab name that contains the yard-check unit list.',
    ui.ButtonSet.OK_CANCEL
  );
  if (source.getSelectedButton() !== ui.Button.OK) return;
  var sourceName = String(source.getResponseText() || '').trim();
  if (!sourceName || !ss.getSheetByName(sourceName)) {
    throw new Error('That source tab was not found. Check the tab name and try again.');
  }

  var header = ui.prompt(
    'Unit Column Header',
    'Optional: enter the exact unit-number column header. Leave blank to auto-detect Unit / Truck / Trailer / Equipment / Asset.',
    ui.ButtonSet.OK_CANCEL
  );
  if (header.getSelectedButton() !== ui.Button.OK) return;

  var yard = ui.prompt(
    'Yard Filter',
    'Optional: enter clare, cadillac, gr, taylor, or boyne. Leave blank to compare all yards.',
    ui.ButtonSet.OK_CANCEL
  );
  if (yard.getSelectedButton() !== ui.Button.OK) return;
  var yardValue = String(yard.getResponseText() || '').trim().toLowerCase();
  var allowed = ['', 'clare', 'cadillac', 'gr', 'taylor', 'boyne'];
  if (allowed.indexOf(yardValue) === -1) {
    throw new Error('Yard must be blank, clare, cadillac, gr, taylor, or boyne.');
  }

  var props = PropertiesService.getScriptProperties();
  props.setProperty(NORTHERN_PROP_SOURCE_TAB, sourceName);
  props.setProperty(NORTHERN_PROP_UNIT_HEADER, String(header.getResponseText() || '').trim());
  props.setProperty(NORTHERN_PROP_YARD, yardValue);
  ui.alert('Yard Check source saved. Run Refresh Comparison next.');
}

function fetchNorthernRepairBoard_() {
  var props = PropertiesService.getScriptProperties();
  var key = String(props.getProperty(NORTHERN_PROP_API_KEY) || '').trim();
  if (!key) throw new Error('Run Northern Yard Check > Set API Key first.');
  var yard = String(props.getProperty(NORTHERN_PROP_YARD) || '').trim().toLowerCase();
  var url = NORTHERN_REPAIR_BOARD_API + (yard ? '?yard=' + encodeURIComponent(yard) : '');
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Northern-Yard-Key': key },
    muteHttpExceptions: true,
    followRedirects: true
  });
  var code = response.getResponseCode();
  var text = response.getContentText();
  var payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error('Northern Repair Board returned an unreadable response. HTTP ' + code + '.');
  }
  if (code < 200 || code >= 300) {
    throw new Error(payload.error || ('Northern Repair Board request failed. HTTP ' + code + '.'));
  }
  return payload;
}

function refreshNorthernRepairBoardImport() {
  var data = fetchNorthernRepairBoard_();
  writeNorthernImport_(data);
  SpreadsheetApp.getActive().toast(
    'Loaded ' + data.itemCount + ' open Repair Board item(s).',
    'Northern Yard Check',
    5
  );
}

function writeNorthernImport_(data) {
  var ss = SpreadsheetApp.getActive();
  var sheet = getOrCreateSheet_(ss, NORTHERN_IMPORT_TAB);
  var headers = [
    'Unit', 'Equipment Type', 'Repair Board Yard', 'Repair Type', 'Issue',
    'Status', 'Assigned To', 'Out Of Service', 'Working Now', 'Updated'
  ];
  var rows = (data.items || []).map(function(item) {
    return [
      item.unit || '',
      item.equipmentType || '',
      item.yard || '',
      item.repairType || '',
      item.issue || '',
      item.status || '',
      item.assignedTo || '',
      item.outOfService ? 'YES' : 'NO',
      item.workingNow ? 'YES' : 'NO',
      data.updatedAt || ''
    ];
  });
  replaceSheetData_(sheet, headers, rows);
}

function refreshNorthernYardCheckComparison() {
  var ss = SpreadsheetApp.getActive();
  var props = PropertiesService.getScriptProperties();
  var sourceName = String(props.getProperty(NORTHERN_PROP_SOURCE_TAB) || '').trim();
  if (!sourceName) throw new Error('Run Northern Yard Check > Configure Yard Check Source first.');
  var source = ss.getSheetByName(sourceName);
  if (!source) throw new Error('Configured Yard Check source tab no longer exists: ' + sourceName);

  var data = fetchNorthernRepairBoard_();
  writeNorthernImport_(data);

  var sourceData = source.getDataRange().getDisplayValues();
  if (!sourceData.length) throw new Error('Yard Check source tab is empty.');
  var requestedHeader = String(props.getProperty(NORTHERN_PROP_UNIT_HEADER) || '').trim();
  var unitColumn = findUnitColumn_(sourceData[0], requestedHeader);
  if (unitColumn < 0) {
    throw new Error('Could not find the unit-number column. Run Configure Yard Check Source and enter the exact column header.');
  }

  var boardMap = {};
  (data.units || []).forEach(function(row) {
    var key = normalizeUnit_(row.unit);
    if (key) boardMap[key] = row;
  });

  var sourceUnits = {};
  var output = [];
  for (var index = 1; index < sourceData.length; index += 1) {
    var rawUnit = String(sourceData[index][unitColumn] || '').trim();
    var key = normalizeUnit_(rawUnit);
    if (!key) continue;
    sourceUnits[key] = true;
    var board = boardMap[key] || null;
    output.push(comparisonRow_(rawUnit, index + 1, true, board));
  }

  Object.keys(boardMap)
    .filter(function(key) { return !sourceUnits[key]; })
    .sort(function(a, b) { return a.localeCompare(b, undefined, { numeric: true }); })
    .forEach(function(key) {
      output.push(comparisonRow_(boardMap[key].unit || key, '', false, boardMap[key]));
    });

  var compareSheet = getOrCreateSheet_(ss, NORTHERN_COMPARE_TAB);
  var headers = [
    'Unit', 'On Yard Check', 'On Repair Board', 'Repair Type(s)', 'Repair Status',
    'Repair Issue(s)', 'Assigned To', 'Repair Board Yard', 'OOS', 'Working Now', 'Yard Sheet Row'
  ];
  replaceSheetData_(compareSheet, headers, output);
  SpreadsheetApp.getActive().toast(
    'Compared ' + Object.keys(sourceUnits).length + ' yard-check unit(s) against ' + (data.unitCount || 0) + ' Repair Board unit(s).',
    'Northern Yard Check',
    6
  );
}

function comparisonRow_(unit, sourceRow, onYardCheck, board) {
  return [
    unit,
    onYardCheck ? 'YES' : 'NO',
    board ? 'YES' : 'NO',
    board ? (board.repairTypes || []).join(' / ') : '',
    board ? (board.statuses || []).join(' / ') : '',
    board ? (board.issues || []).join(' | ') : '',
    board ? (board.assignedTo || []).join(', ') : '',
    board ? (board.yard || '') : '',
    board && board.outOfService ? 'YES' : 'NO',
    board && board.workingNow ? 'YES' : 'NO',
    sourceRow || ''
  ];
}

function findUnitColumn_(headers, requestedHeader) {
  var normalized = headers.map(normalizeHeader_);
  if (requestedHeader) {
    var exact = normalized.indexOf(normalizeHeader_(requestedHeader));
    if (exact >= 0) return exact;
  }
  var candidates = [
    'UNIT', 'UNIT NUMBER', 'UNIT #', 'TRUCK', 'TRUCK NUMBER', 'TRUCK #',
    'TRAILER', 'TRAILER NUMBER', 'TRAILER #', 'EQUIPMENT', 'EQUIPMENT NUMBER',
    'EQUIPMENT #', 'ASSET', 'ASSET NUMBER', 'ASSET #'
  ].map(normalizeHeader_);
  for (var index = 0; index < candidates.length; index += 1) {
    var found = normalized.indexOf(candidates[index]);
    if (found >= 0) return found;
  }
  return -1;
}

function normalizeHeader_(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeUnit_(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function replaceSheetData_(sheet, headers, rows) {
  var oldFilter = sheet.getFilter();
  if (oldFilter) oldFilter.remove();
  sheet.clearContents();
  sheet.clearFormats();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, Math.max(1, rows.length + 1), headers.length).createFilter();
  sheet.autoResizeColumns(1, headers.length);
  var maxWidth = 280;
  for (var column = 1; column <= headers.length; column += 1) {
    if (sheet.getColumnWidth(column) > maxWidth) sheet.setColumnWidth(column, maxWidth);
  }
}

function installNorthernYardCheckAutoRefresh() {
  removeNorthernYardCheckAutoRefresh();
  ScriptApp.newTrigger('refreshNorthernYardCheckComparison')
    .timeBased()
    .everyMinutes(5)
    .create();
  SpreadsheetApp.getUi().alert('Automatic Yard Check comparison will refresh about every 5 minutes.');
}

function removeNorthernYardCheckAutoRefresh() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'refreshNorthernYardCheckComparison') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
`;
}
