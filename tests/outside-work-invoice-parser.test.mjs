import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOutsideWorkInvoice, suspiciousInvoiceNumber } from '../app/outside-work/invoice-parser.js';

const whites = `
7045 Albert Pick Road
GREENSBORO, NC 27409
P: (336) 668-0491
DATE INVOICE
VIN
CUSTOMER PO#
8/20/2026
BILL TO
NORTHERN LOGISTICS - 104058
4900 E COLONVILLE RD
CLARE MI 48617
YEAR MAKE MODEL ENGINE HOURS Component Serial # ODOMETER
8/17/2026 7:38:09AM 464
2023 INTERNATIONAL LT 3HSDZAPRXPN256446 464 0 587366
SERVICE INVOICE: RA202005272:01
JOB #1 01 ENGINE
COMPLAINT ENGINE-CEL
CAUSE
PULLED TRUCK INTO SHOP. CHECKED CODES. HAD ACTIVE ACIVE AMBIENT AIR TEMP CODES,
AFTERTREATMENT DIFF PRESSURE CODE AND SOOT LEVEL CODE. FOUND THE DPFDP SENSOR BAD AND
REPLACED. PERFORMED A DPF RESET AND RAN A REGEN. ROAD TESTED UNIT WITH NO CODES COMING
BACK. CHECKED AND FOUND THE AMBIENT AIR TEMP SENSOR BAD. REMOVED AND INSTALLED NEW
SENSOR.
CORRECTION
QTY ITEM DESCRIPTION UNIT PRICE EXTD PRICE
1 202C/5492073 SENSOR,DFN PRESSURE 176.70 176.70
$71.44
$1,129.80
$52.65
$165.00
$255.71
$585.00
TOTAL
AUTHORIZATION FOR REPAIRS
Any warranties on the parts and accessories sold hereby are made by the manufacturer.
safety, efficiency, or comfort. WHITES INTERNATIONAL TRUCKS
Please Remit Payment to:
WHITES INTERNATIONAL TRUCKS
PO BOX 3817 WILSON NC 27893
ar@whitestractor.com
$1,058.36
`;

const wieland = `
UNIT# NL492
INVOICE
NORTHERN LOGISTICS INC FC
PO BOX 650
CLARE, MI 48617-0650 PAGE 1
HOME:989-386-7556 CONT:989-386-7556
BUS: CELL: 1446 TRACI HACKWORTH
23 INTERNATIONAL LT625 3HSDZAPRXPN227562 NL492 507380/507380 TNL492
22JUN22 DD17MAR22 15:24 17JUL26 NL492 CFLT 20JUL26
ENG:80406929 TRN:P1481707
11:30 17JUL26 07:59 20JUL26
LINE OPCODE TECH TYPE HOURS LIST NET TOTAL
A INSTALL AND REPROGRAM THE BCM
12 ENGINE REPAIR/DIAGNOSIS
605 GRANSDEN,SCOTT LIC#: M210185
CR 437.50 437.50
PARTS: 0.00 LABOR: 437.50 OTHER: 0.00 TOTAL LINE A: 437.50
507380 605-RR BODY CONTROLLER AND THEN REASSEMBLE DASH. PROGRAM BCM
TO LATEST LEVEL. VERIFY MILEAGE AND TEST OPERATION. DONE
CUSTOMER PAY EPA & MISC CHARG FOR REPAIR ORDER 26.25
437.50
26.25
463.75
463.75
CUSTOMER #: 17301 52853
CUSTOMER COPY
YEAR MAKE/MODEL VIN UNIT # MILEAGE IN/ OUT TAG
DEL DATE PO NO. RATE PAYMENT INV. DATE
R.O. OPENED READY OPTIONS:
Copyright 2014 CDK Global, LLC SERVICE INVOICE TYPE 2 - SI2C - IMAGING
SERVICE ADVISOR:
YOU ARE ENTITLED BY LAW TO THE RETURN
OF ALL PARTS REPLACED, EXCEPT THOSE
TOTAL CHARGES
PLEASE PAY
THIS AMOUNT
REMIT TO:
Wieland Trucks
Dept. 2007
P. O. Box 30516
Lansing, MI 48909-8016
The factory warranty constitutes all of the warranties with respect to the sale of this item/items.
800 Industrial Drive
Clare, MI 48617
www.wielandtrucks.com
`;

test('White invoice structural fields', () => {
  const p=parseOutsideWorkInvoice(whites);
  assert.equal(p.vendor.value,'WHITES INTERNATIONAL TRUCKS');
  assert.equal(p.invoiceNumber.value,'RA202005272:01');
  assert.equal(p.invoiceDate.value,'2026-08-20');
  assert.equal(p.mileage.value,'587366');
  assert.equal(p.totalAmount.value,'1129.80');
  assert.match(p.serviceSummary.value,/Replaced DPF differential pressure sensor/i);
  assert.match(p.serviceSummary.value,/Performed DPF reset and regeneration/i);
  assert.match(p.serviceSummary.value,/Road tested - no codes returned/i);
  assert.match(p.serviceSummary.value,/Replaced ambient air temperature sensor/i);
  assert.doesNotMatch(p.serviceSummary.value,/warrant|shop supplies|parts and\/or/i);
});

test('Wieland invoice structural fields', () => {
  const p=parseOutsideWorkInvoice(wieland);
  assert.equal(p.vendor.value,'Wieland Trucks');
  assert.equal(p.invoiceNumber.value,'52853');
  assert.equal(p.invoiceDate.value,'2026-07-20');
  assert.equal(p.mileage.value,'507380');
  assert.equal(p.totalAmount.value,'463.75');
  assert.match(p.serviceSummary.value,/Installed and reprogrammed BCM/i);
  assert.match(p.serviceSummary.value,/Reassembled dash/i);
  assert.match(p.serviceSummary.value,/Programmed BCM to latest level/i);
  assert.match(p.serviceSummary.value,/Verified mileage and tested operation/i);
  assert.doesNotMatch(p.serviceSummary.value,/TRACI|YOU ARE ENTITLED|INSURANCE|463\.75/i);
});

test('money cannot be invoice number',()=>{
  assert.equal(suspiciousInvoiceNumber('26.25'),true);
  assert.equal(suspiciousInvoiceNumber('$463.75'),true);
  assert.equal(suspiciousInvoiceNumber('52853'),false);
  assert.equal(suspiciousInvoiceNumber('RA202005272:01'),false);
});

const generic = `
ACME TRUCK SERVICE LLC
123 Main Street
Columbus, OH 43215
Phone: (614) 555-0199
INVOICE NO: INV-7781
INVOICE DATE: 08/15/2026
UNIT 700
ODOMETER 123456
WORK PERFORMED
REPLACED ALTERNATOR. TESTED CHARGING SYSTEM.
TOTAL DUE $845.30
`;

test('generic labeled invoice works without dealer-specific rules',()=>{
  const p=parseOutsideWorkInvoice(generic);
  assert.equal(p.vendor.value,'ACME TRUCK SERVICE LLC');
  assert.equal(p.invoiceNumber.value,'INV-7781');
  assert.equal(p.invoiceDate.value,'2026-08-15');
  assert.equal(p.mileage.value,'123456');
  assert.equal(p.totalAmount.value,'845.30');
  assert.match(p.serviceSummary.value,/Replaced alternator/i);
});

test('ambiguous invoice reference fails closed instead of using money',()=>{
  const p=parseOutsideWorkInvoice(`INVOICE\nCUSTOMER PAY MISC FOR REPAIR ORDER 26.25\nTOTAL DUE $26.25\n`);
  assert.equal(p.invoiceNumber.value,'');
});
