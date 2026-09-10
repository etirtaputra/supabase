/**
 * Bahasa Indonesia for ICAPROC — the whole app, menus included.
 *
 * THE 2026-08-19 RULE IS WITHDRAWN. It used to read "menu labels stay English
 * — 'Stock', 'Deal Lookup', 'Landed Cost' are the vocabulary the team already
 * shares with suppliers and customers". The owner reversed it on 2026-08-25:
 * *"Make the Indonesia language settings, fully Bahasa Indonesia, including
 * the menus."* Choosing Indonesian now turns the navigation, the group
 * headers, the dashboard panel names, the quick actions and the role names,
 * not only the sentences that explain them.
 *
 * What survives the reversal is the reason behind it, narrowed to the words
 * that are not words at all — see KEEPERS below.
 *
 * KEYED BY THE ENGLISH STRING, deliberately. A phrase book, not a key
 * namespace:
 *
 *   • nothing has to be invented — the call site already reads as the sentence
 *     it renders, so English screens stay readable in the source;
 *   • an untranslated string falls back to itself, so a half-finished
 *     dictionary shows English rather than `hints.stock.subtitle`;
 *   • adding a translation later needs no code change, only a line here.
 *
 * The cost is that editing the English text orphans its translation. That is
 * the right trade for a two-language app: the orphan shows as English, which is
 * exactly what it was before, and `npm test` lists any entry whose English side
 * no longer appears anywhere in the app.
 */
export type Lang = 'en' | 'id';

/**
 * The words that stay English in BOTH languages (owner's call, 2026-08-25:
 * "codes and units only").
 *
 * These are not English words competing with Indonesian ones — they are codes
 * and units. They are printed on the documents suppliers and customers hold,
 * typed into Spotlight, and said aloud unchanged in an Indonesian sentence
 * ("PO-nya sudah keluar"). Translating a code invents a second name for one
 * thing, which is the fault the old menus-stay-English rule was really aimed
 * at.
 *
 * A keeper CANNOT be listed in the phrase book: an entry whose Indonesian
 * equals its English is an untranslated line, and `lib/i18n.test.ts` rejects
 * it. So a keeper is registered HERE and omitted THERE — and the guard test
 * reads this list to decide whether a menu label is allowed to have no
 * translation.
 */
export const KEEPERS: readonly string[] = [
  // Documents, by the code that is stamped on them
  'PO', 'PI', 'GRN', 'DO', 'SO', 'SQ', 'INV', 'RCPT',
  // Item and trade vocabulary that is already a code
  'SKU', 'kWp', 'PPN', 'EPC', 'FOB', 'CIF',
  // Words Indonesian spells identically — a phrase-book entry for one of
  // these would equal its own English and fail the test, so it lives here
  // instead of being a translation that translates nothing.
  'Admin', 'Menu', 'Status', 'Subtotal', 'Total', 'SVC', 'LIB', 'PREV',
];

/** Is this string left in English on purpose, rather than simply untranslated? */
export const isKeeper = (en: string): boolean => KEEPERS.includes(en);

/**
 * English → Bahasa Indonesia.
 *
 * House vocabulary, chosen once and kept consistent:
 *   supplier → pemasok · customer → pelanggan · stock → stok ·
 *   purchase order → PO · sales order → SO · warehouse → gudang ·
 *   landed cost → biaya sampai gudang · serial number → nomor seri ·
 *   delivery order → surat jalan · invoice → faktur · payment → pembayaran
 */
/**
 * A NOTE ON LENGTH, learned the hard way (2026-08-21).
 *
 * Indonesian runs longer than English — often 50% longer for a full sentence,
 * which is fine in a paragraph and fatal in a button. "Previous landed costs
 * for this item" became a tooltip that wrapped and left "ini" orphaned on its
 * own line; "Prev" became "Sebelumnya", two and a half times the width of the
 * pager button holding it.
 *
 * So the slot decides the wording. In a sentence, empty state or hint, say it
 * properly. In a button, badge, tile label or column heading, say it SHORT —
 * drop what the surrounding screen already tells the reader ("untuk barang
 * ini" adds nothing on that item's own row) and prefer the word the trade
 * already shortens to (transit, eksternal). A translation that gets clipped
 * communicates less than the English it replaced.
 */
