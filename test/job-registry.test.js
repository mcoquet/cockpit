// Tests for the cron job registry the scheduler uses (#53): an unregistered
// job must never fire. Uses real node-cron with a every-second expression.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createJobRegistry } = require('../dist/main/main/job-registry.js');

const EVERY_SECOND = '* * * * * *';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a registered job fires', async () => {
  const registry = createJobRegistry();
  let ticks = 0;
  assert.equal(registry.register('a', EVERY_SECOND, () => { ticks++; }), true);
  assert.equal(registry.has('a'), true);
  await wait(2200);
  registry.clear();
  assert.ok(ticks >= 1, `expected at least one tick, got ${ticks}`);
});

test('an unregistered job never fires', async () => {
  const registry = createJobRegistry();
  let ticks = 0;
  registry.register('a', EVERY_SECOND, () => { ticks++; });
  registry.unregister('a');
  assert.equal(registry.has('a'), false);
  await wait(2200);
  assert.equal(ticks, 0);
});

test('an invalid cron expression is not registered', () => {
  const registry = createJobRegistry();
  assert.equal(registry.register('a', 'not a cron', () => {}), false);
  assert.equal(registry.has('a'), false);
});

test('registering the same id again replaces the old job', async () => {
  const registry = createJobRegistry();
  let oldTicks = 0;
  let newTicks = 0;
  registry.register('a', EVERY_SECOND, () => { oldTicks++; });
  registry.register('a', EVERY_SECOND, () => { newTicks++; });
  await wait(2200);
  registry.clear();
  assert.equal(oldTicks, 0);
  assert.ok(newTicks >= 1);
});

test('unregistering an unknown id is a no-op; clear stops every job', async () => {
  const registry = createJobRegistry();
  registry.unregister('missing');
  let ticks = 0;
  registry.register('a', EVERY_SECOND, () => { ticks++; });
  registry.register('b', EVERY_SECOND, () => { ticks++; });
  assert.deepEqual(registry.ids().sort(), ['a', 'b']);
  registry.clear();
  assert.deepEqual(registry.ids(), []);
  await wait(2200);
  assert.equal(ticks, 0);
});
