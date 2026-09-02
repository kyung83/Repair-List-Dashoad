import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('breakdown actions show loading text only for the action being saved', async () => {
  const page = await readFile(new URL('../app/breakdowns/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /type BusyAction = 'diagnostics'\|'claim'\|'provider'\|'onLocation'\|'clear'\|null/);
  assert.match(page, /const\[busyAction,setBusyAction\]=useState<BusyAction>\(null\)/);
  assert.match(page, /diagnosticsBusy\?'Saving…':'Save Our Diagnosis'/);
  assert.match(page, /providerBusy\?'Saving…':selected\.stage<3\?'Save & Mark En Route':'Save Provider \/ ETA'/);
  assert.match(page, /onLocationBusy\?'Saving…':'Mark On Location'/);
  assert.match(page, /clearBusy\?'Clearing…':'Clear — Not a Breakdown'/);
  assert.doesNotMatch(page, /const\[busy,setBusy\]=useState<number\|null>/);
});
