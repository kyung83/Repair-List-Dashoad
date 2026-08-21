import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone,
  detectVendorPhone,
  validateSimpleInvoiceArithmetic,
  isOwnFleetCompany,
} from '../app/outside-work/invoice-validation.js';

test('normalizes and finds printed vendor phone while ignoring fax',()=>{
  const text=`
The Original ON-SITE REPAIR SERVICE, INC.
1115 N. Irish Road
Davison, MI 48423
PHONE (810) 653-2709
FAX (810) 658-2725
NAME NORTHERN LOGISTICS
`;
  assert.equal(normalizePhone('(810) 653-2709'),'8106532709');
  assert.deepEqual(detectVendorPhone(text),{digits:'8106532709',raw:'(810) 653-2709',confidence:.99});
});

test('simple handwritten invoice arithmetic proves the total',()=>{
  const text=`
SERVICE CALL $139.00
LABOR 9.5 HRS $333.50
PARTS $235.31
TOTAL $707.81
`;
  const result=validateSimpleInvoiceArithmetic(text,707.81);
  assert.equal(result.status,'balanced');
  assert.equal(result.sum,707.81);
});

test('simple handwritten invoice arithmetic blocks a misread total',()=>{
  const text=`
SERVICE CALL $139.00
LABOR 9.5 HRS $333.50
PARTS $235.31
TOTAL $707.81
`;
  const result=validateSimpleInvoiceArithmetic(text,707.31);
  assert.equal(result.status,'mismatch');
  assert.equal(result.difference,.5);
});

test('our fleet names can never be treated as vendors',()=>{
  assert.equal(isOwnFleetCompany('Northern Logistics'),true);
  assert.equal(isOwnFleetCompany('NORLOWORLD'),true);
  assert.equal(isOwnFleetCompany('White’s International Trucks'),false);
});
