/**
 * Every lifecycle in ICAPROC, declared once (owner, 2026-11-10: "find all of
 * the implicit state machines … elevate UX, DX and AX").
 *
 * Until now each lifecycle lived in the screens that moved it: the sales
 * editor's chain of `if (st === …) actions.push(…)`, FulfillmentPanel's
 * "first invoice turns ordered into invoiced", the proposal editor's
 * STATUS_OPTS, three colour maps for the same four proposal statuses, a PO
 * status list in Deal Lookup, the after-sales form's free select. Nothing said
 * which moves were legal, an agent had to read the code to find out, and the
 * database accepted any text in three of the status columns.
 *
 * Now:
 *   - the STATES (with label, colour tone and meaning) and the MOVES between
 *     them are declared here, and the screens read them;
 *   - `lib/lifecycles.test.ts` checks the graph (every move names declared
 *     states, every state can be reached), that every status literal the app
 *     compares or writes is a declared state, that the screens' maps are these,
 *     and that the database CHECK lists equal the state lists;
 *   - `/api/agent/onboarding` serves `describeLifecycles()`, so an agent learns
 *     the legal values and moves from the app itself, not from a pack that can
 *     be months old.
 *
 * WHERE EACH MOVE IS ENFORCED is stated per lifecycle (`enforced`). Declaring a
 * move here does not make the database refuse the others — only a CHECK or a
 * trigger does, and the list says which ones exist.
 *
 * Labels are English; screens translate them with t() (lib/i18n.ts).
 */

/** What a state MEANS, for the corporate skin and for agents (see lib/wording.test.ts). */
export type Tone = 'off' | 'step' | 'wait' | 'done' | 'bad';

export interface LifeState {
  id: string;
  label: string;
  /** Badge classes; the `tone-*` marker is what the corporate skin reads. */
  cls: string;
  meaning: string;
  /** Nothing moves out of it by the normal path (it can still be reopened if a move says so). */
  terminal?: boolean;
  /** Present in the database type or read by code, but nothing writes it today. */
  unused?: string;
}

export type Actor = 'user' | 'owner' | 'system';

export interface Move {
  from: string[];
  to: string;
  /** The button or event, in the words the screen uses. */
  action: string;
  by: Actor;
  /** Where the move happens (file or trigger) — for the next developer and for agents. */
  where: string;
  /** Extra condition, in words. */
  when?: string;
}

export interface Lifecycle {
  id: string;
  title: string;
  table: string;
  column: string;
  /** How the value is stored and what the database itself refuses. */
  storage: 'enum' | 'text+check' | 'columns' | 'derived';
  initial: string;
  states: LifeState[];
  moves: Move[];
  /** True when a screen offers EVERY state from a plain select — the moves list the intended path. */
  freeSelect?: string;
  enforced: string[];
  notes?: string[];
  /**
   * Named sets of states that code COUNTS with ("goods are in", "a real
   * order"). Readers ask for a group instead of spelling states out, so two
   * screens can no longer disagree about what a PO is. Each group's
   * membership was copied from the code that used it (2026-11-10), so
   * adopting it changed nothing on screen; where readers disagreed (is a
   * Sent PO an order?) they got two groups with honest names. Changing a
   * group is a business decision — lib/lifecycles.test.ts pins them.
   */
  groups?: Record<string, string[]>;
}

const S = (id: string, label: string, cls: string, meaning: string, extra: Partial<LifeState> = {}): LifeState =>
  ({ id, label, cls, meaning, ...extra });

// ── EPC proposals ────────────────────────────────────────────────────────────
/**
 * Sent, won and lost proposals are LOCKED (owner, 2026-11-10: "lock won and
 * lost proposals like sent ones"): content is owner-only, and the one move a
 * Project Engineer has is back to draft. The database is the real gate —
 * can_edit_quote(), policy "quotes unsend" and guard_quote_unsend()
 * (migrations/epc_lock_won_lost.sql) use this same list.
 */
export const PROPOSAL_LOCKED_STATES = ['sent', 'accepted', 'rejected'] as const;
export const isProposalLocked = (status: string | null | undefined): boolean =>
  (PROPOSAL_LOCKED_STATES as readonly string[]).includes(status ?? '');

const EPC_PROPOSAL: Lifecycle = {
  id: 'epc_proposal',
  title: 'EPC proposal',
  table: '10.0_project_quotes',
  column: 'status',
  storage: 'text+check',
  initial: 'draft',
  states: [
    S('draft', 'Draft', 'bg-slate-700/60 text-slate-300 tone-off', 'Being written; anyone with EPC access may edit it.'),
    S('sent', 'Sent', 'bg-blue-500/20 text-blue-300 tone-step', 'Out with the customer. LOCKED: read-only for everyone but the owner; sent_at is stamped by the database.'),
    S('accepted', 'Accepted', 'bg-emerald-500/20 text-emerald-300 tone-done', 'Won. LOCKED like sent. Counted as a win (lib/proposalWins) while it stays accepted.', { terminal: true }),
    S('rejected', 'Rejected', 'bg-red-500/20 text-red-400 tone-bad', 'Lost. LOCKED like sent.', { terminal: true }),
  ],
  moves: [
    { from: ['draft'], to: 'sent', action: 'Status → Sent', by: 'user', where: 'app/proposals/[id] status select' },
    { from: ['draft'], to: 'accepted', action: 'Status → Accepted', by: 'user', where: 'app/proposals/[id] status select' },
    { from: ['draft'], to: 'rejected', action: 'Status → Rejected', by: 'user', where: 'app/proposals/[id] status select' },
    { from: ['sent', 'accepted', 'rejected'], to: 'draft', action: 'Move back to draft', by: 'user', where: 'app/proposals/[id] status select', when: 'owner, or a Project Engineer (can_unsend_quote)' },
    { from: ['sent', 'rejected'], to: 'accepted', action: 'Status → Accepted', by: 'owner', where: 'app/proposals/[id] status select' },
    { from: ['sent', 'accepted'], to: 'rejected', action: 'Status → Rejected', by: 'owner', where: 'app/proposals/[id] status select' },
    { from: ['accepted', 'rejected'], to: 'sent', action: 'Status → Sent', by: 'owner', where: 'app/proposals/[id] status select' },
  ],
  freeSelect: 'On a draft the editor offers all four states. On a sent, won or lost proposal the owner is offered all four; anyone else only that state and Draft.',
  enforced: [
    'CHECK proposal_status_valid (migrations/lifecycle_checks.sql): only these four values.',
    'can_edit_quote() (RLS on 10.0, 10.1 sections, 10.2 lines): a sent, accepted or rejected proposal is owner-only — for everyone else its content is read-only and it cannot be deleted.',
    'Policy "quotes unsend" + trigger guard_quote_unsend (migrations/epc_lock_won_lost.sql): an owner or Project Engineer may move a sent, accepted or rejected proposal back to draft, changing nothing else.',
    'Trigger log_quote_activity: every status change is logged to 10.3_quote_activity ("old -> new").',
  ],
  notes: ['"accepted" is the editor\'s word for a won proposal (lib/proposalGroups counts it as won).'],
};

