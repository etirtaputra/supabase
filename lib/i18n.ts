/**
 * Bahasa Indonesia for the text that EXPLAINS the app.
 *
 * The owner's rule (2026-08-19): menu labels stay English — "Stock", "Deal
 * Lookup", "Landed Cost" are the vocabulary the team already shares with
 * suppliers and customers, and translating them would give one thing two
 * names. What gets translated is everything that explains: the one-liners
 * under menu entries, the page subtitles, the hints under Settings fields, and
 * the tooltips people hover for.
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
  'Every PI → PO → payment as one deal':
    'Setiap PI → PO → pembayaran sebagai satu transaksi',
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
  'Price tiers, margin floor audit, per-item overrides':
    'Tier harga, audit batas bawah margin, penyesuaian per barang',
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
  'Nothing has landed in the last':
    'Tidak ada barang masuk dalam',
  'days. Settings \u203a Defaults sets how long an item counts as new.':
    'hari terakhir. Atur lamanya di Settings \u203a Defaults.',
  'Nothing is on order \u2014 every purchase order has been received or closed.':
    'Tidak ada pesanan berjalan \u2014 semua PO sudah diterima atau ditutup.',
  'sets the starting point for everyone.':
    'menetapkan titik awal untuk semua orang.',

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
  'Received': 'Diterima',
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
  'Done': 'Selesai',
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
  'All brands': 'Semua merek',
  'Clear ×': 'Hapus ×',
  'Live/Physical': 'Tersedia/Fisik',
  'Incoming': 'Transit',
  'No products match.': 'Tidak ada barang yang cocok.',
  '↑ Newer version': '↑ Versi lebih baru',
  'Import products — preview': 'Impor barang — pratinjau',
  'Updates': 'Pembaruan',
  'New products': 'Barang baru',
  'Cancel': 'Batal',
  'Expected arrival': 'Perkiraan tiba',
  'no date': 'tanpa tanggal',
  'No net price —': 'Belum ada harga net —',
  'set it in Catalog': 'atur di Catalog',
  'Datasheet URL (Drive or web)': 'Tautan datasheet (Drive atau web)',
  'Open': 'Buka',
  'Open datasheet': 'Buka datasheet',
  'Open the item hub': 'Buka Item Hub',
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
  'Choose which columns the table shows': 'Pilih kolom yang ditampilkan',
  'Drag to set the Description width — double-click to reset':
    'Geser untuk mengatur lebar kolom Description — klik dua kali untuk mengembalikan',
  'Open the item hub — buy, sell, stock, specs on one page':
    'Buka Item Hub — pembelian, penjualan, stok, dan spesifikasi dalam satu halaman',
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
  'No customer': 'Tanpa pelanggan',
  'Expired': 'Kedaluwarsa',
  'none yet': 'belum ada',
  'no DO yet': 'belum ada DO',
  'No items on this quote.': 'Tidak ada barang pada penawaran ini.',
  'Grand Total (excl. PPN)': 'Total (sebelum PPN)',
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
    'Klik dokumen mana pun untuk membukanya di Deal Lookup.',
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
  'New PO →': 'PO baru →',
  'All warehouses': 'Semua gudang',
  '⇄ move': '⇄ pindah',
  'Move stock': 'Pindahkan stok',
  'Moves at the source warehouse&apos;s average cost — total inventory value is unchanged.':
    'Dipindahkan pada biaya rata-rata gudang asal — total nilai persediaan tidak berubah.',
  'The default warehouse — the one preselected when receiving, adjusting or shipping — is set in Settings':
    'Gudang bawaan — yang otomatis terpilih saat menerima, menyesuaikan, atau mengirim — diatur di Settings',
  'At the current demand rate, stock runs out before a PO raised today could arrive':
    'Dengan laju permintaan saat ini, stok habis sebelum PO yang dibuat hari ini bisa tiba',
  'Open the item hub — buy history, lead times, demand':
    'Buka Item Hub — riwayat pembelian, lead time, permintaan',
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
  'All {n} {noun}s that have sold in this period.':
    'Semua {n} {noun} yang terjual pada periode ini.',
  'Top {shown} of {n} {noun}s that have sold.':
    '{shown} teratas dari {n} {noun} yang terjual.',
  'These carry {pct}% of the total.': 'Semuanya mencakup {pct}% dari total.',
  'Ranked by revenue — the cost of these goods could not be read.':
    'Diurutkan berdasarkan omzet — biaya barang ini tidak bisa dibaca.',
  'Some of this profit uses today’s average cost, because those deliveries predate the stock ledger.':
    'Sebagian laba ini memakai biaya rata-rata hari ini, karena pengiriman tersebut terjadi sebelum buku stok ada.',

  // ── Page subtitles (BrandMenu) ────────────────────────────────────────────
  'Stock · Warehouse': 'Stock · Gudang',
  'Customers · CRM': 'Customers · Data pelanggan',
  'Delivery · Orders out the door': 'Delivery · Barang keluar',
  'Invoices · Accounts receivable': 'Invoices · Piutang',
  'After Sales · Service & warranty cases': 'After Sales · Servis & garansi',
  'Banks · Accounts & cash position': 'Banks · Rekening & posisi kas',
  'Serial Numbers · Unit register': 'Serial Numbers · Daftar unit',

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
    'Buka Deal Lookup untuk meninjau PO yang masih berjalan',
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
  'Back to Stock': 'Kembali ke Stock',
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
    'Kembali ke Deal Lookup — catatan PI → PO → pembayaran',
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
