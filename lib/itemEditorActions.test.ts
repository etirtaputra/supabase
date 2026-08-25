/**
 * The Item Editor's action column, kept narrow and kept legible.
 *
 * It carried SEVEN icon buttons per row — 252px of every row, 288px when the
 * item had a datasheet — and the count changed from row to row (5, 6 or 7,
 * depending on whether the item takes specs and has a file), so the column was
 * ragged as well as wide (owner, 2026-08-24: "taking too much horizontal
 * space"). Measured with the app's own classes, each strip sized on its own.
 *
 * Only two of the seven said anything without being hovered: Specs is amber or
 * emerald for calculator-readiness, and Edit turns amber when the row is dirty.
 * Those stay. The other five became a ⋯ menu WITH NAMES, which is the second
 * half of the fix — a cube, a magnifier, an arrow, a clipboard and a bin are
 * not self-explanatory, and hovering each in turn was the only way to learn
 * them. 104px now, and the same 104px on every row.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const EDITOR = 'components/ui/ComponentEditor.tsx';

test('the five secondary actions live in the menu, not in the row', () => {
  const src = readFileSync(EDITOR, 'utf8');
  // The old inline buttons are gone — each identified by the title it carried.
  for (const gone of [
    'title="Stock — Physical / Reserved / Live, receive & adjust"',
    'title="Inspect component — quotes, POs, market intel, change log"',
    'title="Open the item hub — buy, sell, stock, specs on one page"',
    'title="Copy row to clipboard (tab-separated, paste into Excel)"',
    'title="Delete component"',
  ]) {
    assert.ok(!src.includes(gone), `${gone} is back in the row — the column is widening again`);
  }
  // …and they are in the menu, named.
  const items = src.split('<RowMenuItem').length - 1;
  assert.ok(items >= 5, `the ⋯ menu should carry the moved actions, found ${items}`);
  for (const label of ['label="Stock"', 'label="Inspect"', 'label="Item hub"', 'label="Delete component"']) {
    assert.ok(src.includes(label), `the menu must name its actions — missing ${label}`);
  }
});

test('the two actions that carry a signal stay in the row', () => {
  const src = readFileSync(EDITOR, 'utf8');
  // Specs keeps the calculator-readiness colours: amber = something missing,
  // emerald = ready. That colour is INFORMATION, scanned down the column, so
  // it can never move behind a click.
  assert.ok(/rowReadiness\.ready[\s\S]{0,120}text-emerald-400[\s\S]{0,200}text-amber-400/.test(src),
    'the specs button must keep its readiness colours in the row');
  assert.ok(src.includes('title="Edit row"'), 'Edit stays in the row — it is the primary verb');
  assert.ok(/isDirty[\s\S]{0,80}text-amber-400 bg-amber-500\/10/.test(src),
    'Edit must still light up when the row has unsaved changes');
});

test('deleting still asks first, and asks inside the row', () => {
  const src = readFileSync(EDITOR, 'utf8');
  // The menu arms the confirm; it never deletes straight from the menu.
  assert.ok(src.includes('onClick={() => { setConfirmDeleteId(c.component_id); setRowMenu(null); }}'),
    'the menu entry must arm the confirm, not delete');
  assert.ok(src.includes('<span className="text-[11px] text-red-400">Delete?</span>'),
    'the Delete? confirm belongs in the row, beside the thing it would destroy');
  const confirmAt = src.indexOf('text-[11px] text-red-400">Delete?');
  const menuAt = src.indexOf('role="menu"');
  assert.ok(confirmAt > 0 && menuAt > 0 && confirmAt < menuAt,
    'the confirm renders in the strip itself, before the menu');
});

test('the menu is anchored, dismissable, and passes its rect to the stock panel', () => {
  const src = readFileSync(EDITOR, 'utf8');
  assert.ok(src.includes('<div className="fixed inset-0 z-40" onClick={() => setRowMenu(null)} />'),
    'a click anywhere else must close the menu');
  assert.ok(src.includes('aria-haspopup="menu"') && src.includes('role="menuitem"'),
    'the ⋯ control and its entries need their roles');
  // The stock panel positions itself from the rect of whatever opened it —
  // that used to be its own button and is now the ⋯ button.
  assert.ok(src.includes('setStockPanel({ id: c.component_id, rect: rowMenu.anchor })'),
    'the stock panel must be given the menu button’s rect, or it opens in the wrong place');
});

/**
 * The 450ms peek survives the move.
 *
 * It hung off the Inspect magnifier — hover for a card of landed cost, last
 * quote, usage and competitor prices. Moving Inspect into the menu silently
 * orphaned it: the feature was still rendered, but nothing could ever set the
 * state that opens it. Three unused-variable warnings were the only trace,
 * which is a thin thread to hang a feature on, so it gets a test.
 */
test('hovering a row still opens the peek, from the control that replaced Inspect', () => {
  const src = readFileSync(EDITOR, 'utf8');
  // The state the card reads must still be written by something.
  assert.ok(src.includes('setHoverPreviewId(c.component_id)'), 'nothing opens the hover peek any more');
  assert.ok(src.includes('setHoverRect(rect)'), 'the peek needs an anchor rect or it renders in a corner');
  assert.ok(src.includes('}, 450);'), 'the peek must stay deliberate — 450ms, not on every pass of the pointer');
  // …and it must hang off the ⋯ button, which is where the magnifier used to be.
  const menuBtn = src.indexOf('data-row-menu');
  const enter = src.indexOf('onMouseEnter', menuBtn);
  const closes = src.indexOf('aria-haspopup="menu"', menuBtn);
  assert.ok(menuBtn > 0 && enter > menuBtn && enter < closes,
    'the peek belongs on the ⋯ button — hover for the summary, click for the actions');
  assert.ok(src.includes('setHoverPreviewId(null)'), 'and it must close when the pointer leaves');
});
