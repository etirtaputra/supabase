/**
 * The category picker's options — the two-level taxonomy inside ONE field.
 *
 * The owner's constraint on adding a main category was that it must not cost a
 * second column in the Item Editor or the Products list (2026-09-05). It does
 * not: the main category is a `<optgroup>` heading, so the aisle and the
 * category are both visible while the control stays a single `<select>` bound
 * to the single `category` column.
 *
 * Grouped in the taxonomy's own order rather than alphabetically, because the
 * order MAIN_CATEGORIES declares is the order of a catalogue — panels,
 * inverters, batteries, controllers — and an alphabetical list would put
 * Accessories first on every screen.
 */

import { MAIN_CATEGORIES, CATEGORY_LABEL, UNGROUPED_CATEGORIES, categoryLabelOf } from '../../constants/productTaxonomy';

interface Props {
  /** Categories to offer. Defaults to the whole taxonomy. */
  only?: readonly string[];
}

export function CategoryOptionGroups({ only }: Props) {
  const allowed = only ? new Set(only) : null;
  const keep = (c: string) => !allowed || allowed.has(c);

  return (
    <>
      {MAIN_CATEGORIES.map((main) => {
        const cats = main.categories.filter(keep);
        if (cats.length === 0) return null;
        return (
          <optgroup key={main.key} label={main.label}>
            {cats.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>
            ))}
          </optgroup>
        );
      })}
      {/* `non_stock` sits in no aisle on purpose — it is what the catalogue
          keeps but never sells from a shelf. It is still selectable, under a
          heading that says so, rather than hidden. */}
      {UNGROUPED_CATEGORIES.filter(keep).length > 0 && (
        <optgroup label="Not in a main category">
          {UNGROUPED_CATEGORIES.filter(keep).map((c) => (
            <option key={c} value={c}>{categoryLabelOf(c)}</option>
          ))}
        </optgroup>
      )}
    </>
  );
}