// ── Sales quote → order → invoice → delivery (one row) ───────────────────────
const SALES_DOCUMENT: Lifecycle = {
  id: 'sales_document',
  title: 'Sales quote / order',
  table: '22.0_sales_quotes',
  column: 'status',
  storage: 'text+check',
  initial: 'draft',
  states: [
    S('draft', 'Draft', 'bg-slate-700/40 text-slate-300 tone-off', 'Being written (shown as DQ-…).'),
    S('validated', 'Validated', 'bg-cyan-500/15 text-cyan-300 tone-step', 'Checked and ready to send (shown as PQ-…).'),
    S('sent', 'Sent', 'bg-blue-500/15 text-blue-300 tone-step', 'Offer is with the customer.'),
    S('accepted', 'Accepted', 'bg-teal-500/15 text-teal-300 tone-step', 'Customer said yes; not yet a confirmed order.'),
    S('ordered', 'Confirmed Order', 'bg-violet-500/15 text-violet-300 tone-step', 'Sales order: the SO number is stamped and the quantities are reserved from Live Stock.'),
    S('invoiced', 'Invoiced', 'bg-amber-500/15 text-amber-300 tone-wait', 'At least one invoice exists; stock still reserved.'),
    S('preparing', 'Preparing Items', 'bg-orange-500/15 text-orange-300 tone-wait', 'At least one delivery order is being prepared; stock still reserved until it leaves.'),
    S('delivered', 'Delivered', 'bg-emerald-500/15 text-emerald-300 tone-done', 'Every delivery order is delivered. "Complete" also needs it fully paid (derived from receipts).', { terminal: true }),
    S('cancelled', 'Cancelled', 'bg-red-500/15 text-red-300 tone-bad', 'Order called off; reservation released.', { terminal: true }),
    S('rejected', 'Rejected', 'bg-red-500/10 text-red-400/80 tone-bad', 'Offer declined by the customer.', { terminal: true }),
  ],
  moves: [
    // The editor's buttons, in the order they are shown (salesDocumentActions).
    { from: ['draft'], to: 'validated', action: 'Validate', by: 'user', where: 'app/sales/[id] header', when: 'not on a "+ New Order" draft' },
    { from: ['draft', 'validated'], to: 'sent', action: 'Sent', by: 'user', where: 'app/sales/[id] header', when: 'not on a "+ New Order" draft' },
    { from: ['sent'], to: 'accepted', action: 'Accepted', by: 'user', where: 'app/sales/[id] header' },
    { from: ['draft', 'validated', 'sent', 'accepted'], to: 'ordered', action: 'Confirm Order', by: 'user', where: 'app/sales/[id] header', when: 'stamps the SO number and reserves stock' },
    { from: ['ordered'], to: 'accepted', action: 'Revert', by: 'user', where: 'app/sales/[id] header' },
    { from: ['invoiced'], to: 'ordered', action: 'Revert', by: 'user', where: 'app/sales/[id] header' },
    { from: ['preparing'], to: 'invoiced', action: 'Revert', by: 'user', where: 'app/sales/[id] header', when: 'the order has an invoice' },
    { from: ['preparing'], to: 'ordered', action: 'Revert', by: 'user', where: 'app/sales/[id] header', when: 'the order has no invoice' },
    { from: ['delivered'], to: 'preparing', action: 'Reopen', by: 'user', where: 'app/sales/[id] header' },
    { from: ['cancelled', 'rejected'], to: 'draft', action: 'Reopen', by: 'user', where: 'app/sales/[id] header' },
    { from: ['draft', 'validated', 'sent'], to: 'rejected', action: 'Reject', by: 'user', where: 'app/sales/[id] header' },
    { from: ['accepted', 'ordered', 'invoiced', 'preparing'], to: 'cancelled', action: 'Cancel', by: 'user', where: 'app/sales/[id] header' },
    { from: ['validated', 'sent', 'accepted'], to: 'draft', action: 'Revise', by: 'user', where: 'app/sales/[id] revise()', when: 'bumps the revision once the customer has seen it' },
    // Fulfillment moves the order as its documents are made and delivered.
    { from: ['ordered'], to: 'invoiced', action: 'First invoice created', by: 'system', where: 'components/ui/FulfillmentPanel createInvoice' },
    { from: ['invoiced'], to: 'ordered', action: 'Last invoice deleted', by: 'system', where: 'components/ui/FulfillmentPanel deleteInvoice' },
    { from: ['ordered', 'invoiced'], to: 'preparing', action: 'Delivery order created', by: 'system', where: 'components/ui/FulfillmentPanel createDo' },
    { from: ['preparing'], to: 'delivered', action: 'Every delivery order delivered', by: 'system', where: 'components/ui/FulfillmentPanel markDelivered' },
    { from: ['delivered'], to: 'preparing', action: 'A delivery order reopened', by: 'system', where: 'components/ui/FulfillmentPanel reopenDo' },
    { from: ['preparing'], to: 'invoiced', action: 'Last delivery order deleted (has invoices)', by: 'system', where: 'components/ui/FulfillmentPanel deleteDo' },
    { from: ['preparing'], to: 'ordered', action: 'Last delivery order deleted (no invoice)', by: 'system', where: 'components/ui/FulfillmentPanel deleteDo' },
  ],
  enforced: [
    'CHECK sales_document_status_valid (migrations/lifecycle_checks.sql): only these ten values.',
    'Trigger stamp_sales_quote stamps the SO/INV/DO numbers and milestone dates as the row passes each stage.',
    'Trigger log_sales_quote logs every change. Moves themselves are enforced by the editor only.',
  ],
  notes: [
    'Reserves stock while ordered, invoiced or preparing (COMMITTED_STATUSES).',
    'Paid / fully paid is DERIVED from 26.x receipts, never stored here.',
  ],
  groups: {
    /** Reserves stock: Live = Physical − Reserved. */
    committed: ['ordered', 'invoiced', 'preparing'],
    /** A real order, confirmed or beyond: payments, fulfillment, customer totals; stock may leave. */
    order: ['ordered', 'invoiced', 'preparing', 'delivered'],
    /** Carries an invoice number on print. */
    billed: ['invoiced', 'preparing', 'delivered'],
    /** Quoted and not yet an order (the sales list's Quote stage, the sales inbox). */
    offered: ['validated', 'sent', 'accepted'],
    /** An offer out with the customer, which valid_until can expire. */
    awaitingAnswer: ['validated', 'sent'],
    /** Where a mirrored Dolibarr order may be recorded: end states only (POST /api/agent/sales/mirror). */
    mirrorable: ['ordered', 'invoiced', 'delivered', 'cancelled'],
    /** Dead documents. */
    closedLost: ['cancelled', 'rejected'],
  },
};

