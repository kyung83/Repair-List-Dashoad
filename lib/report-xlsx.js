// Small, dependency-free OOXML writer for flat report tables, not an Excel parser.
// ZIP stored entries: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// SpreadsheetML: https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function xml(value) {
  const text = String(value ?? '').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '');
  if (text.length > 32767) throw new RangeError('A report cell exceeds Excel\'s text limit. Use CSV for this report.');
  return text.replace(/_x[\da-f]{4}_/gi, (match) => `_x005F_${match.slice(1)}`)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function columnName(index) {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const encode = new TextEncoder();
  const locals = [], directory = [];
  let offset = 0, directorySize = 0;
  for (const [path, value] of entries) {
    const name = encode.encode(path), data = encode.encode(value), crc = crc32(data);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint16(12, 33, true); // DOS date 1980-01-01; deterministic exports.
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
    cv.setUint16(14, 33, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); central.set(name, 46);
    locals.push(local, data); directory.push(central); offset += local.length + data.length; directorySize += central.length;
  }
  if (offset + directorySize > 64 * 1024 * 1024) throw new RangeError('This Excel export is too large. Narrow the report date range.');
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  const output = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...directory, end]) { output.set(part, cursor); cursor += part.length; }
  return output;
}
function worksheet(columns, rows) {
  const cell = (value, row, col, header) => {
    const address = `${columnName(col)}${row}`;
    const style = header ? 1 : columns[col].format === 'money' ? 2 : columns[col].format === 'number' ? 3 : 0;
    if (value == null) return `<c r="${address}" s="${style}"/>`;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Report contains a non-finite number.');
      return `<c r="${address}" s="${style}" t="n"><v>${value}</v></c>`;
    }
    // Explicit inline strings preserve unit numbers and never execute user text as formulas.
    return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  };
  const last = `${columnName(columns.length - 1)}${rows.length + 1}`;
  const widths = columns.map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(80, Math.max(10, Number(col.width) || 20))}" customWidth="1"/>`).join('');
  return XML + `<worksheet xmlns="${NS}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}"/>` +
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetFormatPr defaultRowHeight="30"/><cols>${widths}</cols><sheetData>` +
    [columns.map((col) => col.header), ...rows].map((row, index) => `<row r="${index + 1}"${index === 0 ? ' ht="30" customHeight="1"' : ''}>${row.map((value, col) => cell(value, index + 1, col, index === 0)).join('')}</row>`).join('') +
    `</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

export function buildReportXlsx(columns, rows, metadata = []) {
  if (!Array.isArray(columns) || !columns.length || columns.length > 32 || !Array.isArray(rows) || rows.length > 5000) throw new RangeError('Invalid report dimensions.');
  if (rows.some((row) => !Array.isArray(row) || row.length !== columns.length)) throw new TypeError('Report columns do not match the row data.');
  const sheets = [
    { name: 'Breakdown Detail', columns, rows },
    { name: 'Report Info', columns: [{ header: 'Setting', width: 26 }, { header: 'Value', width: 80 }], rows: metadata },
  ];
  const styles = XML + `<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;[Red](&quot;$&quot;#,##0.00)"/></numFmts>` +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF172033"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  return zip([
    ['[Content_Types].xml', XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
    ['_rels/.rels', XML + `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', XML + `<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>` + sheets.map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', XML + `<Relationships xmlns="${PKG}">` + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ...sheets.map((sheet, i) => [`xl/worksheets/sheet${i + 1}.xml`, worksheet(sheet.columns, sheet.rows)]),
  ]);
}
