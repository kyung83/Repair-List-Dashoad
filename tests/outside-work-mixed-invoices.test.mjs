import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutsideWorkInvoice } from '../app/outside-work/invoice-parser-v3.js';

const ats = `
INVOICE #
ATS FLEET SERVICE GRAND RAPIDS
4525 CLYDE PARK REMIT TO:
ALMA TIRE SVC INC PAGE: 1
GRAND RAPIDS, MI 49509 1210 E SUPERIOR ST
ALMA, MI 48801
616/452-8005
CUSTOMER: NORTHERN LOGISTICS CLARE
PO BOX 650
1653
CLARE, MI 48617
FAX NUMBER: 9893869922
BUSINESS: 989/386-7556 0 PO NUMBER: 450
VEHICLE: 2022 INTERNATIONAL RH613
SALESMAN: MATT ROGERS LICENSE: RC05150 MI MILEAGE: 503853
VIN: 3HCDWTZR0NL277313
Fleet ID 450
INVOICE DATE: 08/20/26 DUE: 09/10/26
PICKUP AT STORE: Y
PRODUCT DESCRIPTION QUANTITY PRICE EXTENSION
C104 REGULAR HOURS SERVICE CALL 1.50 130.00 195.00
C103S FUEL SURCHARGE (20 MILES PORT TO 1.00 45.00 45.00
TL115 TIRE CHANGE MED TRK (OUTSIDE/STE 5 73.50 367.50
V105 VALVE STEM MED TRK 4 6.50 26.00
354MGT 295/75R22.5 MEGATREK (MGT) 1 224.65 224.65
1R000SPOT SPOT REPAIR 1 11.11 11.11
354MGT 295/75R22.5 MEGATREK (MGT) 1 224.65 224.65
1R000LP10 LP-10 PUNCTURE REPAIR 1 19.03 19.03
354MGT 295/75R22.5 MEGATREK (MGT) 1 224.65 224.65
1R0000B24 B-24 SECTION REPAIR 1 31.98 31.98
354MGT 295/75R22.5 MEGATREK (MGT) 1 224.65 224.65
1R0000SP8 SP-8 NAIL REPAIR 1 12.00 12.00
UNIT CALLED IN FOR 2 TIRES. TECH NOTICED THAT ALL INNER TIRES WERE WORN DOWN.
CALLED JOE AND JOE APPROVED CHANGING ONE AXLE AND MOVING THE BEST TIRES TO
THE FRONT AXLE.
MERCHANDISE: 998.72
LABOR: 607.50
616020504
PAGE: 2
INVOICE TOTAL: 1606.22
ON ACCOUNT A/R 1606.22
TENDERED BY 77212
616020504
SUMMARY
354MGT 295/75R22.5 MEGATREK (MGT) 4 224.65 898.60
V105 VALVE STEM MED TRK 4 6.50 26.00
TL115 TIRE CHANGE MED TRK (OUTSIDE/STE 5 73.50 367.50
1R000SPOT SPOT REPAIR 1 11.11 11.11
1R000LP10 LP-10 PUNCTURE REPAIR 1 19.03 19.03
1R0000B24 B-24 SECTION REPAIR 1 31.98 31.98
1R0000SP8 SP-8 NAIL REPAIR 1 12.00 12.00
INVOICE TOTAL: 1606.22
616020504
`;

test('ATS chooses the servicing facility, not the remit payee',()=>{
  const p=parseOutsideWorkInvoice(ats);
  assert.equal(p.vendor.value,'ATS FLEET SERVICE GRAND RAPIDS');
  assert.equal(p.payee.value,'ALMA TIRE SVC INC');
  assert.equal(p.invoiceNumber.value,'616020504');
  assert.equal(p.invoiceDate.value,'2026-08-20');
  assert.equal(p.mileage.value,'503853');
  assert.equal(p.totalAmount.value,'1606.22');
  assert.match(p.serviceSummary.value,/Changed 5 medium-truck tires/i);
  assert.match(p.serviceSummary.value,/Replaced 4 valve stems/i);
  assert.match(p.serviceSummary.value,/tire puncture/i);
  assert.match(p.serviceSummary.value,/section repair/i);
  assert.doesNotMatch(p.serviceSummary.value,/fuel surcharge|merchandise|motor vehicle service and repair act/i);
});

const roadsync = `
PAGE 1
Gerald's Towing & Truck Repair
RoadSync ID: 52609
Phone: 3372355263
1633 St. Mary street
Scott LA, 70583
Powered by RoadSync
RS Trans# 9628372
RS WO# 562339
Generated: Aug 20, 2026 2:04 PM CDT
PAID BY DESTINATION
Alex
maintenance@norloworld.com
Gerald's Towing & Truck Repair
1633 St. Mary street
Scott, LA, 70583
EXTERNAL INVOICE NUMBER
43447
COMMENTS
RECEIPT DETAILS
PAYMENT METHOD Self-Checkout / Card
AMOUNT $800.40
CONVENIENCE FEE $32.02
GRAND TOTAL $832.42
ATTACHMENTS
TowbookInvoice-43447.pdf
PAID IN FULL
Please note that the charge may show up on your credit card statement as ROADSYNC, our payments partner.
`;

test('RoadSync is recognized as a payment wrapper and does not invent repairs',()=>{
  const p=parseOutsideWorkInvoice(roadsync);
  assert.equal(p.vendor.value,"Gerald's Towing & Truck Repair");
  assert.equal(p.invoiceNumber.value,'43447');
  assert.equal(p.invoiceDate.value,'2026-08-20');
  assert.equal(p.totalAmount.value,'832.42');
  assert.equal(p.mileage.value,'');
  assert.equal(p.serviceSummary.value,'');
  assert.equal(p.documentKind,'payment_receipt');
});

const onsiteOcr = `
DENNIS CARNEY
THE ORIGINAL ON-SITE REPAIR SERVICE, INC.
1115 N. Irish Road
Davison, MI 48423
(810) 653-2709
24 HOUR SERVICE
No. 26747
NAME NORTHERN LOGISTICS
ADDRESS
CITY CLARE STATE MI
DATE 8-19-26
SERVICE TO RUN UNIT AND PARTS REQUIREMENT
PICKUP PARTS AT SAGINAW MI
INSTALL UNIT CORRECT PARTS
TOTAL 707.81
`;

test('printed anchors on a handwritten service form still resolve safely',()=>{
  const p=parseOutsideWorkInvoice(onsiteOcr);
  assert.equal(p.vendor.value,'THE ORIGINAL ON-SITE REPAIR SERVICE, INC');
  assert.equal(p.invoiceNumber.value,'26747');
  assert.equal(p.totalAmount.value,'707.81');
  assert.notEqual(p.vendor.value,'NORTHERN LOGISTICS');
});