// ── Delivery orders ──────────────────────────────────────────────────────────
const DELIVERY_ORDER: Lifecycle = {
  id: 'delivery_order',
  title: 'Delivery order',
  table: '24.0_delivery_orders',
  column: 'status',
  storage: 'text+check',
  initial: 'preparing',
  states: [
    S('preparing', 'Preparing', 'bg-orange-500/15 text-orange-300 tone-wait', 'Warehouse is preparing the goods.'),
    S('delivered', 'Delivered', 'bg-emerald-500/20 text-emerald-300 tone-done', 'Left the building; stock-out movements written for its lines.', { terminal: true }),
    S('cancelled', 'Cancelled', 'bg-red-500/15 text-red-300 tone-bad', 'Not delivered.', { unused: 'Read by FulfillmentPanel (a cancelled DO ships nothing) but no screen sets it; a DO is deleted instead.' }),
  ],
  moves: [
    { from: ['preparing'], to: 'delivered', action: 'Mark delivered', by: 'user', where: 'components/ui/FulfillmentPanel markDelivered' },
    { from: ['delivered'], to: 'preparing', action: 'Reopen', by: 'user', where: 'components/ui/FulfillmentPanel reopenDo' },
  ],
  enforced: [
    'CHECK delivery_order_status_valid (migrations/lifecycle_checks.sql).',
    'A delivered DO cannot be deleted from the screen — reopen it first.',
  ],
};

// ── After-sales cases ────────────────────────────────────────────────────────
const AFTERSALES_CASE: Lifecycle = {
  id: 'aftersales_case',
  title: 'After-sales case',
  table: '27.0_aftersales_cases',
  column: 'status',
  storage: 'text+check',
  initial: 'open',
  states: [
    S('open', 'Open', 'bg-rose-500/15 text-rose-300 tone-wait', 'Reported, not yet picked up.'),
    S('in_progress', 'In progress', 'bg-sky-500/15 text-sky-300 tone-step', 'Someone is working on it.'),
    S('waiting_parts', 'Waiting parts', 'bg-amber-500/15 text-amber-300 tone-wait', 'Blocked on parts.'),
    S('resolved', 'Resolved', 'bg-emerald-500/15 text-emerald-300 tone-done', 'Fixed; resolution written.'),
    S('closed', 'Closed', 'bg-slate-700/40 text-slate-400 tone-off', 'Done and filed.', { terminal: true }),
  ],
  moves: [
    { from: ['open', 'waiting_parts'], to: 'in_progress', action: 'Start / resume', by: 'user', where: 'app/aftersales case form' },
    { from: ['open', 'in_progress'], to: 'waiting_parts', action: 'Waiting parts', by: 'user', where: 'app/aftersales case form' },
    { from: ['open', 'in_progress', 'waiting_parts'], to: 'resolved', action: 'Resolve', by: 'user', where: 'app/aftersales case form' },
    { from: ['resolved'], to: 'closed', action: 'Close', by: 'user', where: 'app/aftersales case form' },
    { from: ['resolved', 'closed'], to: 'open', action: 'Reopen', by: 'user', where: 'app/aftersales case form' },
  ],
  freeSelect: 'The case form offers all five states from any state.',
  enforced: ['CHECK on 27.0_aftersales_cases.status (existing).'],
};

// ── Support letters ──────────────────────────────────────────────────────────
const SUPPORT_LETTER: Lifecycle = {
  id: 'support_letter',
  title: 'Support letter',
  table: '28.0_support_letters',
  column: 'status',
  storage: 'text+check',
  initial: 'draft',
  states: [
    S('draft', 'Draft', 'bg-slate-700/40 text-slate-300 tone-off', 'Being written.'),
    S('issued', 'Issued', 'bg-emerald-500/15 text-emerald-300 tone-done', 'Given to the customer.', { terminal: true }),
    S('cancelled', 'Cancelled', 'bg-rose-500/15 text-rose-300 tone-bad', 'Withdrawn.', { terminal: true }),
  ],
  moves: [
    { from: ['draft'], to: 'issued', action: 'Issue', by: 'user', where: 'app/support-letters form' },
    { from: ['draft'], to: 'issued', action: 'Fee marked paid', by: 'system', where: 'app/support-letters markPaid', when: 'marking the fee paid issues a draft letter' },
    { from: ['draft', 'issued'], to: 'cancelled', action: 'Cancel', by: 'user', where: 'app/support-letters form' },
    { from: ['issued', 'cancelled'], to: 'draft', action: 'Back to draft', by: 'user', where: 'app/support-letters form' },
  ],
  freeSelect: 'The letter form offers all three states from any state.',
  enforced: ['CHECK on 28.0_support_letters.status (existing).'],
};

