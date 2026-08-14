/**
 * The optional columns of the /products table (Description is the identity
 * column — always on). One registry, two consumers: the page's Columns menu
 * (personal, this browser) and Settings › Lists (owner enforcement for
 * everyone via `productHiddenColumns`). Brand is additionally gated by the
 * canViewBrand capability wherever it is offered.
 */
export const PRODUCT_COLS = [
  { key: 'price',    label: 'Sell Price' },
  { key: 'stock',    label: 'Stock' },
  { key: 'incoming', label: 'Incoming' },
  { key: 'brand',    label: 'Brand' },
  { key: 'category', label: 'Category' },
  { key: 'capacity', label: 'Capacity' },
  { key: 'warranty', label: 'Warranty' },
  { key: 'sheet',    label: 'Sheet' },
  { key: 'updated',  label: 'Updated' },
] as const;

export type ProductColKey = typeof PRODUCT_COLS[number]['key'];
