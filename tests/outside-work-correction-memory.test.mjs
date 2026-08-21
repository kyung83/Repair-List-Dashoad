import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLearnedCorrection,normalizeCorrectionValue} from '../app/outside-work/correction-memory.js';

test('normalizes vendor and invoice correction keys deterministically',()=>{
  assert.equal(normalizeCorrectionValue('vendorName',' White\'s  International Trucks, Inc. '),'WHITE S INTERNATIONAL TRUCKS INC');
  assert.equal(normalizeCorrectionValue('invoiceNumber',' RA 2020-05272:01 '),'RA2020-05272:01');
  assert.equal(normalizeCorrectionValue('totalAmount','$1,129.80'),'1129.80');
});

test('a correction is not auto-applied until confirmed twice',()=>{
  const once=[{fieldName:'vendorName',detectedKey:'WHITES INTERNATONAL',correctedValue:"WHITE'S INTERNATIONAL TRUCKS",confirmations:1,vendorId:4}];
  assert.equal(applyLearnedCorrection(once,'vendorName','WHITES INTERNATONAL',null),null);
  const twice=[{...once[0],confirmations:2}];
  assert.equal(applyLearnedCorrection(twice,'vendorName','WHITES INTERNATONAL',null)?.correctedValue,"WHITE'S INTERNATIONAL TRUCKS");
});

test('vendor-specific field corrections do not leak to another vendor',()=>{
  const rules=[{fieldName:'invoiceNumber',detectedKey:'RA20200527201',correctedValue:'RA202005272:01',confirmations:3,vendorId:4}];
  assert.equal(applyLearnedCorrection(rules,'invoiceNumber','RA20200527201',7),null);
  assert.equal(applyLearnedCorrection(rules,'invoiceNumber','RA20200527201',4)?.correctedValue,'RA202005272:01');
});

test('conflicting confirmed corrections fail closed',()=>{
  const rules=[
    {fieldName:'vendorName',detectedKey:'ABC TRUCK',correctedValue:'ABC TRUCK SERVICE',confirmations:4,vendorId:1},
    {fieldName:'vendorName',detectedKey:'ABC TRUCK',correctedValue:'ABC TRUCKING',confirmations:2,vendorId:2},
  ];
  assert.equal(applyLearnedCorrection(rules,'vendorName','ABC TRUCK',null),null);
});