// ── Serial numbers ───────────────────────────────────────────────────────────
const SERIAL_NUMBER: Lifecycle = {
  id: 'serial_number',
  title: 'Serial-numbered unit',
  table: '30.4_serial_numbers',
  column: 'status',
  storage: 'text+check',
  initial: 'in_stock',
  states: [
    S('in_stock', 'In stock', 'bg-sky-500/15 text-sky-300 tone-step', 'On the shelf, not spoken for.'),
    S('allocated', 'Allocated', 'bg-violet-500/15 text-violet-300 tone-step', 'Linked to a sales order.'),
    S('delivered', 'Out', 'bg-emerald-500/15 text-emerald-300 tone-done', 'Linked to a delivery order — left the warehouse.'),
    S('returned', 'Returned', 'bg-amber-500/15 text-amber-300 tone-wait', 'Came back from a customer; still linked to the order it left on until it goes back on the shelf.'),
    S('scrapped', 'Scrapped', 'bg-slate-700/40 text-slate-400 tone-off', 'Written off (the reason is in its notes).', { terminal: true }),
  ],
  moves: [
    { from: ['in_stock'], to: 'allocated', action: 'Linked to a sales order', by: 'system', where: 'trigger stamp_serial_number (mirrored by lib/serials statusFor)' },
    { from: ['in_stock', 'allocated'], to: 'delivered', action: 'Linked to a delivery order', by: 'system', where: 'trigger stamp_serial_number' },
    { from: ['allocated', 'delivered'], to: 'in_stock', action: 'Links removed', by: 'system', where: 'trigger stamp_serial_number' },
    { from: ['delivered'], to: 'returned', action: 'Returned by customer', by: 'user', where: 'app/serials unit panel (lib/serials serialMoves)', when: 'a reason is required; written to the notes' },
    { from: ['returned'], to: 'delivered', action: 'Undo return', by: 'user', where: 'app/serials unit panel' },
    { from: ['returned'], to: 'in_stock', action: 'Back on the shelf', by: 'user', where: 'app/serials unit panel', when: 'clears the order/invoice/delivery links; the note keeps which order it came from' },
    { from: ['in_stock', 'returned'], to: 'scrapped', action: 'Scrap', by: 'user', where: 'app/serials unit panel', when: 'a reason is required; written to the notes' },
    { from: ['scrapped'], to: 'in_stock', action: 'Undo scrap', by: 'user', where: 'app/serials unit panel', when: 'a unit scrapped from the shelf' },
    { from: ['scrapped'], to: 'returned', action: 'Undo scrap', by: 'user', where: 'app/serials unit panel', when: 'a unit scrapped after a return (still linked to its delivery)' },
  ],
  enforced: ['CHECK on 30.4_serial_numbers.status (existing).', 'Trigger stamp_serial_number derives in_stock / allocated / delivered from the links; returned and scrapped are kept.'],
};

// ── Buy side (Postgres enums — the database refuses any other value) ─────────
const PURCHASE_ORDER: Lifecycle = {
  id: 'purchase_order',
  title: 'Purchase order',
  table: '5.0_purchases',
  column: 'status',
  storage: 'enum',
  initial: 'Draft',
  states: [
    S('Draft', 'Draft', 'bg-slate-700/40 text-slate-300 tone-off', 'Recorded, not confirmed with the supplier.'),
    S('Sent', 'Sent', 'bg-blue-500/15 text-blue-300 tone-step', 'Sent to the supplier.', { unused: 'In the enum; no screen or agent sets it (2026-11-10: 0 rows).' }),
    S('Confirmed', 'Confirmed', 'bg-indigo-500/20 text-indigo-300 tone-step', 'Supplier confirmed (made from an accepted PI / price quote).'),
    S('Partially Received', 'Partially Received', 'bg-amber-500/20 text-amber-300 tone-wait', 'Some goods arrived.'),
    S('Fully Received', 'Fully Received', 'bg-emerald-500/20 text-emerald-300 tone-done', 'Everything arrived; counts as settled stock (lead times, landed cost).', { terminal: true }),
    S('Replaced', 'Replaced', 'bg-slate-700/40 text-slate-400 tone-off', 'Superseded by a newer PO for the same deal.', { terminal: true }),
    S('Cancelled', 'Cancelled', 'bg-red-500/15 text-red-300 tone-bad', 'Called off.', { terminal: true }),
  ],
  moves: [
    { from: ['Draft'], to: 'Confirmed', action: 'Status → Confirmed', by: 'user', where: 'components/ui/DealLookupTab status select / app/purchasing' },
    { from: ['Draft', 'Confirmed'], to: 'Partially Received', action: 'Status → Partially Received', by: 'user', where: 'components/ui/DealLookupTab status select', when: 'prompts for the received quantities' },
    { from: ['Draft', 'Confirmed', 'Partially Received'], to: 'Fully Received', action: 'Status → Fully Received', by: 'user', where: 'components/ui/DealLookupTab status select (MIRA: purchasing sync runbook)' },
    { from: ['Draft', 'Confirmed', 'Partially Received'], to: 'Replaced', action: 'Replacement PO created', by: 'system', where: 'app/purchasing createPo (replaces_po_id)' },
    { from: ['Draft', 'Confirmed'], to: 'Cancelled', action: 'Status → Cancelled', by: 'user', where: 'components/ui/DealLookupTab status select' },
  ],
  freeSelect: 'Deal Lookup offers all seven enum values from any state, the declared moves first ("Next step"), the rest under "Correction".',
  enforced: ['Postgres enum purchases_status.'],
  groups: {
    /** Goods are physically in, in part or in full (receipt gap, purchasing inbox, position, dashboard). */
    received: ['Partially Received', 'Fully Received'],
    /** Goods still owed to us, counting a PO that is only Sent (stock receive, reorder, in transit, incoming cost). */
    open: ['Sent', 'Confirmed', 'Partially Received'],
    /** The supplier has committed: confirmed or receiving (landed-cost FX, Ask). A Sent PO is NOT here. */
    placed: ['Confirmed', 'Partially Received', 'Fully Received'],
    /** Not a purchase at all: never sent, superseded or called off (balances, lead times, position, receive). */
    notAnOrder: ['Draft', 'Replaced', 'Cancelled'],
    /** Superseded or called off: hidden from the action buttons in Deal Lookup. */
    void: ['Replaced', 'Cancelled'],
  },
  notes: ['A new PO made from an accepted PI starts at Confirmed, not Draft (app/purchasing).', 'Received/landed state per line is DERIVED (lib/poProgress, lib/inTransit, lib/landedCost).'],
};

