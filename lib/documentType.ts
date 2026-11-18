/**
 * The typeface of every PRINTED document — price quote / invoice, delivery
 * order, EPC proposal, support letter. One home, so the four print pages can
 * never set four different faces.
 *
 * IBM Plex Sans since 2026-09-28 (owner: yes to matching the Corporate skin).
 * It was Rubik. Two things were measured before the switch, because these go
 * to customers and a quote that spills onto a second page is a real cost:
 *
 *   • WIDTH — Plex runs 3–5% NARROWER than Rubik at 9.5pt (median over ~400
 *     real labels and item names; bold 5%). Nothing that fitted stops fitting.
 *   • HEIGHT — Plex's default ("normal") line height is 1.31em against
 *     Rubik's 1.19em, +10%, which WOULD have pushed long quotes onto another
 *     page. So the body pins Rubik's 1.19: every line keeps the height it had.
 *     A rule that already states its own line height keeps it.
 *
 * Rubik stays second in the stack as the fallback it always was.
 */
export const DOC_FONT_FAMILY = "'IBM Plex Sans', Rubik, -apple-system, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, 'Noto Sans Math', 'Noto Sans Symbols 2', sans-serif";

/**
 * The two fallbacks above, for the characters IBM Plex lacks (arrows, ✓, ≥, Ω…).
 * A desktop finds those in a system font; the server that makes the EPC PDF
 * (lib/pdfRender) has none, so they printed as empty boxes (2026-11-18). A
 * print page that can be rendered there links this stylesheet; Google serves
 * each font only for the characters a page actually uses.
 */
export const DOC_SYMBOL_FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Math&family=Noto+Sans+Symbols+2&display=swap';
export const DOC_LINE_HEIGHT = 1.19;
