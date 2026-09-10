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
 * EVERY SPLIT HERE IS PHONE-versus-MOUSE, and each has a reason that is not
 * taste:
 *
 *  · `h-11 sm:h-9` — 44px is the tap target a thumb hits reliably; 36px is
 *    right for a pointer, where 44 looks oversized.
 *  · text `base sm:[13px]` on inputs — under 16px, iOS zooms the page on focus
 *    and does not zoom back.
 *  · text `[13px] sm:[12.5px]` on selects and buttons — a phone is held
 *    further from the eye than a monitor sits, and half a point back is what
 *    keeps a label readable without pushing it out of its box.
 *
 * One rule with two viewports each time, never two rules.
 */

/** Every control in a filter bar stands this tall. */
export const BAR_H = 'h-11 sm:h-9';

/** …with this border, radius, fill and focus ring. */
export const BAR_BOX = 'bg-slate-800 border border-slate-700 rounded-lg outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors';

/** A `<select>` in the bar. */
export const BAR_SELECT = `${BAR_H} px-2.5 ${BAR_BOX} text-slate-300 text-[13px] sm:text-[12.5px] cursor-pointer`;

/**
 * A text `<input>` in the bar. **16px on a phone, and that is not a taste
 * decision.**
 *
 * iOS Safari zooms the whole page when you focus an input whose font-size is
 * under 16px, and it does not zoom back out — you tap the search box and the
 * layout jumps, then you pinch to recover. At 13px this list did that every
 * single time somebody searched on a phone. 16px is the threshold; `text-base`
 * is exactly 16px.
 *
 * The desktop size stays 13px, where the same rule does not apply and 16 looks
 * oversized next to a 12.5px select.
 */
export const BAR_INPUT = `${BAR_H} px-3 ${BAR_BOX} text-white text-base sm:text-[13px] placeholder:text-slate-500`;

/**
 * A button in the bar — a mode toggle, a menu opener, a filter chip.
 *
 * `on` fills it; `off` is the same box every select wears. The two states share
 * a border width, so a chip does not change size when you click it — a control
 * that moves its neighbours when toggled is how a row starts feeling loose.
 */
export const BAR_BTN = `${BAR_H} inline-flex items-center rounded-lg border text-[13px] sm:text-[12.5px] font-medium whitespace-nowrap transition-colors`;
export const BAR_BTN_OFF = 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600';
export const BAR_BTN_ON = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
export const BAR_BTN_ON_SKY = 'bg-sky-500/15 border-sky-500/40 text-sky-300';