const PRICE_QUOTE: Lifecycle = {
  id: 'price_quote',
  title: 'Supplier price quote / PI',
  table: '4.0_price_quotes',
  column: 'status',
  storage: 'enum',
  initial: 'Open',
  states: [
    S('Open', 'Open', 'bg-sky-500/15 text-sky-300 tone-step', 'Quoted, no decision yet.'),
    S('Accepted', 'Accepted', 'bg-emerald-500/20 text-emerald-300 tone-done', 'A PO was made from it.', { terminal: true }),
    S('Replaced', 'Replaced', 'bg-slate-700/40 text-slate-400 tone-off', 'A newer quote superseded it.', { terminal: true }),
    S('Rejected', 'Rejected', 'bg-red-500/15 text-red-300 tone-bad', 'Declined.', { terminal: true }),
    S('Expired', 'Expired', 'bg-slate-700/40 text-slate-400 tone-off', 'Validity passed.', { terminal: true }),
  ],
  moves: [
    { from: ['Open'], to: 'Accepted', action: 'PO created from it', by: 'system', where: 'app/purchasing createPo' },
    { from: ['Open'], to: 'Replaced', action: 'Replacement quote saved', by: 'system', where: 'app/purchasing (replaces quote)' },
    { from: ['Open'], to: 'Rejected', action: 'Status → Rejected', by: 'user', where: 'app/purchasing quote status select' },
    { from: ['Open'], to: 'Expired', action: 'Status → Expired', by: 'user', where: 'app/purchasing quote status select' },
  ],
  freeSelect: 'The quote status select offers all five enum values, the declared moves first ("Next step"), the rest under "Correction".',
  enforced: ['Postgres enum price_quotes_status.'],
  groups: {
    /** Still a price we can buy at: undecided, or the one a PO was placed on (incoming cost). */
    live: ['Open', 'Accepted'],
    /** No longer the live price: superseded, refused or lapsed (Deal Lookup, item editor). */
    dead: ['Replaced', 'Rejected', 'Expired'],
  },
};

const PROFORMA: Lifecycle = {
  id: 'proforma_invoice',
  title: 'Proforma invoice (on the PO)',
  table: '5.0_purchases',
  column: 'pi_status',
  storage: 'enum',
  initial: 'Accepted',
  states: [
    S('Open', 'Open', 'bg-sky-500/15 text-sky-300 tone-step', 'PI received, not accepted.', { unused: 'In the enum; POs are created with the PI already Accepted (2026-11-10: 0 rows).' }),
    S('Accepted', 'Accepted', 'bg-emerald-500/20 text-emerald-300 tone-done', 'PI accepted; the PO stands on it.'),
    S('Replaced', 'Replaced', 'bg-slate-700/40 text-slate-400 tone-off', 'Superseded with its PO.', { terminal: true }),
    S('Rejected', 'Rejected', 'bg-red-500/15 text-red-300 tone-bad', 'Declined.', { unused: 'In the enum; nothing sets it.' }),
    S('Expired', 'Expired', 'bg-slate-700/40 text-slate-400 tone-off', 'Validity passed.', { unused: 'In the enum; nothing sets it.' }),
  ],
  moves: [
    { from: ['Accepted'], to: 'Replaced', action: 'Replacement PO created', by: 'system', where: 'app/purchasing createPo' },
  ],
  enforced: ['Postgres enum proforma_invoices_status. NULL on POs entered without a PI.'],
};

// ── Lifecycles kept in timestamps / several columns ──────────────────────────
const LIBRARY_ENTRY: Lifecycle = {
  id: 'library_entry',
  title: 'Description library entry (EPC 10.4 / Sales 22.2)',
  table: '10.4_description_library / 22.2_sales_description_library',
  column: 'status + archived_at + merged_into',
  storage: 'columns',
  initial: 'proposed',
  states: [
    S('proposed', 'Proposed', 'bg-slate-700 text-slate-300 tone-wait', 'A new wording typed by the team; waits for the owner.'),
    S('approved', 'Approved', 'bg-emerald-500/15 text-emerald-300 tone-done', 'In the library.'),
    S('archived', 'Archived', 'bg-slate-700/40 text-slate-400 tone-off', 'archived_at set; no longer suggested.'),
    S('merged', 'Merged', 'bg-slate-700/40 text-slate-400 tone-off', 'merged_into set; its spelling lives on as an alias of the winner.', { terminal: true }),
  ],
  moves: [
    { from: ['proposed'], to: 'approved', action: 'Approve', by: 'owner', where: 'RPC library_approve' },
    { from: ['proposed', 'approved'], to: 'archived', action: 'Archive', by: 'owner', where: 'RPC library_archive' },
    { from: ['proposed', 'approved'], to: 'merged', action: 'Merge', by: 'owner', where: 'RPC library_merge' },
    { from: ['archived', 'merged'], to: 'approved', action: 'Undo', by: 'owner', where: 'RPC library_undo' },
  ],
  enforced: ['No write policy: library_* functions are the only write path, each logged to 10.5_library_log and undoable.', 'A line typed by the owner creates an approved entry; by anyone else, a proposed one (trigger lib_link).'],
};

