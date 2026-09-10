/**
 * The toolbar control tokens — one height, one radius, one border, everywhere.
 *
 * OWNER'S STANDING RULE, 2026-09-10: *"it's important for me to use the same
 * border size. always. to maintain consistencies and uniformity."*
 *
 * These lived as local `const`s at the bottom of `app/products/page.tsx`, which
 * is how the filter bar ended up with two heights in it: the selects and the
 * mode button stood at 36px and the filter chips at 26px, because the chips
 * were copied from Selling Prices — where they were also 26px, beside selects
 * that were also 36px. Neither screen was wrong on its own terms and the bar
 * looked ragged on both.
 *
 * A rule stated as "always" needs one definition or it becomes a convention
 * people remember for a while. `controls.test.ts` fails if a screen writes its
 * own bar height instead of importing this one.
 *
 * THE ONE DELIBERATE SPLIT is `h-11 sm:h-9`: 44px on a phone, which is the tap
 * target a thumb hits reliably, and 36px on a mouse, where 44 is oversized.
 * That is one rule with two viewports, not two rules.
 */

/** Every control in a filter bar stands this tall. */
export const BAR_H = 'h-11 sm:h-9';

/** …with this border, radius, fill and focus ring. */
export const BAR_BOX = 'bg-slate-800 border border-slate-700 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors';

/** A `<select>` in the bar. */
export const BAR_SELECT = `${BAR_H} px-2.5 ${BAR_BOX} text-slate-300 text-[12.5px] cursor-pointer`;

/** A text `<input>` in the bar. */
export const BAR_INPUT = `${BAR_H} px-3 ${BAR_BOX} text-white text-[13px] placeholder:text-slate-500`;

/**
 * A button in the bar — a mode toggle, a menu opener, a filter chip.
 *
 * `on` fills it; `off` is the same box every select wears. The two states share
 * a border width, so a chip does not change size when you click it — a control
 * that moves its neighbours when toggled is how a row starts feeling loose.
 */
export const BAR_BTN = `${BAR_H} inline-flex items-center rounded-lg border text-[12.5px] font-medium whitespace-nowrap transition-colors`;
export const BAR_BTN_OFF = 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600';
export const BAR_BTN_ON = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
export const BAR_BTN_ON_SKY = 'bg-sky-500/15 border-sky-500/40 text-sky-300';
