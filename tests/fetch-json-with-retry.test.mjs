import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJsonWithRetry } from '../lib/fetch-json-with-retry.js';

test('safe JSON read retries an HTML runtime failure once and returns the second JSON response', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response('<!DOCTYPE html><title>Temporary failure</title>', { status: 502, headers: { 'content-type': 'text/html' } });
    return Response.json({ units: [{ unit: '53164' }] });
  };

  const { response, payload } = await fetchJsonWithRetry('/api/equipment/search', {}, {
    fetchImpl,
    retryDelayMs: 0,
    unavailableMessage: 'Unit search is temporarily unavailable. Try again.',
  });

  assert.equal(calls, 2);
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { units: [{ unit: '53164' }] });
});

test('safe JSON read retries a transient D1 error even when the route returned a non-5xx status', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json({ error: 'D1_ERROR: D1 DB storage operation exceeded timeout which caused object to be reset.' }, { status: 403 });
  };

  await assert.rejects(
    fetchJsonWithRetry('/api/breakdown-categories', {}, {
      fetchImpl,
      retryDelayMs: 0,
      unavailableMessage: 'Repair types are temporarily unavailable. Try again.',
    }),
    /Repair types are temporarily unavailable\. Try again\./,
  );
  assert.equal(calls, 2);
});

test('safe JSON read never exposes the JSON parser error when HTML persists', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('<!DOCTYPE html><body>Cloudflare error</body>', { status: 503, headers: { 'content-type': 'text/html' } });
  };

  await assert.rejects(
    fetchJsonWithRetry('/api/equipment/search', {}, {
      fetchImpl,
      retryDelayMs: 0,
      unavailableMessage: 'Unit search is temporarily unavailable. Try again.',
    }),
    (error) => {
      assert.equal(error.message, 'Unit search is temporarily unavailable. Try again.');
      assert.doesNotMatch(error.message, /Unexpected token|DOCTYPE|valid JSON/i);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test('safe JSON read does not retry a normal JSON validation response', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json({ error: 'Pick Truck or Trailer first.' }, { status: 400 });
  };

  const { response, payload } = await fetchJsonWithRetry('/api/equipment/search', {}, {
    fetchImpl,
    retryDelayMs: 0,
    unavailableMessage: 'Unit search is temporarily unavailable. Try again.',
  });

  assert.equal(calls, 1);
  assert.equal(response.status, 400);
  assert.deepEqual(payload, { error: 'Pick Truck or Trailer first.' });
});
