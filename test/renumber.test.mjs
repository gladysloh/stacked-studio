import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRenumber } from '../core/records.mjs';

test('renumber maps codes of versions made before the renumber, keeps the original', () => {
  const r = [{ at: '2026-11-24T10:00:00Z', map: { APS008: 'APS007', APS012: 'APS011' } }];
  const old = applyRenumber({ id: 'a', deliverable: 'APS012', created: '2026-11-24T09:00:00Z' }, r);
  assert.equal(old.deliverable, 'APS011');
  assert.equal(old.deliverable_was, 'APS012');
  const fresh = { id: 'b', deliverable: 'APS012', created: '2026-11-24T11:00:00Z' };
  assert.equal(applyRenumber(fresh, r), fresh);
  assert.equal(applyRenumber({ deliverable: 'APS003', created: '2026-01-01' }, r).deliverable, 'APS003');
});

test('renumbers chain in order', () => {
  const r = [{ at: '2026-02-01', map: { A001: 'A002' } }, { at: '2026-03-01', map: { A002: 'A003' } }];
  assert.equal(applyRenumber({ deliverable: 'A001', created: '2026-01-01' }, r).deliverable, 'A003');
});

test('a version filed under the old code after the renumber is moved by id', () => {
  const r = [{ at: '2026-11-24T10:00:00Z', map: { APS008: 'APS007' }, ids: { late: 'APS007' } }];
  assert.equal(applyRenumber({ id: 'late', deliverable: 'APS008', created: '2026-11-24T11:00:00Z' }, r).deliverable, 'APS007');
  assert.equal(applyRenumber({ id: 'real8', deliverable: 'APS008', created: '2026-11-24T11:00:00Z' }, r).deliverable, 'APS008');
});