const QUOTE_ITEM_FLAG: Lifecycle = {
  id: 'quote_item_flag',
  title: 'Proposal line flag (price / technical question)',
  table: '10.7_quote_item_flags',
  column: 'resolved_at',
  storage: 'columns',
  initial: 'open',
  states: [
    S('open', 'Open', 'bg-amber-500/15 text-amber-300 tone-wait', 'resolved_at is null — waiting on the assignee.'),
    S('resolved', 'Cleared', 'bg-emerald-500/15 text-emerald-300 tone-done', 'resolved_at and resolved_by_email stamped.', { terminal: true }),
  ],
  moves: [{ from: ['open'], to: 'resolved', action: 'Clear', by: 'user', where: 'lib/quoteFlags resolveFlag' }],
  enforced: ['Trigger stamp_quote_item_flag stamps who and when.'],
};

const LANDED_COST: Lifecycle = {
  id: 'landed_cost',
  title: 'PO landed-cost posting',
  table: '5.0_purchases (computed)',
  column: '—',
  storage: 'derived',
  initial: 'awaiting',
  states: [
    S('awaiting', 'Awaiting costs', 'bg-amber-500/15 text-amber-300 tone-wait', 'Received, but freight/duty/fees are not all in.'),
    S('ready', 'Ready to post', 'bg-emerald-500/15 text-emerald-300 tone-done', 'Every cost is in; the landed cost can be posted.', { terminal: true }),
  ],
  moves: [{ from: ['awaiting'], to: 'ready', action: 'Last cost recorded', by: 'system', where: 'lib/landedCost (computed on read)' }],
  enforced: ['Computed, never stored (lib/landedCost, lib/landedAutoPost).'],
};

const TRUE_UP_QUEUE: Lifecycle = {
  id: 'true_up_queue',
  title: 'Landed-cost true-up queue',
  table: '30.5_landed_true_up_queue',
  column: 'outcome',
  storage: 'text+check',
  initial: 'pending',
  states: [
    S('pending', 'Waiting to post', 'bg-slate-700 text-slate-300 tone-wait', 'Queued by a cost write; the next drain tries to post the revaluation.'),
    S('held', 'Held', 'bg-amber-500/15 text-amber-300 tone-wait', 'The drain found a reason not to post (the hold is in note); waits for the next cost write.'),
    S('error', 'Error', 'bg-red-500/15 text-red-300 tone-bad', 'The ledger insert failed; the message is in note.'),
  ],
  moves: [
    { from: ['pending'], to: 'held', action: 'Drain: hold', by: 'system', where: 'app/api/landed/autopost (drain)' },
    { from: ['pending'], to: 'error', action: 'Drain: ledger insert failed', by: 'system', where: 'app/api/landed/autopost (drain)' },
    { from: ['held', 'error'], to: 'pending', action: 'A cost is written again', by: 'system', where: 'trigger in migrations/landed_true_up_queue.sql' },
  ],
  enforced: [
    'CHECK landed_true_up_queue_outcome_valid (migrations/true_up_queue_check.sql).',
    'Done is not a state: a posted (or already current) row is DELETED by the drain.',
  ],
  notes: [
    'The autopost API reports a failed post as "failed"; the stored row says "error".',
    'There is no claim/running state: two drains at the same time can both read the same pending row.',
  ],
};

// ── Second pass (2026-11-11): the states that were still only implied ────────
// Two DERIVED from other rows (paid? delivered?) and four kept in a date or a
// flag. None is a status column, so no CHECK applies; the declaration is what
// makes them one vocabulary for screens and agents.

const SALES_PAYMENT: Lifecycle = {
  id: 'sales_payment',
  title: 'Sales order — payment (derived)',
  table: '22.0_sales_quotes × 26.0_customer_receipts (computed)',
  column: '—',
  storage: 'derived',
  initial: 'none',
  states: [
    S('none', 'Not billed', 'bg-slate-700/40 text-slate-400 tone-off', 'Not an order yet, or nothing to bill.'),
    S('unpaid', 'Unpaid', 'bg-amber-500/15 text-amber-300 tone-wait', 'An order with no receipt against it.'),
    S('partial', 'Partial', 'bg-sky-500/15 text-sky-300 tone-step', 'Some receipts, less than the total.'),
    S('outstanding', 'Outstanding', 'bg-red-500/15 text-red-300 tone-bad', 'DELIVERED and still not fully paid — the receivable to chase.'),
    S('paid', 'Paid', 'bg-emerald-500/15 text-emerald-300 tone-done', 'Receipts cover the total (within Rp 0.5 of rounding). Delivered + paid = complete.', { terminal: true }),
  ],
  moves: [
    { from: ['none'], to: 'unpaid', action: 'Order confirmed', by: 'system', where: 'lib/salesSettlement orderPayState (computed on read)' },
    { from: ['unpaid'], to: 'partial', action: 'A receipt recorded', by: 'system', where: 'computed from 26.0_customer_receipts' },
    { from: ['unpaid', 'partial', 'outstanding'], to: 'paid', action: 'Receipts reach the total', by: 'system', where: 'computed from 26.0_customer_receipts' },
    { from: ['unpaid', 'partial'], to: 'outstanding', action: 'Order delivered before it is paid', by: 'system', where: 'computed from the order status' },
    { from: ['paid'], to: 'partial', action: 'A receipt deleted', by: 'system', where: 'computed from 26.0_customer_receipts' },
  ],
  enforced: [
    'Computed, never stored: lib/salesSettlement.ts is the only place that decides it (sales list, sales editor, print, invoices, customers all call it).',
    'paid = total > 0 AND received >= total − 0.5 (PAID_TOLERANCE_IDR). The same rule per invoice (settlement()).',
  ],
  notes: ['A single invoice uses the three-state form: unpaid / partial / paid.'],
};