export const ID: Record<string, string> = {
  // ── Margin tiers (21.2_margin_profiles) ──────────────────────────────────
  // The tier LABELS are data an admin types, so they are NOT translated here —
  // "Loss Leader" is whatever the owner named it on /pricing. Only the app's
  // own words around them are.
  'Margin Tier': 'Tingkat Margin',
  'Unclassified': 'Belum Dikelompokkan',
  'All Margin Tiers': 'Semua Tingkat Margin',
  'Margin Profiles': 'Profil Margin',
  'Margin tier': 'Tingkat margin',
  'No margin profile set — this item has no target margin yet':
    'Belum ada profil margin — barang ini belum punya target margin',
  'Filter by margin tier': 'Saring berdasarkan tingkat margin',

  // ── Follow-up notes on an EPC proposal (10.5_quote_notes) ────────────────
  'Edit': 'Ubah',
  'Save': 'Simpan',
  'edited {when}': 'diubah {when}',
  'Nothing open — this proposal is not waiting on anything.':
    'Tidak ada yang terbuka — proposal ini tidak sedang menunggu apa pun.',
  'Hide settled': 'Sembunyikan yang selesai',
  'Show {n} settled note': 'Tampilkan {n} catatan selesai',
  'Show {n} settled notes': 'Tampilkan {n} catatan selesai',
  'Follow-up notes': 'Catatan tindak lanjut',
  'internal — never shown to the customer': 'internal — tidak pernah ditampilkan ke pelanggan',
  '{n} open': '{n} terbuka',
  'e.g. Awaiting answer from the customer on the revised scope':
    'mis. Menunggu jawaban pelanggan atas lingkup yang direvisi',
  'Saving…': 'Menyimpan…',
  'Post': 'Kirim',
  'Nothing noted yet. Anything written here shows on the EPC Proposals list until it is ticked off.':
    'Belum ada catatan. Apa pun yang ditulis di sini tampil di daftar EPC Proposal sampai dicentang selesai.',
  'Tick off: {body}': 'Tandai selesai: {body}',
  'Reopen: {body}': 'Buka lagi: {body}',
  'Tick off — takes it off the list, keeps it here':
    'Tandai selesai — hilang dari daftar, tetap tersimpan di sini',
  'Put this back on the list': 'Kembalikan ke daftar',
  'someone': 'seseorang',
  'ticked off {when}': 'diselesaikan {when}',
  '{body} — {n} notes open, newest {date}': '{body} — {n} catatan terbuka, terbaru {date}',
  '{body} — raised {date}': '{body} — dibuat {date}',
  'Proposals with a follow-up note still open': 'Proposal yang catatan tindak lanjutnya masih terbuka',
  'All notes': 'Semua catatan',
  'Open note ({n})': 'Catatan terbuka ({n})',
  'Nothing open': 'Tidak ada yang terbuka',

  // ── Document statuses ─────────────────────────────────────────────────────
  // Stored in the database in ENGLISH (constants/enums.ts, lib/salesStatus.ts)
  // and translated only where they are SHOWN — never where they are written,
  // compared or sent to Supabase. A dropdown keeps the English in its `value`
  // and translates only the option text.
  //
  // Both cases appear: sales and purchase documents store Title Case
  // ("Fully Received"), EPC proposals store lower case ("draft"). Same word,
  // two keys, because the phrase book is keyed by the exact string rendered.
  'Draft': 'Konsep',
  'Validated': 'Tervalidasi',
  'Sent': 'Dikirim',
  'Accepted': 'Diterima',
  'Confirmed Order': 'Dipesan',
  'Preparing Items': 'Disiapkan',
  'Cancelled': 'Dibatalkan',
  'Rejected': 'Ditolak',
  'Confirmed': 'Dikonfirmasi',
  'Replaced': 'Diganti',
  'Partially Received': 'Diterima Sebagian',
  'Fully Received': 'Diterima Penuh',
  'draft': 'konsep',
  'sent': 'dikirim',
  'accepted': 'diterima',
  'rejected': 'ditolak',
  'cancelled': 'dibatalkan',
  'This document was {status}. Reopen it to continue the milestone flow.':
    'Dokumen ini {status}. Buka kembali untuk melanjutkan alur milestone.',

  // ══ THE DASHBOARD ═════════════════════════════════════════════════════════
  // English picks between a singular and a plural template; Indonesian has
  // neither, so the two English forms map to the same Indonesian line. That is
  // not duplication to tidy away — it is the whole reason the template is
  // chosen in the code rather than glued together with an "s".

  // ── The customise panel (app/page.tsx) ────────────────────────────────────
  'Customise': 'Sesuaikan',
  'Your dashboard': 'Dasbor Anda',
  'Reset to my role’s default': 'Kembalikan ke bawaan peran saya',
  'Done': 'Selesai',
  'Everything is switched off — the dashboard below is empty until you tick something.':
    'Semua panel dimatikan — dasbor di bawah kosong sampai Anda mencentang sesuatu.',
  'There is no dashboard panel for this role — your work lives in the menu above.':
    'Tidak ada panel dasbor untuk peran ini — pekerjaan Anda ada di menu di atas.',
  'Nothing is switched on yet.': 'Belum ada yang dinyalakan.',
  'Every panel is switched off — press Customise to bring one back.':
    'Semua panel dimatikan — tekan Sesuaikan untuk menampilkannya lagi.',

  // ── KPI tiles ─────────────────────────────────────────────────────────────
  'on-hand × avg landed cost': 'stok × biaya sampai gudang rata-rata',
  'not cancelled': 'belum dibatalkan',
  'in catalog': 'di katalog',

  // ── Needs you today (the queue) ───────────────────────────────────────────
  'At stake': 'Nilai tertahan',
  '{n} item': '{n} barang',
  '{n} items': '{n} barang',
  '{n} of {total}': '{n} dari {total}',
  'Nothing is blocked — every confirmed order can ship, and no invoice or quotation is waiting on a chase.':
    'Tidak ada yang tertahan — semua pesanan yang dikonfirmasi bisa dikirim, dan tidak ada faktur atau penawaran yang menunggu ditagih.',
  '{n} order cannot ship': '{n} pesanan tidak bisa dikirim',
  '{n} orders cannot ship': '{n} pesanan tidak bisa dikirim',
  '{n} item short of confirmed demand': '{n} barang kurang dari permintaan yang sudah pasti',
  '{n} items short of confirmed demand': '{n} barang kurang dari permintaan yang sudah pasti',
  '{n} invoice past {days} days': '{n} faktur lewat {days} hari',
  '{n} invoices past {days} days': '{n} faktur lewat {days} hari',
  'oldest {oldest} days — cash already earned, not collected':
    'terlama {oldest} hari — uang sudah didapat, belum tertagih',
  '{n} quotation awaiting an answer': '{n} penawaran menunggu jawaban',
  '{n} quotations awaiting an answer': '{n} penawaran menunggu jawaban',
  'sent over {sent} days ago — oldest {oldest} days':
    'dikirim lebih dari {sent} hari lalu — terlama {oldest} hari',
  'sent over {sent} days ago — oldest {oldest} days · {expired} past validity':
    'dikirim lebih dari {sent} hari lalu — terlama {oldest} hari · {expired} lewat masa berlaku',
  '{n} received PO still unpaid': '{n} PO diterima belum dibayar',
  '{n} received POs still unpaid': '{n} PO diterima belum dibayar',
  'goods are in the warehouse; the supplier is waiting':
    'barang sudah di gudang; pemasok menunggu',
  '{n} PO overdue': '{n} PO terlambat',
  '{n} POs overdue': '{n} PO terlambat',
  'past expected arrival — oldest {late} days late; chase the supplier':
    'lewat perkiraan kedatangan — terlama {late} hari; tagih pemasok',
  'paid for, past expected arrival — oldest {late} days late; chase the supplier':
    'sudah dibayar, lewat perkiraan kedatangan — terlama {late} hari; tagih pemasok',
  '{n} PO costing more than stock says': '{n} PO berbiaya lebih tinggi dari catatan stok',
  '{n} POs costing more than stock says': '{n} PO berbiaya lebih tinggi dari catatan stok',
  'bills landed after the goods did — post the correction and stock value catches up':
    'tagihan datang setelah barangnya — catat koreksinya dan nilai stok menyusul',
  'bills landed after the goods were sold — the margin on them was overstated':
    'tagihan datang setelah barangnya terjual — marginnya tercatat terlalu tinggi',
  '{n} item at reorder point': '{n} barang di titik pemesanan ulang',
  '{n} items at reorder point': '{n} barang di titik pemesanan ulang',
  '{n} projected to stock out before a PO raised today could arrive':
    '{n} diperkirakan habis sebelum PO yang dibuat hari ini bisa tiba',
  'live + incoming at or below demand over lead time + safety buffer':
    'tersedia + dalam perjalanan sama atau di bawah permintaan selama lead time + cadangan aman',
  '{n} movement not on a bank account': '{n} mutasi belum terhubung ke rekening bank',
  '{n} movements not on a bank account': '{n} mutasi belum terhubung ke rekening bank',
  'until they are tagged, no statement reconciles':
    'selama belum ditandai, tidak ada rekening koran yang cocok',

  // ── New arrivals ──────────────────────────────────────────────────────────
  '{n} new': '{n} baru',
  '{n} restocked': '{n} diisi ulang',
  'Products →': 'Produk →',
  'Nothing has landed in the last {days} days. Settings › Defaults sets how long an item counts as new.':
    'Tidak ada barang masuk dalam {days} hari terakhir. Pengaturan › Bawaan menentukan berapa lama sebuah barang dihitung baru.',
  'The first time we have ever taken this item into stock':
    'Pertama kalinya barang ini masuk ke stok kita',
  'New': 'Baru',
  'It is on the shelf but has no selling price, so nobody can quote it':
    'Barangnya ada di gudang tapi belum punya harga jual, jadi belum bisa ditawarkan',
  'no selling price': 'tanpa harga jual',
  'today': 'hari ini',
  '{n}d ago': '{n}h lalu',
  '{n} of {all} cannot be quoted yet — no selling price.':
    '{n} dari {all} belum bisa ditawarkan — tanpa harga jual.',
  'Everything that landed has a price.': 'Semua yang masuk sudah berharga.',
  '+{n} more →': '+{n} lagi →',

  // ── Arriving soon ─────────────────────────────────────────────────────────
  'no date': 'tanpa tanggal',
  '{n}d late': '{n}h terlambat',
  'in {n}d': '{n}h lagi',
  '{n} late': '{n} terlambat',
  'Nothing is on order — every purchase order has been received or closed.':
    'Tidak ada pesanan berjalan — semua PO sudah diterima atau ditutup.',
  'Estimated from this supplier’s own measured lead time — the supplier gave us no date':
    'Diperkirakan dari lead time terukur pemasok ini — pemasok tidak memberi tanggal',
  'est.': 'perk.',
  '(est.)': '(perk.)',
  '{n} of {all} open PO carries no supplier date — those are estimates.':
    '{n} dari {all} PO berjalan tidak punya tanggal dari pemasok — itu perkiraan.',
  '{n} of {all} open POs carry no supplier date — those are estimates.':
    '{n} dari {all} PO berjalan tidak punya tanggal dari pemasok — itu perkiraan.',
  '{n} PO is past due with nothing received — late, or already here and never booked in.':
    '{n} PO lewat jatuh tempo tanpa penerimaan — terlambat, atau sudah tiba tapi belum dicatat masuk.',
  '{n} POs are past due with nothing received — late, or already here and never booked in.':
    '{n} PO lewat jatuh tempo tanpa penerimaan — terlambat, atau sudah tiba tapi belum dicatat masuk.',
  '{n} PO is past due with nothing received, the oldest raised {days} days ago — late, or already here and never booked in.':
    '{n} PO lewat jatuh tempo tanpa penerimaan, yang terlama dibuat {days} hari lalu — terlambat, atau sudah tiba tapi belum dicatat masuk.',
  '{n} POs are past due with nothing received, the oldest raised {days} days ago — late, or already here and never booked in.':
    '{n} PO lewat jatuh tempo tanpa penerimaan, yang terlama dibuat {days} hari lalu — terlambat, atau sudah tiba tapi belum dicatat masuk.',
  '+{n} more on order.': '+{n} lagi dalam pesanan.',

  // ── Stock alerts ──────────────────────────────────────────────────────────
  '{n} short': '{n} kurang',
  '{n} to reorder': '{n} perlu dipesan ulang',
  'Nothing to flag — every committed order can ship, and no item is at its reorder point.':
    'Tidak ada yang perlu ditandai — semua pesanan yang sudah pasti bisa dikirim, dan tidak ada barang di titik pemesanan ulang.',
  'short {qty}': 'kurang {qty}',
  'have {have} · committed {committed}': 'ada {have} · dipesan {committed}',
  '{customer} — waiting on {qty}': '{customer} — menunggu {qty}',
  'No customer': 'Tanpa pelanggan',
  'order ~{qty}': 'pesan ~{qty}',
  'At the current demand rate, stock runs out before a PO raised today could arrive':
    'Dengan laju permintaan saat ini, stok habis sebelum PO yang dibuat hari ini bisa tiba',
  'stock-out before replenishment': 'habis sebelum barang tiba',
  'live {live} · covers {cover}d · lead {lead}d':
    'tersedia {live} · cukup {cover}h · lead time {lead}h',
  'live {live} + {incoming} incoming · covers {cover}d · lead {lead}d':
    'tersedia {live} + {incoming} dalam perjalanan · cukup {cover}h · lead time {lead}h',
  'New PO →': 'PO baru →',

  // ── Position strip ────────────────────────────────────────────────────────
  'Cash': 'Kas',
  'across all bank accounts': 'di seluruh rekening bank',
  'unavailable right now': 'tidak tersedia saat ini',
  '{n} account': '{n} rekening',
  '{n} accounts': '{n} rekening',
  'Owed to us': 'Sisa piutang',
  'open customer invoices': 'faktur pelanggan yang belum lunas',
  'every invoice is settled': 'semua faktur sudah lunas',
  '{n} open invoice': '{n} faktur berjalan',
  '{n} open invoices': '{n} faktur berjalan',
  '{amount} overdue': '{amount} lewat jatuh tempo',
  'We owe': 'Sisa utang',
  'unpaid across active POs': 'belum dibayar di PO aktif',
  'every active PO is paid': 'semua PO aktif sudah dibayar',
  // '{n} PO' is omitted deliberately: PO is a keeper, so the English form is
  // already the Indonesian one and an entry for it would equal itself.
  '{n} POs': '{n} PO',
  '{amount} for goods received': '{amount} untuk barang yang sudah diterima',
  '{n} unrated excl.': '{n} tanpa kurs, dikecualikan',
  '{amount} on the water': '{amount} dalam perjalanan',
  '{n} overdue': '{n} lewat jatuh tempo',
  'CCC · the runway': 'CCC · masa perputaran',
  'cash out → cash back, in days': 'kas keluar → kas kembali, dalam hari',
  'nothing delivered in the last 90d to measure against':
    'tidak ada pengiriman dalam 90 hari terakhir sebagai pembanding',
  '{n} delivery in 90d — too little to measure':
    '{n} pengiriman dalam 90 hari — terlalu sedikit untuk diukur',
  '{n} deliveries in 90d — too little to measure':
    '{n} pengiriman dalam 90 hari — terlalu sedikit untuk diukur',
  '{n} delivery in 90d, {uncosted} with no cost — too little to measure':
    '{n} pengiriman dalam 90 hari, {uncosted} tanpa biaya — terlalu sedikit untuk diukur',
  '{n} deliveries in 90d, {uncosted} with no cost — too little to measure':
    '{n} pengiriman dalam 90 hari, {uncosted} tanpa biaya — terlalu sedikit untuk diukur',
  'DIO {dio} + DSO {dso} − DPO {dpo} · 90-day basis':
    'DIO {dio} + DSO {dso} − DPO {dpo} · basis 90 hari',
  'DIO {dio} + DSO {dso} + {prepaid} prepaid · 90-day basis':
    'DIO {dio} + DSO {dso} + {prepaid} dibayar di muka · basis 90 hari',

  // ── Month in motion ───────────────────────────────────────────────────────
  'vs same days last month': 'vs hari yang sama bulan lalu',
  'Same days last month: {amount}': 'Hari yang sama bulan lalu: {amount}',
  'no base': 'tanpa pembanding',
  'Invoiced': 'Ditagih',
  'Collected': 'Diterima',

  // ── Next best step ────────────────────────────────────────────────────────
  'Ask again with today’s numbers': 'Tanya ulang dengan angka hari ini',
  'refresh': 'muat ulang',
  'The advisor is unavailable right now — the queue above still ranks what matters by money at stake.':
    'Penasihat tidak tersedia saat ini — daftar di atas tetap mengurutkan yang penting berdasarkan nilai tertahan.',
  'Reads the same numbers this page shows. It proposes — you decide.':
    'Membaca angka yang sama dengan halaman ini. Ia mengusulkan — Anda yang memutuskan.',

  // ── Latest activity ───────────────────────────────────────────────────────
  'across every module': 'dari semua modul',
  'Nothing recent.': 'Belum ada aktivitas.',
  'Invoice': 'Faktur',
  'Order': 'Pesanan',
  'Quote': 'Penawaran',
  'Received': 'Diterima',
  'Paid out': 'Dibayar',
  'customer payment': 'pembayaran pelanggan',
  '(no number)': '(tanpa nomor)',

  // ── Leaderboards ──────────────────────────────────────────────────────────
  'Unnamed item': 'Barang tanpa nama',
  'Unnamed customer': 'Pelanggan tanpa nama',
  'products': 'produk',
  'customers': 'pelanggan',
  '{qty} sold · {orders} order': '{qty} terjual · {orders} pesanan',
  '{qty} sold · {orders} orders': '{qty} terjual · {orders} pesanan',
  '{orders} order · {qty} items': '{orders} pesanan · {qty} barang',
  '{orders} orders · {qty} items': '{orders} pesanan · {qty} barang',
  '{pct}% margin': 'margin {pct}%',
  'All {n} {noun} that have sold in this period.': 'Semua {n} {noun} yang terjual pada periode ini.',
  'Top {shown} of {n} {noun} that have sold.': '{shown} teratas dari {n} {noun} yang terjual.',

  // ── Arranging the menu and the dashboard (Settings + Customise) ───────────
  'Hide {name}': 'Sembunyikan {name}',
  'Show {name}': 'Tampilkan {name}',
  'Move {name} up': 'Naikkan {name}',
  'Move {name} down': 'Turunkan {name}',
  'Opens here': 'Panel awal',
  'Off': 'Mati',
  '{role} has no dashboard panel at all — its work lives in the menu.':
    '{role} tidak punya panel dasbor sama sekali — pekerjaannya ada di menu.',
  '{role} opens on {on} of {all} panels it may see.':
    '{role} membuka {on} dari {all} panel yang boleh dilihatnya.',
  'A panel switched off is still offered, unticked, in that person’s own Customise panel.':
    'Panel yang dimatikan tetap ditawarkan, tanpa centang, di panel Sesuaikan orang tersebut.',
  '{email} can now sign in as {role}': '{email} kini bisa masuk sebagai {role}',

  // ── Menu labels (constants/navigation.ts) ─────────────────────────────────
  // The 2026-08-25 reversal: these used to be deliberately English. Kept
  // SHORT — a nav label lives in a 192px dropdown and, on the desktop bar,
  // in a row that already needs 720px of header in English.
  'Dashboard': 'Dasbor',
  "What's New": 'Yang Baru',
  'Item Editor': 'Editor Barang',
  'New Deal': 'Transaksi Baru',
  'Progress': 'Progres',
  'Payments': 'Pembayaran',
  'Deal Lookup': 'Telusur Transaksi',
  'Suppliers': 'Pemasok',
  'Stock': 'Stok',
  'Receive Goods': 'Terima Barang',
  'Landed Cost': 'Biaya Sampai Gudang',
  'Purchasing': 'Pembelian',
  'Customers': 'Pelanggan',
  'Products': 'Produk',
  'Sales Orders': 'Pesanan Penjualan',
  'New Quotation': 'Penawaran Baru',
  'Sales · Description Library': 'Penjualan · Pustaka Deskripsi',
  'Invoices': 'Faktur',
  'Delivery': 'Pengiriman',
  'Serial Numbers': 'Nomor Seri',
  'After Sales': 'Purna Jual',
  'Support Letters': 'Surat Dukungan',
  'Finance': 'Keuangan',
  'Spend & Cash': 'Belanja & Kas',
  'Profitability': 'Profitabilitas',
  'Item Hub': 'Pusat Barang',
  'Tech Specs': 'Spesifikasi Teknis',
  'Enter a datasheet, and compare products side by side':
    'Masukkan lembar data, dan bandingkan produk berdampingan',
  'Spec Readiness': 'Kesiapan Spesifikasi',
  'Market Intel': 'Intel Pasar',
  'Selling Prices': 'Harga Jual',
  'Ask ICAPROC': 'Tanya ICAPROC',
  'Proposals': 'Proposal',
  'Proposals · Description Library': 'Proposal · Pustaka Deskripsi',
  'Proposals · Directory': 'Proposal · Direktori',
  'Settings': 'Pengaturan',
  'Settings · Formatting': 'Pengaturan · Format',
  'Settings · Appearance': 'Pengaturan · Tampilan',
  'Settings · Menu': 'Pengaturan · Menu',
  'Settings · Dashboard': 'Pengaturan · Dasbor',
  'Settings · Lists': 'Pengaturan · Daftar',
  'Settings · Pricing': 'Pengaturan · Harga',
  'Settings · Defaults': 'Pengaturan · Bawaan',
  'Settings · Terms': 'Pengaturan · Ketentuan',
  'Settings · Company': 'Pengaturan · Perusahaan',
  'Settings · Banks': 'Pengaturan · Bank',
  'Settings · Users': 'Pengaturan · Pengguna',
  'Import & Export': 'Impor & Ekspor',

  // ── Menu group headers (BrandMenu's GROUP_TITLE) ──────────────────────────
  // 'Admin' is a KEEPER — Indonesian spells it the same way.
  'Home': 'Beranda',
  'Sales': 'Penjualan',
  'Insights': 'Wawasan',
  'Catalog': 'Katalog',
  'Projects': 'Proyek',

  // ── The rest of the nav menu's own furniture ──────────────────────────────
  'Appearance': 'Tampilan',
  'Language': 'Bahasa',
  // The two switches name their destination: "Ganti ke Terminal Light",
  // "Ganti ke Bahasa Indonesia". Skin and language names are proper names and
  // stay as they are, in both languages.
  'Switch to {what}': 'Ganti ke {what}',
  'More': 'Lainnya',
  'More skins and the company default': 'Lebih banyak tampilan dan bawaan perusahaan',
  'Sign out': 'Keluar',

  // ── Dashboard panels (constants/dashboardWidgets.ts) ──────────────────────
  'Position': 'Posisi',
  'Needs you today': 'Perlu tindakan hari ini',
  'Next best step': 'Langkah terbaik berikutnya',
  'Month in motion': 'Pergerakan bulan ini',
  'Paid This Month': 'Dibayar Bulan Ini',
  'Stock Value': 'Nilai Stok',
  'Active POs': 'PO Aktif',
  'Components': 'Komponen',
  'New arrivals': 'Barang baru masuk',
  'Arriving soon': 'Segera tiba',
  'Top products': 'Produk teratas',
  'Top customers': 'Pelanggan teratas',
  'Stock alerts': 'Peringatan stok',
  'Last payments': 'Pembayaran terakhir',
  'Last deliveries': 'Pengiriman terakhir',
  'Last service tickets': 'Tiket servis terakhir',
  'Latest activity': 'Aktivitas terbaru',

  // ── Quick Actions (constants/dashboardWidgets.ts) ─────────────────────────
  'Quick Actions': 'Aksi Cepat',
  'New Sales Quotation': 'Penawaran Penjualan Baru',
  'New Deal — PI / PO': 'Transaksi Baru — PI / PO',
  'Log Payment': 'Catat Pembayaran',
  'New EPC Proposal': 'Proposal EPC Baru',
  'Bank Accounts': 'Rekening Bank',

  // ── Roles (constants/roles.ts) ────────────────────────────────────────────
  'Owner': 'Pemilik',
  'Buy-side Admin': 'Admin Pembelian',
  'Sell-side Admin': 'Admin Penjualan',
  'Sell-side Sales': 'Staf Penjualan',
  'Project Engineer': 'Insinyur Proyek',
  'Warehouse': 'Gudang',
  'After-Sales Desk': 'Meja Purna Jual',
  'Viewer': 'Pengamat',
  'Data Entry (legacy)': 'Entri Data (lama)',
  'Finance (legacy)': 'Keuangan (lama)',
  'Full access to everything, including user management':
    'Akses penuh ke semuanya, termasuk pengelolaan pengguna',
  'Buy-side modules (Catalog, Insights) — can edit; sees costs & brands':
    'Modul pembelian (Katalog, Wawasan) — bisa mengubah; melihat biaya & merek',
  'Sell-side modules — can edit customers, pricing, stock, invoices & receipts':
    'Modul penjualan — bisa mengubah pelanggan, harga, stok, faktur & penerimaan',
  'Sell-side sales — customers, products, sales & invoices; no back-end editing':
    'Penjualan — pelanggan, produk, penjualan & faktur; tanpa akses ubah data induk',
  'Project Quotes plus sell-side sales access':
    'Penawaran proyek ditambah akses penjualan',
  'Goods in, stock, serial numbers and shipping — no prices, no money':
    'Barang masuk, stok, nomor seri dan pengiriman — tanpa harga, tanpa uang',
  'Service tickets, serial lookup and warranty — no pricing or invoicing':
    'Tiket servis, telusur nomor seri dan garansi — tanpa harga atau faktur',
  'Read-only access to deal lookup':
    'Akses baca-saja ke telusur transaksi',
  'Legacy buy-side editor — reassign to Buy-side Admin':
    'Editor pembelian lama — pindahkan ke Admin Pembelian',
  'Legacy buy-side finance — reassign to Buy-side Admin':
    'Keuangan pembelian lama — pindahkan ke Admin Pembelian',

  // ── Menu hints (constants/navigation.ts) ──────────────────────────────────
  'Today at a glance — outstanding, paid this month, stock value':
    'Ringkasan hari ini — tagihan berjalan, pembayaran bulan ini, nilai stok',
  'The update log — what changed, and when':
    'Catatan pembaruan — apa yang berubah, dan kapan',
  'The component master — models, prices, specs, links':
    'Induk data barang — model, harga, spesifikasi, tautan',
  'Record a supplier quote / PI — alone or straight to its PO':
    'Catat penawaran pemasok / PI — sendiri atau langsung menjadi PO',
  'Record supplier payments, bank fees and landed costs':
    'Catat pembayaran ke pemasok, biaya bank dan biaya sampai gudang',
  'Set prices per tier, margin floor audit, per-item overrides':
    'Atur harga per tier, audit batas bawah margin, penyesuaian per barang',
  'Every PI → PO → payment as one deal':
    'Setiap PI → PO → pembayaran sebagai satu transaksi',
  'Which PO is at which stage — PI, PO, payments, docs, PIB':
    'PO mana di tahap mana — PI, PO, pembayaran, dokumen, PIB',
  'Vendor profiles, purchase volume, outstanding payables':
    'Profil pemasok, volume pembelian, utang yang belum dibayar',
  'On-hand per warehouse, moving-average cost, shortages':
    'Stok per gudang, biaya rata-rata bergerak, kekurangan barang',
  'Book goods in against a purchase order (GRN)':
    'Terima barang masuk berdasarkan PO (GRN)',
  'True up stock cost when the freight, duty and final payment land':
    'Sesuaikan biaya stok saat ongkos kirim, bea masuk dan pelunasan sudah masuk',
  'The procure-to-pay workspace':
    'Ruang kerja pembelian sampai pembayaran',
  'CRM — customers, contacts, account managers':
    'CRM — pelanggan, kontak, account manager',
  'What we sell, with tier prices and live stock':
    'Barang yang kami jual, dengan harga tier dan stok terkini',
  'Quotations → orders → invoices → delivery (DQ → PQ → SO)':
    'Penawaran → pesanan → faktur → pengiriman (DQ → PQ → SO)',
  'Start a new sales quotation':
    'Mulai penawaran penjualan baru',
  'Curated line texts that feed the item picker':
    'Kumpulan teks baris yang mengisi pemilih barang',
  'Accounts receivable — issued, received, outstanding':
    'Piutang — diterbitkan, diterima, belum dibayar',
  'Delivery orders and Surat Jalan':
    'Surat jalan dan dokumen pengiriman',
  'Record the serial numbers on a delivery, and find the order from one':
    'Catat nomor seri pada pengiriman, dan telusuri pesanannya dari nomor itu',
  'Service & warranty cases — repairs, replacements, complaints':
    'Kasus servis & garansi — perbaikan, penggantian, keluhan',
  'Surat Dukungan — our backing for a reseller entering a tender':
    'Surat Dukungan — dukungan kami untuk reseller yang ikut tender',
  'Bank accounts, statements and cash position':
    'Rekening bank, mutasi dan posisi kas',
  'Spend analytics, cost breakdown, positioning map':
    'Analisa pengeluaran, rincian biaya, peta posisi',
  'GP per item / customer / rep, capital allocation, cash cycle':
    'Laba kotor per barang / pelanggan / sales, alokasi modal, siklus kas',
  'Everything about one item — purchases, sales, pricing, FX, cash cycle, stock, specs':
    'Semua tentang satu barang — pembelian, penjualan, harga, kurs, siklus kas, stok, spesifikasi',
  'What the system calculators can size from — fill the missing specs':
    'Dasar perhitungan kalkulator sistem — lengkapi spesifikasi yang kosong',
  'Competitor prices and what the market is charging':
    'Harga pesaing dan harga yang berlaku di pasar',
  'Ask the AI about suppliers, costs, POs and quotes':
    'Tanya AI tentang pemasok, biaya, PO dan penawaran',
  'EPC project proposals':
    'Proposal proyek EPC',
  'Curated proposal line texts and default costs':
    'Kumpulan teks baris proposal dan biaya bawaan',
  'Merge duplicate customers, sites, addresses and brands':
    'Gabungkan duplikat pelanggan, lokasi, alamat dan merek',
  'Formatting, defaults, company, banks and users':
    'Format, nilai bawaan, perusahaan, bank dan pengguna',
  'Number, currency and date formats; list layout':
    'Format angka, mata uang dan tanggal; tata letak daftar',
  'The default skin — dark, dim, light or paper':
    'Tampilan bawaan — gelap, redup, terang atau kertas',
  'Reorder the navigation — groups and the entries inside them':
    'Atur ulang navigasi — grup dan isinya',
  'How each list opens — its default order and the period it covers':
    'Cara setiap daftar terbuka — urutan bawaan dan periode yang ditampilkan',
  'Rounding step, default markup, margin floor, customer tier':
    'Kelipatan pembulatan, markup bawaan, batas bawah margin, tier pelanggan',
  'PPN, payment terms, warehouse, thresholds':
    'PPN, termin pembayaran, gudang, ambang batas',
  'Sales payment and delivery term options':
    'Pilihan termin pembayaran dan pengiriman penjualan',
  'Letterhead, bank details and document footer':
    'Kop surat, rincian bank dan catatan kaki dokumen',
  'Bank accounts per company, defaults and the bank library':
    'Rekening bank per perusahaan, nilai bawaan dan daftar bank',
  'Roles and the sign-up allowlist':
    'Peran dan daftar email yang boleh mendaftar',
  'Bulk CSV in and out — customers, orders, invoices, receipts':
    'CSV masuk dan keluar secara massal — pelanggan, pesanan, faktur, penerimaan',

  'The house dashboard \u2014 which widgets everyone starts with, and in what order':
    'Dasbor bawaan perusahaan \u2014 widget apa yang tampil untuk semua orang, dan dalam urutan apa',

  // ── Dashboard widgets (constants/dashboardWidgets.ts) ─────────────────────
  // The names stay English (Position, Stock alerts, Quick Actions \u2014 the
  // words the team already uses); what each one TELLS you is translated.
  'Cash held, owed to us, we owe, and how fast a rupiah comes back':
    'Kas yang dipegang, piutang, utang, dan seberapa cepat satu rupiah kembali',
  'What is stuck, what it is worth, and one tap to unstick it':
    'Apa yang tertahan, berapa nilainya, dan satu ketuk untuk melepaskannya',
  'The AI reads the same numbers and proposes one move':
    'AI membaca angka yang sama lalu mengusulkan satu langkah',
  'This month so far against the same days of last month':
    'Bulan ini sejauh ini dibandingkan hari yang sama bulan lalu',
  'Principal paid to suppliers so far this month':
    'Pokok yang dibayarkan ke pemasok bulan ini',
  'On-hand quantity at moving-average landed cost':
    'Jumlah stok di gudang pada biaya sampai gudang rata-rata bergerak',
  'Purchase orders that are not cancelled':
    'PO yang tidak dibatalkan',
  'How many items the catalog carries':
    'Berapa banyak item yang ada di katalog',
  'Orders that cannot ship, and items at their reorder point':
    'Pesanan yang tidak bisa dikirim, dan item yang mencapai titik pemesanan ulang',
  'One stream of what everyone saved, across every module':
    'Satu aliran dari semua yang disimpan tim, dari seluruh modul',
  'The screens this role starts its day on, one tap away':
    'Layar tempat peran ini memulai harinya, cukup satu ketuk',
  'Tick what you want to watch, drag a row to move it (the arrows do the same on touch). This is your own arrangement, on this browser \u2014 it does not change anyone else\u2019s.':
    'Centang yang ingin Anda pantau, seret baris untuk memindahkannya (panah melakukan hal yang sama di layar sentuh). Ini susunan Anda sendiri, di peramban ini \u2014 tidak mengubah milik orang lain.',
  'What landed recently \u2014 and what still has no selling price':
    'Barang yang baru masuk \u2014 dan mana yang belum ada harga jualnya',
  'What is on the water and when it should land':
    'Barang yang masih dalam perjalanan dan perkiraan tibanya',
  'sets the starting point for everyone.':
    'menetapkan titik awal untuk semua orang.',
  // Role-relevant defaults (2026-08-23). Short in the divider and the chip —
  // they sit in a 10px uppercase slot that clips anything longer.
  'For your role': 'Untuk peran Anda',
  'Everything else': 'Selebihnya',
  'The panels marked for your role are the ones {role} opens on.':
    'Panel yang ditandai untuk peran Anda adalah panel yang dibuka {role} setiap hari.',

  // ── Customers ─────────────────────────────────────────────────────────────
  // Trade words, not dictionary words: piutang (not "AR terutang"), penawaran
  // for a quotation, pesanan for a confirmed order. Surat Dukungan and Item
  // Editor keep their names — they ARE the names.
  'Search code, name, contact person, tier, account manager…':
    'Cari kode, nama, kontak, tier, account manager…',
  'All types': 'Semua tipe',
  'All managers': 'Semua manager',
  'All tiers': 'Semua tier',
  'Duplicates': 'Duplikat',
  'Find & replace across customer names — like the Item Editor\'s Replace':
    'Cari & ganti pada nama pelanggan — seperti Replace di Item Editor',
  'Select shown': 'Pilih yang tampil',
  'Find…': 'Cari…',
  'Replace with…': 'Ganti dengan…',
  'Replacing…': 'Mengganti…',
  'Replace in {n}': 'Ganti di {n} data',
  'all payments': 'semua pembayaran',
  'Outstanding AR': 'Sisa piutang',
  'on issued invoices': 'dari faktur yang sudah terbit',
  'Quotes → orders': 'Penawaran → pesanan',
  '{won} of {total} quotes': '{won} dari {total} penawaran',
  'Linked customers': 'Pelanggan terkait',
  'Documents & activity': 'Dokumen & aktivitas',
  'Accounts receivable': 'Piutang',
  'Most ordered items': 'Barang paling sering dipesan',
  'EPC proposals': 'Proposal EPC',
  'Support letters': 'Surat Dukungan',
  'No sales documents yet — quotes for this customer will appear here.':
    'Belum ada dokumen penjualan — penawaran untuk pelanggan ini akan muncul di sini.',
  'No confirmed orders yet.': 'Belum ada pesanan yang dikonfirmasi.',
  'No Surat Dukungan issued to this customer yet.':
    'Belum ada Surat Dukungan untuk pelanggan ini.',
  'Write one': 'Buat sekarang',
  'Contacts': 'Kontak',

  // ── Shared toolbars (date filter, table pagination) ───────────────────────
  // These render on many screens at once, so one line here moves the whole app.
  'Quick ranges': 'Rentang cepat',
  'Month': 'Bulan',
  'Year': 'Tahun',
  'Custom range': 'Rentang sendiri',
  'Clear': 'Hapus',
  'Clear the date filter': 'Hapus filter tanggal',
  'Rows per page:': 'Baris per halaman:',
  'No matching records found.': 'Tidak ada data yang cocok.',
  'Showing {from} to {to} of {total} entries':
    'Menampilkan {from}–{to} dari {total} data',
  'First': 'Awal',
  'Prev': 'Mundur',
  'Next': 'Maju',
  'Last': 'Akhir',
  'Search records...': 'Cari data...',

  // ── Products ──────────────────────────────────────────────────────────────
  // "Item" is barang; a customer-facing price is harga jual; net price stays
  // "harga net", which is what the sales desk already says out loud.
  'All categories': 'Semua kategori',
  'Clear ×': 'Hapus ×',
  'Live/Physical': 'Tersedia/Fisik',
  'Incoming': 'Transit',
  // Lower case, mid-sentence on the phone card: "+1.200 transit".
  'incoming': 'transit',
  // The Products sort menu and the column headers it drives. They are one
  // vocabulary: translating "Nama ↑" in the menu while the header it sorts
  // still reads NAME is exactly the drift the phrase book exists to stop.
  // The ↑↓ arrows never translate — a direction is not a word.
  'Description': 'Deskripsi',
  'Stock reads Live/Physical — e.g. 100/150 means 150 in the warehouse, 100 still free to sell (50 reserved on confirmed orders). Incoming = on POs not yet fully received. Click a price to copy it; click a row for warranty, datasheet, specs and the last orders & deliveries.':
    'Stok ditulis Tersedia/Fisik — misalnya 100/150 berarti ada 150 di gudang, 100 masih bebas dijual (50 sudah dipesan pada order yang dikonfirmasi). Transit = ada di PO yang belum diterima penuh. Klik sebuah harga untuk menyalinnya; klik barisnya untuk garansi, datasheet, spesifikasi, serta pesanan dan pengiriman terakhir.',
  'Brand': 'Merek',
  'Capacity': 'Kapasitas',
  'Updated': 'Diperbarui',
  'Most sold (period)': 'Paling laku (periode)',
  'Most traded': 'Paling sering keluar-masuk',
  'Last updated': 'Terakhir diperbarui',
  // "Net price" is the sales desk's own phrase — kept, per the note above on
  // "harga net" — with the tier it means spelled out beside it.
  'Net price (Tier 1)': 'Harga net (Tier-1)',
  'Live stock': 'Stok tersedia',
  'Name': 'Nama',
  'Category': 'Kategori',
  'Warranty': 'Garansi',
  'Has datasheet': 'Punya datasheet',
  // "Text quote", never "Quote": this builds a WhatsApp MESSAGE and never
  // creates a Sales Quotation document (owner, 2026-08-06). "Penawaran teks"
  // keeps that distinction; "Penawaran" alone would lose it.
  'Text quote mode': 'Mode penawaran teks',
  'Text quote mode · {n}': 'Mode penawaran teks · {n}',
  'Collect several products into one WhatsApp text message — no Sales Quotation document is created':
    'Kumpulkan beberapa barang jadi satu pesan WhatsApp — tidak ada dokumen Penawaran Penjualan yang dibuat',
  'Tapping a price adds the item to the WhatsApp text quote at that price. Tap again to remove, tap another tier to move it. This never creates a Sales Quotation document.':
    'Menyentuh sebuah harga menambahkan barang itu ke penawaran teks WhatsApp pada harga tersebut. Sentuh lagi untuk menghapus, sentuh tier lain untuk memindahkannya. Ini tidak pernah membuat dokumen Penawaran Penjualan.',
  'No products match.': 'Tidak ada barang yang cocok.',
  '↑ Newer version': '↑ Versi lebih baru',
  'Import products — preview': 'Impor barang — pratinjau',
  'Updates': 'Pembaruan',
  'New products': 'Barang baru',
  'Cancel': 'Batal',
  'Expected arrival': 'Perkiraan tiba',
  'No net price —': 'Belum ada harga net —',
  'set it in Catalog': 'atur di Katalog',
  'Datasheet URL (Drive or web)': 'Tautan datasheet (Drive atau web)',
  'Open': 'Buka',
  'Open datasheet': 'Buka datasheet',
  'Open the item hub': 'Buka Pusat Barang',
  'Last Customer Orders': 'Pesanan pelanggan terakhir',
  'Last Deliveries': 'Pengiriman terakhir',
  'Download the filtered list as CSV (opens in Excel)':
    'Unduh daftar yang tersaring sebagai CSV (bisa dibuka di Excel)',
  'Manage price tiers, margin floors and per-item overrides':
    'Atur tier harga, batas bawah margin, dan harga khusus per barang',
  'Prices are set in Purchasing › Items (the Item Editor) — Sell Price column → Tiers':
    'Harga diatur di Purchasing › Items (Item Editor) — kolom Sell Price → Tiers',
  'Only items with a sell price set — the default view; untick to include unpriced items':
    'Hanya barang yang sudah ada harga jualnya — tampilan bawaan; hilangkan centang untuk memasukkan yang belum ada harganya',
  // The Products filter bar. The "Show" dropdown became three tick chips on
  // 2026-09-10 and the brand filter went with it (it enumerated every supplier
  // brand we carry to whoever opened it).
  'Show': 'Tampilkan',
  'Priced': 'Ada harga',
  'In stock': 'Ada stok',
  'In stock / incoming': 'Ada stok / dalam perjalanan',
  'On the shelf now, or on a purchase order not yet fully received':
    'Ada di gudang sekarang, atau sedang di PO yang belum diterima penuh',
  // "New" = a product we have never carried, not a restock. Fresh stock of a
  // known item is already visible in the Live figure (owner, 2026-09-10).
  '↑ New first': '↑ Yang baru di atas',
  'Floats products we had never carried until their first stock landed in the last {days} days to the top of the list, without hiding anything else. Fresh stock of an item we already sell is not new — the Live figure says that.':
    'Menaikkan produk yang belum pernah kita bawa sampai stok pertamanya datang dalam {days} hari terakhir ke bagian atas daftar, tanpa menyembunyikan yang lain. Stok baru dari barang yang sudah biasa kita jual bukan barang baru — itu sudah terlihat di angka Tersedia.',
  'Search description, model, category…': 'Cari deskripsi, model, kategori…',
  'Reserved on orders:': 'Dipesan pada order:',
  'Already committed on confirmed sales orders — the difference between the Live and Physical figures':
    'Sudah terikat pada pesanan penjualan yang dikonfirmasi — selisih antara angka Tersedia dan Fisik',
  'View': 'Tampilan',
  'List density and which columns the table shows': 'Kerapatan daftar dan kolom mana yang ditampilkan tabel',
  'Density': 'Kerapatan',
  'Compact': 'Ringkas',
  'Card': 'Kartu',
  'Columns': 'Kolom',
  'Drag to set the Description width — double-click to reset':
    'Geser untuk mengatur lebar kolom Description — klik dua kali untuk mengembalikan',
  'Open the item hub — buy, sell, stock, specs on one page':
    'Buka Pusat Barang — pembelian, penjualan, stok, dan spesifikasi dalam satu halaman',
  'Everything about this item — buy, sell, stock, specs — on one page':
    'Semua tentang barang ini — pembelian, penjualan, stok, spesifikasi — dalam satu halaman',
  'Performance warranty — PV output guarantee':
    'Garansi performa — jaminan keluaran daya PV',
  '— product (claimable) · performance (PV output guarantee)':
    '— produk (bisa diklaim) · performa (jaminan keluaran daya PV)',
  'Free-text warranty from before the structured fields — retype it into the boxes above':
    'Garansi dalam bentuk teks bebas dari sebelum kolom terstruktur ada — ketik ulang ke kolom di atas',

  // ── Sales, Invoices, Delivery ─────────────────────────────────────────────
  // NOTE ON WHAT IS ABSENT. Column headings and field labels (Invoice,
  // Customer, Date, Total, Status, Product, Category, Quantity, Warranty,
  // Serial number…) are wrapped at their call sites but deliberately have NO
  // entry here: the house rule keeps the NAMES of things English, and the
  // fallback renders them in English for free. Giving one of them an entry is
  // a one-line decision, not a code change — which is the point.
  'Stage: all': 'Tahap: semua',
  'Payment: all': 'Pembayaran: semua',
  'Delivery: all': 'Pengiriman: semua',
  'Unpaid': 'Belum dibayar',
  'Partial': 'Sebagian',
  'Outstanding': 'Belum lunas',
  'Paid': 'Lunas',
  'Not shipped': 'Belum dikirim',
  'Preparing': 'Disiapkan',
  'Partly delivered': 'Terkirim sebagian',
  'Delivered': 'Terkirim',
  'Drafts': 'Draf',
  'unfinished quotes — not in the totals until validated':
    'penawaran yang belum selesai — belum masuk total sampai divalidasi',
  'Expired': 'Kedaluwarsa',
  'none yet': 'belum ada',
  'no DO yet': 'belum ada DO',
  'No items on this quote.': 'Tidak ada barang pada penawaran ini.',
  'Grand Total (excl. PPN)': 'Total (sebelum PPN)',
  'Total (excl. PPN)': 'Total (sebelum PPN)',
  'Owner-only: curated custom line texts that feed the item picker':
    'Khusus pemilik: daftar teks baris pilihan yang mengisi pemilih barang',
  'Search by number, customer, status, product…':
    'Cari berdasarkan nomor, pelanggan, status, barang…',
  'Create a Sales Order directly — fill the customer and items, then Confirm Order in one step':
    'Buat Sales Order langsung — isi pelanggan dan barangnya, lalu Confirm Order sekaligus',
  'Order — the default lives in Settings › Lists':
    'Urutan — bawaannya diatur di Settings › Lists',
  'Filter by lifecycle stage — draft, price quote or confirmed order':
    'Saring berdasarkan tahap — draf, penawaran harga, atau pesanan yang sudah dikonfirmasi',
  'Filter by payment state': 'Saring berdasarkan status pembayaran',
  'Filter by delivery state': 'Saring berdasarkan status pengiriman',
  'Select all drafts': 'Pilih semua draf',
  'Select this draft for deletion': 'Pilih draf ini untuk dihapus',
  'Open document': 'Buka dokumen',
  'After-sales quote — repair / replacement for a service case':
    'Penawaran purna jual — perbaikan / penggantian untuk kasus servis',
  'Open customer profile in a new tab': 'Buka profil pelanggan di tab baru',
  'Some delivery orders are delivered, the rest still preparing — the order completes when every item has shipped':
    'Sebagian surat jalan sudah terkirim, sisanya masih disiapkan — pesanan selesai setelah semua barang dikirim',
  'Search invoice number, customer…': 'Cari nomor faktur, pelanggan…',
  'Ready to deliver': 'Siap dikirim',
  'No deliveries yet.': 'Belum ada pengiriman.',
  'Search DO / SO / invoice number, customer…':
    'Cari nomor DO / SO / faktur, pelanggan…',

  // ── Suppliers ─────────────────────────────────────────────────────────────
  'Vendors are created in Catalog → Supplier Quotes':
    'Pemasok dibuat di Catalog → Supplier Quotes',
  'quotes / POs': 'penawaran / PO',
  'No supplier quotes or POs yet.': 'Belum ada penawaran pemasok atau PO.',
  'Click any document to open it in Deal Lookup.':
    'Klik dokumen mana pun untuk membukanya di Telusur Transaksi.',
  'Most purchased items': 'Barang paling sering dibeli',
  'No PO lines yet.': 'Belum ada baris PO.',
  'Search supplier name, code, location…': 'Cari nama pemasok, kode, lokasi…',
  'Collapse': 'Tutup',

  // ── After Sales & Serial numbers ──────────────────────────────────────────
  'No after-sales cases yet': 'Belum ada kasus purna jual',
  'No case matches.': 'Tidak ada kasus yang cocok.',
  'not ours': 'eksternal',
  'not sold by us': 'bukan dari kami',
  'not sold by us — out of our warranty': 'bukan dari kami — di luar garansi kami',
  'none linked': 'belum ditautkan',
  'none': 'tidak ada',
  'preparing': 'disiapkan',
  'Register ↗': 'Daftar unit ↗',
  'No unit with that serial in the register.':
    'Tidak ada unit dengan nomor seri itu di daftar.',
  'Open the ticket anyway — the serial is kept as typed.':
    'Tetap buka tiketnya — nomor seri disimpan seperti yang diketik.',
  'record it in the register ↗': 'catat di daftar unit ↗',
  'unit attached': 'unit terlampir',
  'detach': 'lepaskan',
  '+ Add item': '+ Tambah barang',
  'On this order:': 'Pada pesanan ini:',
  'No items logged.': 'Belum ada barang dicatat.',
  'Repair / replacement quotes': 'Penawaran perbaikan / penggantian',
  '+ New quote': '+ Penawaran baru',
  'No quote for this case yet — repairs and component replacements are quoted from here.':
    'Belum ada penawaran untuk kasus ini — perbaikan dan penggantian komponen ditawarkan dari sini.',
  'No updates yet.': 'Belum ada pembaruan.',
  'Search serial, ticket, customer, order, item…':
    'Cari nomor seri, tiket, pelanggan, pesanan, barang…',
  'More invoices / delivery orders — expand the row':
    'Faktur / surat jalan lainnya — buka barisnya',
  'Performance warranty — output guarantee, not a repair claim':
    'Garansi performa — jaminan keluaran daya, bukan klaim perbaikan',
  'What is it?': 'Barang apa?',
  'Which seller?': 'Dibeli dari siapa?',
  'Search customer…': 'Cari pelanggan…',
  'Search SO / SQ number…': 'Cari nomor SO / SQ…',
  'What the customer reported': 'Yang dilaporkan pelanggan',
  'Item — type to search the catalog': 'Barang — ketik untuk mencari di katalog',
  'How it was fixed': 'Bagaimana diperbaiki',
  'Add an update — parts ordered, technician visit, customer called…':
    'Tambah pembaruan — suku cadang dipesan, teknisi datang, pelanggan dihubungi…',
  'Could not read the register.': 'Daftar unit tidak bisa dibaca.',
  '1 · Product': '1 · Barang',
  '— pick the product being scanned —': '— pilih barang yang dipindai —',
  '2 · Scan': '2 · Pindai',
  '— none (into stock) —': '— tidak ada (masuk stok) —',
  '— none —': '— tidak ada —',
  'Attach to sales order…': 'Tautkan ke sales order…',
  'clear': 'hapus',
  'No sale of ours carries this unit — service on it is out of warranty unless someone says otherwise.':
    'Tidak ada penjualan kami yang mencakup unit ini — servisnya di luar garansi kecuali ada keputusan lain.',
  'Note on this batch (optional)': 'Catatan untuk batch ini (opsional)',
  'Scan or type a serial, or search product, customer, order…':
    'Pindai atau ketik nomor seri, atau cari barang, pelanggan, pesanan…',

  // ── Stock ─────────────────────────────────────────────────────────────────
  'Inventory tables are behind the app.': 'Tabel persediaan tertinggal dari aplikasi.',
  'on-hand across all warehouses vs undelivered committed order qty':
    'stok di semua gudang dibanding jumlah pesanan terikat yang belum dikirim',
  'on the water': 'dalam perjalanan',
  'POs ↗': 'PO ↗',
  'understated by {amount}': 'kurang dicatat sebesar {amount}',
  'True up ↗': 'Sesuaikan ↗',
  'item ↗': 'barang ↗',
  'All warehouses': 'Semua gudang',
  '⇄ move': '⇄ pindah',
  'Move stock': 'Pindahkan stok',
  'Moves at the source warehouse&apos;s average cost — total inventory value is unchanged.':
    'Dipindahkan pada biaya rata-rata gudang asal — total nilai persediaan tidak berubah.',
  'The default warehouse — the one preselected when receiving, adjusting or shipping — is set in Settings':
    'Gudang bawaan — yang otomatis terpilih saat menerima, menyesuaikan, atau mengirim — diatur di Settings',
  'Open the item hub — buy history, lead times, demand':
    'Buka Pusat Barang — riwayat pembelian, lead time, permintaan',
  'Raise the next deal — New Deal, Quote + PO':
    'Buat transaksi berikutnya — New Deal, penawaran + PO',
  'Search item, brand, category…': 'Cari barang, merek, kategori…',
  'Show one warehouse or all of them': 'Tampilkan satu gudang atau semuanya',
  'Move this stock to another warehouse': 'Pindahkan stok ini ke gudang lain',

  // ── Leaderboards ──────────────────────────────────────────────────────────
  // Short in the toggle (it is a two-button switch), full in the sentences.
  'Revenue': 'Omzet',
  'Profit': 'Laba',
  'Details': 'Rincian',
  'all time': 'sejak awal',
  'last {days} days': '{days} hari terakhir',
  'cost estimated': 'biaya perkiraan',
  'What earns the most — by revenue, or by gross profit':
    'Yang paling menghasilkan — berdasarkan omzet atau laba kotor',
  'Who earns you the most — by revenue, or by gross profit':
    'Pelanggan yang paling menghasilkan — berdasarkan omzet atau laba kotor',
  'Nothing has been delivered in this period yet. A sale counts from the day the goods ship, not the day the order is signed.':
    'Belum ada pengiriman pada periode ini. Penjualan dihitung sejak barang dikirim, bukan sejak pesanan ditandatangani.',
  'These carry {pct}% of the total.': 'Semuanya mencakup {pct}% dari total.',
  'Ranked by revenue — the cost of these goods could not be read.':
    'Diurutkan berdasarkan omzet — biaya barang ini tidak bisa dibaca.',
  'Some of this profit uses today’s average cost, because those deliveries predate the stock ledger.':
    'Sebagian laba ini memakai biaya rata-rata hari ini, karena pengiriman tersebut terjadi sebelum buku stok ada.',

  // ── The three narrow feeds ────────────────────────────────────────────────
  'All': 'Semua',
  'The most recent money in and out': 'Uang masuk dan keluar terakhir',
  'What left the warehouse, and whether it landed':
    'Barang yang keluar gudang, dan apakah sudah sampai',
  'What came back, and what is still open':
    'Barang yang kembali, dan yang masih berjalan',
  'No payment has been recorded yet.': 'Belum ada pembayaran tercatat.',
  'Nothing has shipped yet.': 'Belum ada pengiriman.',
  'No service ticket has been raised yet.': 'Belum ada tiket servis dibuat.',
  'Money in only — supplier payments are buy-side.':
    'Hanya uang masuk — pembayaran ke pemasok khusus sisi pembelian.',
  'Money out only — customer receipts are not shown here.':
    'Hanya uang keluar — pembayaran dari pelanggan tidak ditampilkan di sini.',

  // ── Page subtitles (BrandMenu) ────────────────────────────────────────────
  'Stock · Warehouse': 'Stok · Gudang',
  'Customers · CRM': 'Customers · Data pelanggan',
  'Delivery · Orders out the door': 'Delivery · Barang keluar',
  'Invoices · Accounts receivable': 'Invoices · Piutang',
  'After Sales · Service & warranty cases': 'Purna Jual · Servis & garansi',
  'Banks · Accounts & cash position': 'Banks · Rekening & posisi kas',
  'Serial Numbers · Unit register': 'Nomor Seri · Daftar unit',

  // ── Settings hints ────────────────────────────────────────────────────────
  'The dashboard chases an issued invoice this old that still has money outstanding.':
    'Dashboard akan menagih faktur seumur ini yang uangnya masih belum masuk.',
  'A quotation sent this long ago with no answer shows up on the dashboard.':
    'Penawaran yang dikirim selama ini tanpa jawaban akan muncul di dashboard.',
  'Prefills the Valid until date on a new quotation — printed on the PDF; a validated/sent quote past it shows Expired.':
    'Mengisi otomatis tanggal Berlaku sampai pada penawaran baru — dicetak di PDF; penawaran yang lewat tanggal itu ditandai Expired.',
  'Economics flags stock with no movement for this long.':
    'Analisa ekonomi menandai stok yang tidak bergerak selama ini.',

  // ── Tooltips people hover ─────────────────────────────────────────────────
  'Open Deal Lookup to review open purchase orders':
    'Buka Telusur Transaksi untuk meninjau PO yang masih berjalan',
  'Review the difference per PO and post the correction':
    'Tinjau selisih per PO lalu posting koreksinya',
  'What posting would add to the value of stock still on hand':
    'Yang akan ditambahkan ke nilai stok yang masih ada',
  'Serial numbers recorded against this delivery':
    'Nomor seri yang tercatat pada pengiriman ini',
  'Open the serial register':
    'Buka daftar nomor seri',
  'This unit is already in the register — it will be left alone':
    'Unit ini sudah ada di daftar — akan dilewati',
  'Select for bulk actions':
    'Pilih untuk tindakan massal',
  'Tick everything shown':
    'Centang semua yang tampil',
  'Remove this scan':
    'Hapus hasil pindaian ini',
  'Individual customer — the person is the customer':
    'Pelanggan perorangan — orangnya yang menjadi pelanggan',
  'Default account for supplier payments':
    'Rekening utama untuk pembayaran ke pemasok',
  'Default account for customer receipts':
    'Rekening utama untuk penerimaan dari pelanggan',
  'Nothing on hand — this correction cannot reach inventory':
    'Tidak ada stok — koreksi ini tidak bisa masuk ke persediaan',
  'All of these units have been sold — the correction cannot reach stock value':
    'Semua unit ini sudah terjual — koreksi tidak bisa masuk ke nilai stok',
  'Goods received, but not one cost recorded — there is nothing to allocate yet':
    'Barang sudah diterima, tetapi belum ada biaya tercatat — belum ada yang bisa dialokasikan',
  'These units were already sold at the estimated cost — that gross profit was overstated by this much':
    'Unit ini sudah terjual dengan biaya perkiraan — laba kotornya kelebihan sebesar ini',
  'Too small in rupiah and too small a share of the goods to be worth a ledger entry — shown here so it is never silently dropped':
    'Terlalu kecil dalam rupiah dan terlalu kecil dibanding nilai barang untuk dicatat — ditampilkan di sini agar tidak hilang diam-diam',
  'No balance payment recorded yet — more bills are still coming':
    'Pelunasan belum tercatat — masih ada tagihan yang akan datang',
  'This PO has been trued up before — what is shown is what has come in since':
    'PO ini pernah disesuaikan — yang tampil adalah tagihan yang masuk setelahnya',
  'Back to Stock': 'Kembali ke Stok',
  'Landed-cost correction on {qty} received': 'Koreksi biaya sampai gudang atas {qty} unit yang diterima',
  'One row per service ticket, newest first — start from the serial number':
    'Satu baris per tiket servis, terbaru di atas — mulai dari nomor seri',
  'Grouped by status, the way the desk worked before — start from the sales order':
    'Dikelompokkan per status, seperti sebelumnya — mulai dari sales order',
  'When the freight, duty or final payment arrives later, true up the cost there':
    'Saat ongkos kirim, bea masuk atau pelunasan datang belakangan, sesuaikan biayanya di sana',
  'Warehouse these goods are received into':
    'Gudang tempat barang ini diterima',
  'Landed unit cost (IDR) — feeds the moving average':
    'Biaya sampai gudang per unit (IDR) — dipakai untuk rata-rata bergerak',
  'Previous landed costs for this item': 'Biaya sampai gudang sebelumnya',
  'Freight, duty or the final payment recorded after today? True up the cost of what you just received.':
    'Ada ongkos kirim, bea masuk atau pelunasan yang dicatat setelah hari ini? Sesuaikan biaya barang yang baru diterima.',
  'Back to Deal Lookup — the PI → PO → payment record':
    'Kembali ke Telusur Transaksi — catatan PI → PO → pembayaran',

  // ── SELL SIDE, in full (owner's rule, 2026-09-08) ────────────────────────
  //
  // "Continue translating to Indonesian especially for the Sales Side menus,
  // including the Field Descriptions and Buttons. My sales support admin is
  // poor in English." The Sales list already spoke Indonesian; the quotation
  // EDITOR — where that person spends the day — had never been wired to the
  // translator at all, nor had the description library or Surat Dukungan.
  //
  // House vocabulary held to here: quotation → penawaran · line → baris ·
  // lead time → waktu kirim · fee → biaya · letter → surat · draft → draf.

  // Command bar and document identity
  'Sales · Quotation': 'Penjualan · Penawaran',
  'New Sales Quote': 'Penawaran Penjualan Baru',
  'List': 'Daftar',
  'Back to the sales list': 'Kembali ke daftar penjualan',
  'Unsaved —': 'Belum disimpan —',
  'Save & leave': 'Simpan & keluar',
  'Discard': 'Buang perubahan',
  'Stay on this quote': 'Tetap di penawaran ini',
  'Draft order': 'Draf pesanan',
  'Entered via + New Order — the SO number stamps when you Confirm Order':
    'Dibuat lewat + Pesanan Baru — nomor SO tercetak saat Anda menekan Konfirmasi Pesanan',
  'Partly Delivered': 'Terkirim sebagian',
  'Service': 'Servis',
  'After-sales quote — open the case list': 'Penawaran purnajual — buka daftar kasus',
  'Offer expired {date} — Revise to re-issue with fresh validity':
    'Penawaran kedaluwarsa {date} — pilih Revisi untuk menerbitkan ulang dengan masa berlaku baru',
  'Delivered, but Rp {amount} has not been received':
    'Sudah dikirim, tetapi Rp {amount} belum diterima',
  'Auto-saved': 'Tersimpan otomatis',
  'Drafts save themselves shortly after every change':
    'Draf tersimpan sendiri sesaat setelah setiap perubahan',
  'Print / PDF': 'Cetak / PDF',
  'Confirming reserves these quantities from Live Stock':
    'Konfirmasi akan memesan jumlah ini dari Stok Langsung',
  'Revise': 'Revisi',
  'Re-open for edits as a new revision (Rev n) — the customer has seen this quote':
    'Buka kembali sebagai revisi baru (Rev n) — pelanggan sudah melihat penawaran ini',
  'Re-open for edits — not sent yet, so it keeps the same revision number':
    'Buka kembali untuk diubah — belum terkirim, jadi nomor revisinya tetap',
  'Sales quote not found.': 'Penawaran penjualan tidak ditemukan.',

  // Header fields
  'Customer': 'Pelanggan',
  'Type to search customers…': 'Ketik untuk mencari pelanggan…',
  'Selling company': 'Perusahaan penjual',
  '— Select company —': '— Pilih perusahaan —',
  'Quote date': 'Tanggal penawaran',
  'Set to today’s date': 'Pakai tanggal hari ini',
  'The quote is already dated today': 'Penawaran sudah bertanggal hari ini',
  'Valid until': 'Berlaku sampai',
  'Valid until {date} (quote date + {days} days)':
    'Berlaku sampai {date} (tanggal penawaran + {days} hari)',
  '{days} days': '{days} hari',
  'before quote date': 'sebelum tanggal penawaran',
  'no expiry': 'tanpa batas waktu',
  'Payment terms': 'Syarat pembayaran',
  '— Select payment terms —': '— Pilih syarat pembayaran —',
  'Delivery terms': 'Syarat pengiriman',
  '— Select delivery terms —': '— Pilih syarat pengiriman —',

  // Lines
  'Add item': 'Tambah item',
  'Add section': 'Tambah bagian',
  'Section': 'Bagian',
  'Section title (e.g. Solar Panels)': 'Judul bagian (mis. Panel Surya)',
  'Drag to reorder': 'Seret untuk mengubah urutan',
  'Drag to move this section together with its items':
    'Seret untuk memindahkan bagian ini beserta isinya',
  'Drop here to move to the end': 'Lepas di sini untuk memindahkan ke urutan terakhir',
  'Product / description': 'Produk / deskripsi',
  'Type a product or custom item…': 'Ketik produk atau item manual…',
  'Pick a catalog product to autofill price, or just type a custom item.':
    'Pilih produk katalog agar harganya terisi sendiri, atau ketik item manual.',
  'Qty': 'Jml',
  'Unit': 'Satuan',
  'Unit price': 'Harga satuan',
  'Any typed price overrides the tier': 'Harga yang diketik mengalahkan harga tingkat',
  'Line total': 'Total baris',
  'Remove': 'Hapus',
  'Remove line': 'Hapus baris',
  'Catalog item': 'Item katalog',
  'Custom entry': 'Entri manual',
  'live': 'tersedia',
  'short': 'kurang',
  'Open the item hub — stock, prices and history on one page':
    'Buka halaman barang — stok, harga dan riwayat dalam satu halaman',
  'Unlink from catalog (keep as custom entry)':
    'Lepas dari katalog (tetap sebagai entri manual)',
  'newer item': 'barang lebih baru',
  'Newer version:': 'Versi lebih baru:',
  'This item is replaced by {name}': 'Barang ini digantikan oleh {name}',
  'This item is replaced by {name} — open the newer item':
    'Barang ini digantikan oleh {name} — buka barang yang lebih baru',
  'Formula: {formula}': 'Rumus: {formula}',
  'Owner-only — est. gross profit at the current moving-average landed cost of Rp {cost}/unit:':
    'Khusus pemilik — perkiraan laba kotor pada biaya sampai gudang rata-rata bergerak Rp {cost}/unit:',
  'Comment': 'Komentar',
  'Comment / extra description (toggle in PDF)':
    'Komentar / keterangan tambahan (bisa ditampilkan di PDF)',

  // Lead time
  'Lead time': 'Waktu kirim',
  'Ready': 'Siap',
  'Custom': 'Isi sendiri',
  'e.g. 4–6 weeks': 'mis. 4–6 minggu',
  'e.g. 4 bulan': 'mis. 4 bulan',
  'Back to preset list': 'Kembali ke daftar pilihan',
  'Live stock cannot cover this quantity': 'Stok tersedia tidak mencukupi jumlah ini',
  'no stock for “Ready” — set the real lead time':
    'stok tidak ada untuk “Siap” — isi waktu kirim yang sebenarnya',
  'set the lead time — stock can’t cover this qty':
    'isi waktu kirim — stok tidak mencukupi jumlah ini',
  'suggest:': 'saran:',

  // Price popover
  'Tier prices': 'Harga per tingkat',
  'customer is on {tier}': 'pelanggan ada di tingkat {tier}',
  'customer’s tier': 'tingkat pelanggan',
  'Sold before': 'Pernah terjual',
  'this customer': 'pelanggan ini',
  'No tier prices or sales history for this item yet.':
    'Belum ada harga tingkat maupun riwayat penjualan untuk barang ini.',
  'Click a price to use it — or just type your own in the field.':
    'Klik sebuah harga untuk memakainya — atau ketik harga Anda sendiri di kolomnya.',

  // Totals
  'Notes / terms': 'Catatan / ketentuan',
  'Grand Total': 'Total Akhir',
  'Prices auto-filled at the customer’s': 'Harga terisi otomatis pada tingkat',
  'tier.': 'pelanggan.',
  'Est. COGS · avg landed cost': 'Perk. HPP · rata-rata biaya sampai gudang',
  'Σ current moving-average landed cost × qty over lines linked to a costed catalog item':
    'Σ biaya sampai gudang rata-rata bergerak × jumlah, atas baris yang terhubung ke item katalog bernilai',
  'Est. gross profit': 'Perk. laba kotor',
  'owner-only': 'khusus pemilik',
  '{n} lines without a landed cost — excluded from the estimate.':
    '{n} baris tanpa biaya sampai gudang — tidak dihitung dalam perkiraan.',

  // Designers
  'Design system': 'Desain sistem',
  'System design ·  regenerate': 'Desain sistem ·  buat ulang',
  'Size the whole system — inverter, battery bank, array, structure and balance of system — from the PLN connection or the load table, priced at this customer’s tier':
    'Hitung seluruh sistem — inverter, bank baterai, larik panel, struktur dan kelengkapannya — dari daya PLN atau tabel beban, dengan harga tingkat pelanggan ini',
  'Design mounting': 'Desain dudukan',
  'Mounting design ·  regenerate': 'Desain dudukan ·  buat ulang',
  'Size the mounting structure from the array — rails, clamps, supports, grounding — priced at this customer’s tier':
    'Hitung struktur dudukan dari larik panel — rel, klem, penyangga, pembumian — dengan harga tingkat pelanggan ini',

  // Activity log
  'Activity': 'Aktivitas',
  'every change on this document — who and when':
    'setiap perubahan pada dokumen ini — siapa dan kapan',
  'Show fewer': 'Tampilkan lebih sedikit',
  'Show all {n}': 'Tampilkan semua {n}',
  'Invoice created': 'Faktur dibuat',
  'Invoice deleted': 'Faktur dihapus',
  'DO created': 'Surat jalan dibuat',
  'DO reopened': 'Surat jalan dibuka kembali',
  'DO deleted': 'Surat jalan dihapus',
  'Payment recorded': 'Pembayaran tercatat',
  'Payment removed': 'Pembayaran dihapus',
  'Revised': 'Direvisi',

  // Payments
  'Order total': 'Total pesanan',
  'Received in account': 'Diterima di rekening',
  'This payment is applied to this invoice': 'Pembayaran ini dibukukan ke faktur tersebut',
  'Remove payment': 'Hapus pembayaran',
  'Record Payment': 'Catat Pembayaran',
  'Record customer payment': 'Catat pembayaran pelanggan',
  'Record payment': 'Catat pembayaran',
  'Payments are recorded by Finance / Owner.': 'Pembayaran dicatat oleh Keuangan / Pemilik.',
  'For invoice': 'Untuk faktur',
  'Rp {amount} outstanding': 'sisa Rp {amount}',
  'PAID': 'LUNAS',
  'Whole order (not tied to an invoice)': 'Seluruh pesanan (tidak terikat ke satu faktur)',
  'Type': 'Jenis',
  'Down Payment (DP)': 'Uang Muka (DP)',
  'Balance Payment': 'Pelunasan',
  'Amount (IDR)': 'Jumlah (IDR)',
  'Fill remaining': 'Isi sisanya',
  'Fill this invoice’s outstanding amount': 'Isi sisa tagihan faktur ini',
  'Fill the order’s outstanding amount': 'Isi sisa tagihan pesanan ini',
  'Method': 'Metode',
  'Bank Transfer': 'Transfer Bank',
  'Cheque': 'Cek',
  'Giro': 'Bilyet Giro',
  'Other': 'Lainnya',
  'Payment date': 'Tanggal pembayaran',
  '— not recorded —': '— tidak dicatat —',
  'Bank ref / cheque no.': 'Ref bank / no. cek',
  'Optional reference': 'Referensi, jika ada',
  'Notes': 'Catatan',
  'Optional': 'Opsional',
  'Failed: {message}': 'Gagal: {message}',

  // Delivery order modal
  'Create Delivery Order': 'Buat Surat Jalan',
  'Edit delivery details': 'Ubah rincian pengiriman',
  'Update the warehouse instructions for this DO.':
    'Perbarui instruksi gudang untuk surat jalan ini.',
  'This issues the DO number and moves the order to “Preparing Items” — the warehouse team’s instruction to pick and pack.':
    'Ini menerbitkan nomor surat jalan dan memindahkan pesanan ke “Menyiapkan Barang” — instruksi bagi tim gudang untuk mengambil dan mengemas.',
  'Target delivery date': 'Target tanggal kirim',
  'Time of day': 'Waktu pengiriman',
  '— Anytime —': '— Kapan saja —',
  'Delivery (we send)': 'Dikirim (oleh kami)',
  'Customer pick-up': 'Diambil pelanggan',
  'Through / carrier': 'Melalui / ekspedisi',
  'e.g. Armada sendiri, ekspedisi…': 'mis. Armada sendiri, ekspedisi…',
  'Delivery address': 'Alamat pengiriman',
  'Street address for the driver': 'Alamat lengkap untuk pengemudi',
  'Google Maps link': 'Tautan Google Maps',
  'Contact person (on site)': 'Narahubung (di lokasi)',
  'Pick a customer contact or type one…': 'Pilih kontak pelanggan atau ketik sendiri…',
  'Name · phone': 'Nama · telepon',
  'Save details': 'Simpan rincian',

  // ── Description library ──────────────────────────────────────────────────
  'Back to Sales': 'Kembali ke Penjualan',
  'Curated custom line texts that appear as': 'Teks baris manual pilihan yang muncul sebagai saran',
  'suggestions in the Sales Quote item picker for every sales user. Only owners see and manage this page.':
    'di pemilih barang Penawaran Penjualan untuk semua pengguna penjualan. Hanya pemilik yang melihat dan mengelola halaman ini.',
  'After-sales': 'Purnajual',
  'Repair & component-replacement texts — offered first on quotes linked to a case.':
    'Teks perbaikan & penggantian komponen — ditawarkan lebih dulu pada penawaran yang terkait sebuah kasus.',
  'New entry — description': 'Entri baru — deskripsi',
  'e.g. Instalasi dan komisioning sistem': 'mis. Instalasi dan komisioning sistem',
  'Default price (IDR)': 'Harga bawaan (IDR)',
  'optional': 'opsional',
  'Add': 'Tambah',
  'Search entries…': 'Cari entri…',
  'No library entries yet — add your first above.':
    'Belum ada entri pustaka — tambahkan yang pertama di atas.',
  'No matches.': 'Tidak ada yang cocok.',
  'unit': 'satuan',
  'price': 'harga',
  'no price': 'tanpa harga',
  'Delete': 'Hapus',
  'Used in sales quotes': 'Terpakai di penawaran penjualan',
  'custom lines your team already typed, not in the library yet. Adding one makes it a suggested entry for everyone.':
    'baris manual yang sudah diketik tim Anda, belum masuk pustaka. Menambahkannya menjadikannya saran bagi semua orang.',
  'Times used in sales quotes': 'Berapa kali dipakai di penawaran penjualan',
  'Add to library': 'Tambahkan ke pustaka',

  // ── Support letters · Surat Dukungan ─────────────────────────────────────
  'Support Letters · Surat Dukungan': 'Surat Dukungan · Daftar',
  'New Letter': 'Surat Baru',
  'Search number, customer, project, end user, item…':
    'Cari nomor, pelanggan, proyek, pengguna akhir, barang…',
  'All statuses': 'Semua status',
  'All customers': 'Semua pelanggan',
  'All sales': 'Semua sales',
  'Unassigned': 'Belum ditugaskan',
  'The administration fee: which letters are still waiting on payment':
    'Biaya administrasi: surat mana yang masih menunggu pembayaran',
  'Fee: any': 'Biaya: semua',
  'Fee unpaid': 'Biaya belum dibayar',
  'Fee paid': 'Biaya sudah dibayar',
  'Letter date': 'Tanggal surat',
  '{shown} of {total} letters': '{shown} dari {total} surat',
  'projects backed': 'proyek didukung',
  'resellers': 'reseller',
  '{n} awaiting the fee': '{n} menunggu pembayaran biaya',
  'Number': 'Nomor',
  'Date': 'Tanggal',
  'Project': 'Proyek',
  'End user': 'Pengguna akhir',
  'Items': 'Barang',
  'Creator': 'Dibuat oleh',
  'Fee': 'Biaya',
  'Actions': 'Tindakan',
  'No support letters yet — the first one takes about a minute.':
    'Belum ada surat dukungan — yang pertama hanya butuh sekitar satu menit.',
  'No letter matches.': 'Tidak ada surat yang cocok.',
  'Issued': 'Diterbitkan',
  'Fee received {date} — click to clear': 'Biaya diterima {date} — klik untuk membatalkan',
  'Click when the fee lands — the letter flips to Issued':
    'Klik saat biaya masuk — status surat berubah menjadi Diterbitkan',
  'Paid {date}': 'Dibayar {date}',
  'Open the printable Surat Dukungan': 'Buka Surat Dukungan siap cetak',
  'Print': 'Cetak',
  'Start a new letter from this one — same customer and items, new project':
    'Mulai surat baru dari surat ini — pelanggan dan barang sama, proyek baru',
  'Duplicate': 'Duplikat',
  'no end user': 'tanpa pengguna akhir',
  'Fee received': 'Biaya diterima',
  'Supported': 'Didukung',
  'Addressed': 'Ditujukan',
  'Brands': 'Merek',
  'Materials': 'Material',
  'none listed': 'tidak ada',
  'A Surat Dukungan states our backing as principal. The clauses are pre-formatted and the item warranties come from the item master — set them in':
    'Surat Dukungan menyatakan dukungan kami sebagai prinsipal. Klausulnya sudah baku dan garansi barang diambil dari data induk barang — aturlah di',
  'and every future letter quotes them correctly.':
    'dan setiap surat berikutnya akan mengutipnya dengan benar.',
  'New Surat Dukungan': 'Surat Dukungan Baru',
  'Support letter': 'Surat dukungan',
  'Customer we support *': 'Pelanggan yang kami dukung *',
  'Their signatory (Nama)': 'Penanda tangan mereka (Nama)',
  'e.g. Denny Yusni Arman': 'mis. Denny Yusni Arman',
  'Their title (Jabatan)': 'Jabatan mereka',
  'Their company + address (as printed)': 'Perusahaan + alamat mereka (seperti tercetak)',
  'Project / Pekerjaan *': 'Proyek / Pekerjaan *',
  'pick a tender you have backed before and its owner fills itself':
    'pilih tender yang pernah Anda dukung, pemiliknya akan terisi sendiri',
  'e.g. RTWS Package Fabrication and Installation Services Projects Zona 9 (II)':
    'mis. RTWS Package Fabrication and Installation Services Projects Zona 9 (II)',
  'Addressed to — end user': 'Ditujukan kepada — pengguna akhir',
  'e.g. PT Pertamina Hulu Sanga Sanga': 'mis. PT Pertamina Hulu Sanga Sanga',
  'End-user address': 'Alamat pengguna akhir',
  'type and warranty come from the item master':
    'tipe dan garansi diambil dari data induk barang',
  'Search catalog…': 'Cari katalog…',
  'Solar Modules': 'Modul Surya',
  'Remove row': 'Hapus baris',
  'Brands (Merk) — printed in the opening line':
    'Merek — dicetak pada kalimat pembuka',
  'Blank uses the items’ own brands:': 'Dikosongkan berarti memakai merek barangnya sendiri:',
  'Sales handling this': 'Sales yang menangani',
  '— unassigned —': '— belum ditugaskan —',
  'Our signatory': 'Penanda tangan kami',
  'e.g. Wendy Yusson Abadi': 'mis. Wendy Yusson Abadi',
  'Signatory title': 'Jabatan penanda tangan',
  'Issuing company': 'Perusahaan penerbit',
  'Place · number code': 'Tempat · kode nomor',
  'The letters inside the document number (013-ISL-SD-VII-2026)':
    'Huruf di dalam nomor dokumen (013-ISL-SD-VII-2026)',
  'Administration fee (Rp)': 'Biaya administrasi (Rp)',
  'Fee received date': 'Tanggal biaya diterima',
  'Internal note': 'Catatan internal',
  'Not printed': 'Tidak dicetak',
  'Letter body — standard clauses (pre-filled)':
    'Isi surat — klausul baku (sudah terisi)',
  'Undertakings — one per line, numbered when printed':
    'Pernyataan — satu per baris, dinomori saat dicetak',
  'Validity clause': 'Klausul masa berlaku',
  'Closing': 'Penutup',
  'Delete {name}?': 'Hapus {name}?',
  'this letter': 'surat ini',
  'Yes': 'Ya',
  'No': 'Tidak',
  'Create letter': 'Buat surat',
  'Pick the customer this letter supports.': 'Pilih pelanggan yang didukung surat ini.',
  'Name the project (Pekerjaan) — it is what the letter is for.':
    'Isi nama proyek (Pekerjaan) — itulah yang didukung surat ini.',
  'Support letter created.': 'Surat dukungan dibuat.',
  'Support letter saved.': 'Surat dukungan tersimpan.',
  'Fee marked received — the letter is ready to issue.':
    'Biaya ditandai diterima — surat siap diterbitkan.',
  'Payment cleared.': 'Tanda pembayaran dibatalkan.',
  'Letter deleted.': 'Surat dihapus.',

  // ── Fulfillment panel: invoices and delivery orders, inside the quotation ──
  'Fulfillment': 'Pemenuhan',
  '{inv} invoices · {dos} delivery orders': '{inv} faktur · {dos} surat jalan',
  'Invoiced {pct}% — over 100%': 'Difakturkan {pct}% — lebih dari 100%',
  'Rp {amount} left to invoice': 'Rp {amount} belum difakturkan',
  'The order is fully invoiced': 'Pesanan sudah difakturkan seluruhnya',
  'Bill all or part of this order — pick the items and quantities in the next step':
    'Tagih seluruh atau sebagian pesanan ini — pilih barang dan jumlahnya di langkah berikutnya',
  'New Invoice': 'Faktur Baru',
  'Delete invoice': 'Hapus faktur',
  'Payments are recorded against this invoice — remove them first.':
    'Ada pembayaran yang tercatat pada faktur ini — hapus dulu pembayarannya.',
  '{done} of {all} units': '{done} dari {all} unit',
  '{n} preparing': '{n} sedang disiapkan',
  '{n} units not yet on a DO': '{n} unit belum masuk surat jalan',
  'Everything is already on a DO': 'Semuanya sudah masuk surat jalan',
  'Ship all or part of this order — pick the items and quantities in the next step':
    'Kirim seluruh atau sebagian pesanan ini — pilih barang dan jumlahnya di langkah berikutnya',
  'New Delivery Order': 'Surat Jalan Baru',
  'Source warehouse': 'Gudang asal',
  'Warehouse the stock-out is posted against when a DO is marked delivered':
    'Gudang yang stoknya dikurangi saat surat jalan ditandai terkirim',
  '{n} units': '{n} unit',
  'pick-up': 'diambil sendiri',
  'Mark Delivered': 'Tandai Terkirim',
  'Delete DO': 'Hapus surat jalan',
  'Reopen': 'Buka kembali',
  'Reverse this DO’s stock-out and put it back in Preparing':
    'Batalkan pengurangan stok surat jalan ini dan kembalikan ke status Menyiapkan',
  'Reopen the DO first — a delivered DO cannot be deleted directly.':
    'Buka kembali surat jalannya dulu — surat jalan yang sudah terkirim tidak bisa langsung dihapus.',
  'Delivery order deleted': 'Surat jalan dihapus',

  'Prefilled with everything still uninvoiced — post as-is for the full bill, or trim quantities / switch to a % of the order to split.':
    'Sudah terisi dengan semua yang belum difakturkan — simpan apa adanya untuk tagihan penuh, atau kurangi jumlahnya / ganti ke % dari pesanan untuk memecahnya.',
  'By items & qty': 'Per barang & jumlah',
  '% of order (DP / progress)': '% dari pesanan (DP / termin)',
  '{done} / {all} billed': '{done} / {all} difakturkan',
  'Remaining: {n}': 'Sisa: {n}',
  '% of order total': '% dari total pesanan',
  'Invoice date': 'Tanggal faktur',
  'incl. PPN': 'termasuk PPN',
  'Create Invoice': 'Buat Faktur',
  'Nothing to invoice — enter a quantity': 'Tidak ada yang difakturkan — isi jumlahnya',
  'Enter a percentage': 'Isi persentasenya',

  'Prefilled with everything not yet on a DO — trim quantities to split the shipment. Stock moves when this DO is marked delivered.':
    'Sudah terisi dengan semua yang belum masuk surat jalan — kurangi jumlahnya untuk memecah pengiriman. Stok berkurang saat surat jalan ini ditandai terkirim.',
  '{done} / {all} on DOs': '{done} / {all} masuk surat jalan',
  'Shipping': 'Mengirim',
  'units on this DO': 'unit pada surat jalan ini',
  'Nothing to ship — enter a quantity': 'Tidak ada yang dikirim — isi jumlahnya',

  // ── Sales list, delivery queue and invoice list — the last English left ──
  'Sales Orders · DQ → PQ → SO': 'Pesanan Penjualan · DQ → PQ → SO',
  'Library': 'Pustaka',
  'New Quote': 'Penawaran Baru',
  'New Order': 'Pesanan Baru',
  'Sales Order': 'Pesanan Penjualan',
  'Quote (PQ)': 'Penawaran (PQ)',
  'Order (SO)': 'Pesanan (SO)',
  'Payment': 'Pembayaran',
  'Delivery date': 'Tanggal kirim',
  'Nothing waiting — confirmed orders appear here until they’re delivered.':
    'Tidak ada antrean — pesanan yang sudah dikonfirmasi muncul di sini sampai terkirim.',
  'Unpaid only': 'Hanya yang belum dibayar',

  // Status transitions on the quotation command bar — the buttons that move a
  // document down the ladder. Stored in English, shown in the reader's language.
  'Validate': 'Validasi',
  'Confirm Order': 'Konfirmasi Pesanan',
  'Revert': 'Kembalikan',
  'Reject': 'Tolak',
  'View letter': 'Lihat surat',

  // -- The product P&L (owner-only tab on Profitability, 2026-09-09) --------
  'P&L Statement': 'Laporan Laba Rugi',
  'Monthly, quarterly and yearly gross profit by category and item':
    'Laba kotor bulanan, triwulanan dan tahunan per kategori dan barang',
};

