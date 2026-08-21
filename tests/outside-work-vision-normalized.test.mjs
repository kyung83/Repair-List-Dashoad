import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutsideWorkInvoice } from '../app/outside-work/invoice-parser-v3.js';

const handwrittenVision = `
VISION-VERIFIED SCANNED INVOICE
SERVICE VENDOR: THE ORIGINAL ON-SITE REPAIR SERVICE, INC.
INVOICE NUMBER: 26747
SERVICE DATE: 2026-08-19
UNIT: 431
INVOICE TOTAL: 707.81
WORK PERFORMED:
Serviced unit and determined required parts
Picked up required parts in Saginaw, MI
Installed correct parts on unit
`;

test('vision-normalized handwritten invoice feeds the same trusted parser',()=>{
  const p=parseOutsideWorkInvoice(handwrittenVision);
  assert.equal(p.vendor.value,'THE ORIGINAL ON-SITE REPAIR SERVICE, INC');
  assert.equal(p.invoiceNumber.value,'26747');
  assert.equal(p.invoiceDate.value,'2026-08-19');
  assert.equal(p.totalAmount.value,'707.81');
  assert.match(p.serviceSummary.value,/Serviced unit and determined required parts/i);
  assert.match(p.serviceSummary.value,/Picked up required parts/i);
  assert.match(p.serviceSummary.value,/Installed correct parts/i);
  assert.doesNotMatch(p.serviceSummary.value,/VISION-VERIFIED|SERVICE VENDOR|INVOICE TOTAL/i);
});