const SALES_DELIVERY: Lifecycle = {
  id: 'sales_delivery',
  title: 'Sales order — delivery (derived)',
  table: '22.0_sales_quotes × 24.0_delivery_orders (computed)',
  column: '—',
  storage: 'derived',
  initial: 'none',
  states: [
    S('none', 'No delivery yet', 'bg-slate-700/40 text-slate-400 tone-off', 'No delivery order exists.'),
    S('preparing', 'Preparing', 'bg-orange-500/15 text-orange-300 tone-wait', 'Delivery orders exist, none delivered.'),
    S('partial', 'Partly delivered', 'bg-sky-500/15 text-sky-300 tone-step', 'At least one delivery order delivered, the order not yet complete.'),
    S('delivered', 'Delivered', 'bg-emerald-500/15 text-emerald-300 tone-done', 'The order itself is delivered (every line shipped).', { terminal: true }),
  ],
  moves: [
    { from: ['none'], to: 'preparing', action: 'Delivery order created', by: 'system', where: 'lib/salesSettlement orderDeliveryState (computed on read)' },
    { from: ['preparing'], to: 'partial', action: 'One delivery order delivered', by: 'system', where: 'computed from 24.0_delivery_orders' },
    { from: ['preparing', 'partial'], to: 'delivered', action: 'Every line delivered', by: 'system', where: 'components/ui/FulfillmentPanel markDelivered sets the order to delivered' },
    { from: ['delivered', 'partial'], to: 'preparing', action: 'A delivery order reopened', by: 'system', where: 'components/ui/FulfillmentPanel reopenDo' },
  ],
  enforced: ['Computed, never stored: lib/salesSettlement.ts orderDeliveryState.'],
};

const CATALOGUE_ITEM: Lifecycle = {
  id: 'catalogue_item',
  title: 'Catalogue item',
  table: '3.0_components',
  column: 'archived_at',
  storage: 'columns',
  initial: 'active',
  states: [
    S('active', 'Active', 'bg-emerald-500/15 text-emerald-300 tone-done', 'archived_at is null — offered in pickers, price lists and to agents.'),
    S('archived', 'Archived', 'bg-slate-700/40 text-slate-400 tone-off', 'archived_at set (with who): hidden from everything describing what is available now; history keeps it.'),
  ],
  moves: [
    { from: ['active'], to: 'archived', action: 'Archive', by: 'user', where: 'components/ui/ComponentEditor setArchived (one item or a selection)' },
    { from: ['archived'], to: 'active', action: 'Restore', by: 'user', where: 'components/ui/ComponentEditor setArchived' },
  ],
  enforced: ['A timestamp, not a status: readers test archived_at IS NULL (lib/itemVisibility). Agents: exclude archived_at IS NOT NULL from anything describing what is available now.'],
  notes: ['quote_cost_mode = hidden is a SEPARATE switch (kept out of EPC proposals and support letters), not a lifecycle state.'],
};

const CUSTOMER: Lifecycle = {
  id: 'customer',
  title: 'Customer',
  table: '20.0_customers',
  column: 'is_active',
  storage: 'columns',
  initial: 'active',
  states: [
    S('active', 'Active', 'bg-emerald-500/15 text-emerald-300 tone-done', 'is_active = true.'),
    S('inactive', 'Inactive', 'bg-slate-700/40 text-slate-400 tone-off', 'is_active = false: kept for history, no longer worked.'),
  ],
  moves: [
    { from: ['active'], to: 'inactive', action: 'Set Inactive', by: 'user', where: 'app/customers form and bulk bar' },
    { from: ['inactive'], to: 'active', action: 'Set Active', by: 'user', where: 'app/customers form and bulk bar' },
  ],
  enforced: ['A boolean column; nothing else guards it.'],
};

const SUPPORT_LETTER_FEE: Lifecycle = {
  id: 'support_letter_fee',
  title: 'Support letter — fee',
  table: '28.0_support_letters',
  column: 'fee_paid_at',
  storage: 'columns',
  initial: 'unpaid',
  states: [
    S('unpaid', 'Unpaid', 'bg-amber-500/15 text-amber-300 tone-wait', 'fee_paid_at is null (and the fee is above zero).'),
    S('paid', 'Paid', 'bg-emerald-500/15 text-emerald-300 tone-done', 'fee_paid_at carries the date the fee landed.'),
  ],
  moves: [
    { from: ['unpaid'], to: 'paid', action: 'Mark paid', by: 'user', where: 'app/support-letters markPaid', when: 'also issues a draft letter (support_letter draft → issued)' },
    { from: ['paid'], to: 'unpaid', action: 'Unmark paid', by: 'user', where: 'app/support-letters markPaid' },
  ],
  enforced: ['A date column; independent of the letter status except that paying issues a draft.'],
};

const QUOTE_NOTE: Lifecycle = {
  id: 'quote_note',
  title: 'Proposal note',
  table: '10.5_quote_notes',
  column: 'cleared_at',
  storage: 'columns',
  initial: 'open',
  states: [
    S('open', 'Open', 'bg-amber-500/15 text-amber-300 tone-wait', 'cleared_at is null — still to be dealt with.'),
    S('cleared', 'Settled', 'bg-emerald-500/15 text-emerald-300 tone-done', 'cleared_at and cleared_by_email stamped.'),
  ],
  moves: [
    { from: ['open'], to: 'cleared', action: 'Tick off', by: 'user', where: 'lib/quoteNotes setNoteCleared' },
    { from: ['cleared'], to: 'open', action: 'Put back', by: 'user', where: 'lib/quoteNotes setNoteCleared', when: 'ticking the wrong line is a slip' },
  ],
  enforced: ['Writable by anyone who can view EPC (can_view_epc), on purpose: a note must work on a locked proposal.'],
};

export const LIFECYCLES: Lifecycle[] = [
  EPC_PROPOSAL, SALES_DOCUMENT, DELIVERY_ORDER, AFTERSALES_CASE, SUPPORT_LETTER, SERIAL_NUMBER,
  PURCHASE_ORDER, PRICE_QUOTE, PROFORMA, LIBRARY_ENTRY, QUOTE_ITEM_FLAG, LANDED_COST, TRUE_UP_QUEUE,
  SALES_PAYMENT, SALES_DELIVERY, CATALOGUE_ITEM, CUSTOMER, SUPPORT_LETTER_FEE, QUOTE_NOTE,
];

