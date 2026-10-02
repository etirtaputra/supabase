import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peersByFocus, type DocPeer } from './presence.ts';

const P = (name: string, focus: string | null, editing = false): DocPeer =>
  ({ email: `${name.toLowerCase()}@x.co`, name, color: '#000', editing, focus });

test('the live line marker: who is on which line', () => {
  const m = peersByFocus([P('Tisa', 'row-1', true), P('Abel', 'row-1'), P('Budi', 'row-2'), P('Eric', null)]);
  assert.deepEqual([...m.keys()].sort(), ['row-1', 'row-2']);
  assert.deepEqual(m.get('row-1')!.map((p) => p.name), ['Abel', 'Tisa'], 'name order, both shown');
  assert.equal(m.get('row-1')!.find((p) => p.name === 'Tisa')!.editing, true);
  assert.equal([...m.values()].flat().some((p) => p.name === 'Eric'), false, 'no line → no marker');
});
