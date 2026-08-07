import chunk0 from './inventory-import-chunks/0';
import chunk1 from './inventory-import-chunks/1';
import chunk2 from './inventory-import-chunks/2';
import chunk3 from './inventory-import-chunks/3';
import chunk4 from './inventory-import-chunks/4';
import chunk5 from './inventory-import-chunks/5';
import chunk6 from './inventory-import-chunks/6';
import chunk7 from './inventory-import-chunks/7';
import chunk8 from './inventory-import-chunks/8';
import chunk9 from './inventory-import-chunks/9';
import chunk10 from './inventory-import-chunks/10';

export const protectedInventoryImport = {
  version: 1,
  compression: 'br',
  wrappedKey: 'huRtacYKSsewKpbEnfoVhjBN79uzlceccuseTfOKblZj/TIiMYQXBdo4ilVHbxazxd2YP9F6ZYJUw5onjH+cNBQblBiHKcH1i63oE371iWhtmbmTD0C11f6/64vp1bEX1TTjBArR42JHz2hgdaRspL7xVN5nhKtetYineTQ74j3RhOOD11AcpNs5EaPxxr2Fv9jXo1AdtBahO6fukdU4cP4Vq1A3Q6b1VlEIR1iy1c3Cf07+clB8LGljyHX7upUn5iRN9VHiLclovlQ2OqiGIc63iYAHl6PqBIRsUhRradC+pRWOJfFHS+/Ps4nWUePRFtca79WSPX2Jm2HFqnwkuBFCMNcQLx2FaMqVn1W9yPNrFa7JhimnCVgQPuUSGY7PtiUTtT93BA72plvEnw8ZcuoSiNqqjBGN3pGkCt3zhie0brfJZ2wSMWN1BZBvV/e50EsNviowKKkO1LONt8ZRBJKCKkkKzbdHyqIvPiGM5RgHpDf/p8t4Xci+ER1suCEo',
  iv: '76YVI2Z1xs/IIVDD',
  ciphertext: chunk0 + chunk1 + chunk2 + chunk3 + chunk4 + chunk5 + chunk6 + chunk7 + chunk8 + chunk9 + chunk10,
  expectedCiphertextLength: 118580,
  expected: { vendors: 46, parts: 2369, stockRows: 2933 },
} as const;