export type LifecycleId =
  | 'epc_proposal' | 'sales_document' | 'delivery_order' | 'aftersales_case' | 'support_letter' | 'serial_number'
  | 'purchase_order' | 'price_quote' | 'proforma_invoice' | 'library_entry' | 'quote_item_flag' | 'landed_cost'
  | 'true_up_queue'
  | 'sales_payment' | 'sales_delivery' | 'catalogue_item' | 'customer' | 'support_letter_fee' | 'quote_note';

export function lifecycle(id: LifecycleId): Lifecycle {
  const l = LIFECYCLES.find((x) => x.id === id);
  if (!l) throw new Error(`Unknown lifecycle ${id}`);
  return l;
}

export const stateIds = (id: LifecycleId): string[] => lifecycle(id).states.map((s) => s.id);

/** label + cls per state — the shape the screens' status maps always had. */
export function badgeMap(id: LifecycleId): Record<string, { label: string; cls: string }> {
  return Object.fromEntries(lifecycle(id).states.map((s) => [s.id, { label: s.label, cls: s.cls }]));
}

/** Is `to` one declared move away from `from`? */
export const canMove = (id: LifecycleId, from: string, to: string): boolean =>
  lifecycle(id).moves.some((m) => m.to === to && m.from.includes(from));

/** The declared moves out of a state. */
export const movesFrom = (id: LifecycleId, from: string): Move[] =>
  lifecycle(id).moves.filter((m) => m.from.includes(from));

// ── Groups: what code counts with ───────────────────────────────────────────
/** The states of a named group, in declaration order. Throws on a typo — a group that silently matched nothing is how this module came to exist. */
export function groupList(id: LifecycleId, group: string): string[] {
  const g = lifecycle(id).groups?.[group];
  if (!g) throw new Error(`Lifecycle ${id} has no group ${group}`);
  return g;
}
/** A group as a Set — the shape the readers already used. */
export const groupSet = (id: LifecycleId, group: string): ReadonlySet<string> => new Set(groupList(id, group));
/** Is `status` in the group? Null and unknown spellings never are. */
export const inGroup = (id: LifecycleId, group: string, status: string | null | undefined): boolean =>
  status != null && groupList(id, group).includes(status);

/**
 * A status menu for a free select: the declared moves out of `current` first
 * (its NEXT STEPS), then every other state as a CORRECTION — nothing is taken
 * away, a mistake can still be put right, but the ordinary step is no longer
 * buried among states that make no sense from here.
 */
export function menuFor(id: LifecycleId, current: string | null | undefined): { next: string[]; corrections: string[] } {
  const all = stateIds(id);
  const targets = new Set(current == null ? [] : movesFrom(id, current).map((m) => m.to));
  const next = all.filter((s) => s !== current && targets.has(s));
  return { next, corrections: all.filter((s) => s !== current && !targets.has(s)) };
}

// ── The sales editor's header buttons ────────────────────────────────────────
export interface SalesAction { label: string; to: string; primary?: boolean; danger?: boolean }

/**
 * The status buttons on a sales document, in the order they are shown. Every
 * one is a declared `user` move of `sales_document` (lib/lifecycles.test.ts
 * holds it to that, and to the buttons the editor showed before).
 *
 * @param orderMode entered via "+ New Order": a draft offers only Confirm Order
 * @param hasInvoice Revert from Preparing lands on Invoiced only when an invoice exists
 */
export function salesDocumentActions(st: string, opts: { orderMode: boolean; hasInvoice: boolean }): SalesAction[] {
  const a: SalesAction[] = [];
  const quoteSide = ['draft', 'validated', 'sent', 'accepted'];
  if (st === 'draft' && !opts.orderMode) { a.push({ label: 'Validate', to: 'validated', primary: true }); a.push({ label: 'Sent', to: 'sent' }); }
  if (st === 'validated') a.push({ label: 'Sent', to: 'sent', primary: true });
  if (st === 'sent') a.push({ label: 'Accepted', to: 'accepted' });
  // Draft included (owner, 2026-08-19): not every order arrives through a quotation.
  if (quoteSide.includes(st)) a.push({ label: 'Confirm Order', to: 'ordered', primary: opts.orderMode || !['draft', 'validated'].includes(st) });
  // Every stage stays revertible — including a delivered order.
  if (st === 'ordered') a.push({ label: 'Revert', to: 'accepted' });
  if (st === 'invoiced') a.push({ label: 'Revert', to: 'ordered' });
  if (st === 'preparing') a.push({ label: 'Revert', to: opts.hasInvoice ? 'invoiced' : 'ordered' });
  if (st === 'delivered') a.push({ label: 'Reopen', to: 'preparing' });
  if (['cancelled', 'rejected'].includes(st)) a.push({ label: 'Reopen', to: 'draft' });
  if (['draft', 'validated', 'sent'].includes(st)) a.push({ label: 'Reject', to: 'rejected', danger: true });
  if (['accepted', 'ordered', 'invoiced', 'preparing'].includes(st)) a.push({ label: 'Cancel', to: 'cancelled', danger: true });
  return a;
}

// ── For agents ───────────────────────────────────────────────────────────────
/** Plain JSON for /api/agent/onboarding: every lifecycle, its values and its legal moves. */
export function describeLifecycles() {
  return LIFECYCLES.map((l) => ({
    id: l.id, title: l.title, table: l.table, column: l.column, storage: l.storage, initial: l.initial,
    states: l.states.map(({ id, label, meaning, terminal, unused }) => ({
      value: id, label, meaning, ...(terminal ? { terminal } : {}), ...(unused ? { unused } : {}),
    })),
    moves: l.moves.map(({ from, to, action, by, where, when }) => ({ from, to, action, by, where, ...(when ? { when } : {}) })),
    ...(l.freeSelect ? { free_select: l.freeSelect } : {}),
    enforced: l.enforced,
    ...(l.notes ? { notes: l.notes } : {}),
    ...(l.groups ? { groups: l.groups } : {}),
  }));
}