const DICTS: Record<Lang, Record<string, string>> = { en: {}, id: ID };

/**
 * Translate one explanatory string.
 *
 * Pure on purpose — the language is passed in, never read from a module
 * singleton, so this file has no dependencies and the phrase book can be
 * tested on its own. `hooks/useT` is what binds it to the company setting.
 *
 * Falls back to the English it was given, always: a missing translation must
 * read as the sentence it replaced, never as a key or a blank.
 */
export function t(en: string, lang: Lang = 'en'): string {
  if (lang === 'en') return en;
  return DICTS[lang]?.[en] ?? en;
}

/**
 * A sentence with values dropped into it — `{name}` placeholders, never
 * concatenation.
 *
 *   tf('{n} of {total} quotes', lang, { n, total })
 *
 * Concatenating fragments ("of" + n + "quotes") is how a translated screen
 * ends up with the words in an order nobody says out loud: word order,
 * plurals and prepositions differ between languages, and a fragment carries
 * none of that. Keeping the whole sentence as one phrase-book entry lets the
 * Indonesian put the pieces wherever Indonesian puts them.
 *
 * An unknown placeholder is left as written rather than blanked, so a typo
 * shows itself on screen instead of silently deleting a number.
 */
export function tf(en: string, lang: Lang, vars: Record<string, string | number>): string {
  return t(en, lang).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** How much of the phrase book is filled in — shown in Settings. */
export const translationCount = (lang: Lang): number => Object.keys(DICTS[lang] ?? {}).length;
