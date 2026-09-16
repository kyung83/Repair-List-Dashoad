import { readFile, writeFile } from 'node:fs/promises';

const path = 'app/maintenance-checklists/editor-client.tsx';
let source = await readFile(path, 'utf8');
const bad = "opacity:saving||(!dirty&&Boolean(selectedKey))?.55:1";
const good = "opacity:(saving||(!dirty&&Boolean(selectedKey)))?0.55:1";
const matches = source.split(bad).length - 1;
if (matches !== 2) throw new Error(`Expected 2 disabled-button style expressions, found ${matches}.`);
source = source.split(bad).join(good);
await writeFile(path, source);
