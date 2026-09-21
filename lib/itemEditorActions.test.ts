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
  // Compare against where the menu is USED, not where it is defined — the
  // shell component sits above the table in the file.
  const confirmAt = src.indexOf('text-[11px] text-red-400">Delete?');
  const menuAt = src.indexOf('<RowActionsMenu anchor=');
  assert.ok(confirmAt > 0 && menuAt > 0 && confirmAt < menuAt,
    'the confirm renders in the strip itself, before the menu');
});

test('the menu is anchored, dismissable, and passes its rect to the stock panel', () => {
  const src = readFileSync(EDITOR, 'utf8');
  assert.ok(src.includes('<div className="fixed inset-0 z-40" onClick={onClose} />'),
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

/**
 * The menu must be PORTALLED, or it opens in the wrong place.
 *
 * The table sits in a card with `backdrop-blur-sm`, and a backdrop-filter makes
 * that element a containing block for `position: fixed` descendants. A menu
 * rendered inside the row was therefore positioned against the CARD, not the
 * viewport, and opened exactly the card's own offset too low — measured in
 * Chromium: a button whose bottom was at 347px produced a menu at 648px, adrift
 * by the card's 301px (owner: "the pop up menu is far below the row it should
 * be"). Every other overlay in this file portals for the same reason.
 */
test('the row menu escapes the blurred card it is drawn inside', () => {
  const src = readFileSync(EDITOR, 'utf8');
  const shell = src.indexOf('function RowActionsMenu');
  assert.ok(shell > 0, 'the menu needs its own shell so the portal lives in one place');
  const portal = src.indexOf('createPortal(', shell);
  const end = src.indexOf('function RowMenuItem', shell);
  assert.ok(portal > shell && portal < end,
    'RowActionsMenu must portal — fixed positioning inside the backdrop-blur card is measured against the card');
  assert.ok(src.slice(shell, end).includes('document.body'), 'the portal target is the body');
  // The row hands over an anchor rect and nothing else: the menu decides where
  // it can fit, so a row near the bottom flips above its button.
  assert.ok(/below \+ h <= window\.innerHeight - 8 \? below : Math\.max\(8, anchor\.top - 6 - h\)/.test(src),
    'the menu must flip above its button when there is no room below');
  assert.ok(/el\.style\.top = /.test(src),
    'the measured position is written to the node, not pushed through a render');
  assert.ok(!/top: r\.bottom \+ 6,\n\s+right:/.test(src),
    'the row should no longer pre-compute the menu position');
});

/**
 * Both identities are reachable from a phone, and both can be copied.
 *
 * OWNER, 2026-09-21, from a phone: *"item editor list is missing copy button
 * for the supplier and internal description in mobile browser"*.
 *
 * Two faults behind one report. The mobile card rendered the SUPPLIER's model
 * as its only title, so `internal_description` — the description we sell
 * under, and the one the owner's standing rule says we display — was not on
 * the phone at all; and `CopyBtn` was rendered only in the desktop table, so
 * neither field could be copied there even when visible.
 */
test('the phone card carries our description and the supplier model, both copyable', () => {
  const src = readFileSync(EDITOR, 'utf8');
  const mobile = src.split('} : isMobile ? (')[1] ?? src.split('isMobile ? (')[1] ?? '';
  assert.ok(mobile, 'the mobile card branch has moved — this test no longer reads it');
  const card = mobile.slice(0, mobile.indexOf('</div>\n        ) : ('));
  assert.match(card, /CopyBtn text=\{c\.internal_description\}/,
    'our own description must be copyable from a phone');
  assert.match(card, /CopyBtn text=\{c\.supplier_model\}/,
    "the supplier's model must be copyable from a phone");
  assert.match(card, /\{c\.internal_description \|\| '\(no description\)'\}/,
    'the phone card must show our description, not the supplier model alone');
});

test('the copy button goes through the shared clipboard helper', () => {
  const src = readFileSync(EDITOR, 'utf8');
  // `navigator.clipboard` is absent over plain http and in some in-app
  // browsers — phone browsers, which is where this was reported. Calling
  // `.writeText(...).then(...)` on it throws before anything is copied.
  //
  // Comments stripped first: the file EXPLAINS why it avoids that object, and
  // a guard that a sentence about the rule can trip is a guard that punishes
  // writing the reason down.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  assert.ok(!/navigator\.clipboard/.test(code),
    'it reaches for the clipboard directly instead of going through copyOnly');
  assert.match(src, /import \{ copyOnly \} from '@\/lib\/whatsappQuote'/);
});

test('the copy button is a span, because the phone card around it is a button', () => {
  const src = readFileSync(EDITOR, 'utf8');
  const fn = src.slice(src.indexOf('function CopyBtn'), src.indexOf('// --- Brand Autocomplete'));
  assert.ok(!/<button/.test(fn),
    'a <button> inside the mobile card button is invalid HTML — keep the span with role="button"');
  assert.match(fn, /role="button"[\s\S]*?tabIndex=\{0\}/);
  assert.match(fn, /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter' \|\| e\.key === ' '\) copy\(e\); \}\}/,
    'role="button" without a key handler is a control the keyboard can focus and not press');
});

test('the tap target is bigger on a phone than on a mouse', () => {
  const src = readFileSync(EDITOR, 'utf8');
  const fn = src.slice(src.indexOf('function CopyBtn'), src.indexOf('// --- Brand Autocomplete'));
  assert.match(fn, /w-7 h-7 -my-1 sm:w-5 sm:h-5/,
    'the same icon a pointer hits exactly is a guess for a thumb');
});
