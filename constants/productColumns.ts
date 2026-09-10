/**
 * The optional columns of the /products table (Description is the identity
 * column — always on). One registry, two consumers: the page's Columns menu
 * (personal, this browser) and Settings › Lists (owner enforcement for
 * everyone via `productHiddenColumns`). Brand is additionally gated by the
 * canViewBrand capability wherever it is offered.
 *
 * `tiers` is ONE key for N columns — the active price tiers are rows in
 * `21.0_price_tiers`, so the table renders as many as there are. It replaced a
 * single "Sell Price" column that showed the net and then said "3 tiers ▾",
 * which meant the answer to "what does a Tier-2 customer pay?" was always one
 * click away. Nothing is lost by the swap: the net price IS Tier 1
 * (`lib/tierPricing.ts`), so the first tier column is the old one.
 *
 * WARRANTY AND SHEET ARE NOT HERE, deliberately (owner, 2026-09-10:
 * *"keep the Warranty and Sheet inside the dropdown when users click. This way
 * it shows what matters."*). Both are still on every row — in the expanded
 * panel, where they are editable — but neither answers a question a person
 * scanning a price list is asking. They remain sortable from the Sort menu.
 *
 * `brand` stays offered and stays gated by `canViewBrand`. The brand FILTER
 * was removed the same day as sensitive — but a dropdown that enumerates every
 * supplier brand we carry and a column a buy-side user may already read are
 * different acts, and only the first one discloses anything.
 */
export const PRODUCT_COLS = [
  { key: 'stock',    label: 'Stock' },
  { key: 'incoming', label: 'Incoming' },
  { key: 'tiers',    label: 'Tier prices' },
  { key: 'brand',    label: 'Brand' },
  { key: 'category', label: 'Category' },
  { key: 'capacity', label: 'Capacity' },
  { key: 'updated',  label: 'Updated' },
] as const;

export type ProductColKey = typeof PRODUCT_COLS[number]['key'];

/**
 * Keys that used to be columns, mapped to what now carries them.
 *
 * An owner who hid "Sell Price" in Settings › Lists meant "do not show these
 * people prices". Dropping the old key would have silently turned prices back
 * on for everyone the day this shipped, which is the worst way for a setting
 * to be retired. `warranty` and `sheet` map to nothing — they are no longer
 * columns for anyone, so hiding them is already satisfied.
 */
export const LEGACY_PRODUCT_COLS: Record<string, ProductColKey | null> = {
  price: 'tiers',
  warranty: null,
  sheet: null,
};
