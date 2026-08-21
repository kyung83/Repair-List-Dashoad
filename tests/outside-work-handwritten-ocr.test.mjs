import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOutsideWorkInvoice,
  suspiciousServiceSummary,
  suspiciousVendor,
} from '../app/outside-work/invoice-parser-v3.js';

const noisy=`
DENN;                              1115 N. Irish Road
By                ARNEY                  Davison, MI 48423
wh                  Pe Za                   (810) 653-2709
The                          [iy       FAX (810) 658-2725
Original             SITE    fied         24 HOUR SERVICE
—                REPAI
Ne 26747
Since 1991      SERVICE, INC.
NAME NORTHERN LOGISTICS
Original SITE fied 24 HOUR SERVICE Since 1991 SERVICE, INC.
TOTAL 0/7
`;

test('old service-form OCR does not treat letterhead slogans as trusted repair data',()=>{
  const parsed=parseOutsideWorkInvoice(noisy);
  assert.equal(parsed.invoiceNumber.value,'26747');
  assert.equal(suspiciousVendor('Original SITE fied 24 HOUR SERVICE'),true);
  assert.equal(suspiciousServiceSummary('Original SITE fied 24 HOUR SERVICE Since 1991 SERVICE, INC.'),true);
});
