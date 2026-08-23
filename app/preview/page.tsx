import { notFound } from 'next/navigation';
import Harness from './Harness';

/**
 * The component preview — a colour and layout rig, DEVELOPMENT ONLY.
 *
 * Why it exists: twice in two days a chart shipped broken in a way nothing
 * else could catch. Tokenising the palette handed an SVG `fill` a variable
 * NAME instead of a colour, which is not an error — SVG paints black — so it
 * type-checked, built, passed every test, and reached the owner as two black
 * discs. The unit tests guard the arithmetic and the source; only a rendered
 * pixel guards the rendering.
 *
 * Every component here takes its rows as PROPS, so this needs no database, no
 * sign-in and no network — which is exactly why it works in a sandbox that
 * cannot reach Supabase.
 *
 * It 404s outside development. The route still exists in a production build
 * (Next has no way to drop a page from the manifest at build time), so the
 * guard is at request time and `lib/palette.test.ts` pins it.
 */
export default function PreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Harness />;
}
