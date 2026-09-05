/**
 * The filename convention — the only thing standing between a saved PDF and a
 * Downloads folder full of "document (3).pdf".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { documentFileName, salesFileName, quoteFileName } from './quoteFilename.ts';

test('parts join with underscores, spaces inside a part become dashes', () => {
  assert.equal(
    salesFileName('PQ-20260905-0036', 'PT Indodaya Surya Lestari'),
    'PQ-20260905-0036_PT-Indodaya-Surya-Lestari');
});

test('characters a file system would reject are stripped', () => {
  // A customer name with a slash used to produce a name the OS silently
  // mangles — or a save that fails outright.
  assert.equal(salesFileName('SO-1/2', 'A: B "C" <D>'), 'SO-1-2_A-B-C-D-');
  assert.doesNotMatch(salesFileName('X', 'a/b\\c?d%e*f:g|h"i<j>k#l,m'), /[/\\?%*:|"<>#,]/);
});

test('runs of dashes collapse, empty parts vanish', () => {
  assert.equal(documentFileName(['A  -  B', null, '', '   ', 'C']), 'A-B_C');
});

test('a missing document number still yields a usable name', () => {
  assert.equal(salesFileName('', 'Hendra'), 'document_Hendra');
  assert.equal(salesFileName('', ''), 'document');
});

test('the EPC quote name keeps its shape on the shared rule', () => {
  assert.equal(
    quoteFileName('082-0126', 'MidPlaza', 0, { specTag: 'Hybrid-1.8MWpDC', location: 'RIVERSIDE PV FARM' }),
    '082-0126_MidPlaza_Hybrid-1.8MWpDC_RIVERSIDE-PV-FARM');
  // No spec tag → the computed system size stands in for it.
  assert.equal(quoteFileName('082-0126', 'MidPlaza', 5500, {}), '082-0126_MidPlaza_5.5kWp');
  assert.equal(quoteFileName('082-0126', 'MidPlaza', 800, {}), '082-0126_MidPlaza_800Wp');
});

test('sales and EPC names open the same way', () => {
  // Both start with the number that identifies the document, so a Downloads
  // folder sorts every document of a deal together.
  assert.match(salesFileName('PQ-1', 'X'), /^PQ-1_/);
  assert.match(quoteFileName('082-0126', 'X', 0), /^082-0126_/);
});
