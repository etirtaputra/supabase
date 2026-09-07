/**
 * An HTTP body → a `MountingInput` the engine will accept.
 *
 * This lives beside the engine rather than in the API layer for two reasons.
 * It belongs to the engine's contract — the defaults here ARE the designer
 * screen's defaults, and if one moves both must. And it must be testable by
 * `node --test`, which cannot resolve the `@/` aliases the settings chain
 * uses, so it cannot sit in a file that reaches the pricing engine.
 *
 * The engines are pinned by golden tests; this normalisation is not, and it is
 * exactly where an API stops matching the screen it claims to mirror. Hence
 * `mountingInput.test.ts`.
 */
import type { MountingInput } from './mounting.ts';

const asNumber = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v.trim()) : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function mountingInputFrom(body: Record<string, unknown>): {
  input: MountingInput; missing: string[];
} {
  const input: MountingInput = {
    panelCount: asNumber(body.panelCount),
    numberOfRows: asNumber(body.numberOfRows) || 1,
    panelLengthMm: asNumber(body.panelLengthMm),
    panelWidthMm: asNumber(body.panelWidthMm),
    // The designer's defaults: one row, 20 mm gap, a 35 mm frame, roof,
    // portrait. v7 also defaults a missing frame to 35.
    panelThicknessMm: asNumber(body.panelThicknessMm) || 35,
    railLengthMm: asNumber(body.railLengthMm),
    panelSpacingMm: asNumber(body.panelSpacingMm) || 20,
    mountType: (['roof', 'ground', 'flat'].includes(String(body.mountType))
      ? String(body.mountType) : 'roof') as MountingInput['mountType'],
    orientation: (String(body.orientation) === 'landscape'
      ? 'landscape' : 'portrait') as MountingInput['orientation'],
  };
  // The engine bails rather than guessing a module's size, so name the field
  // instead of returning a design built on zeroes.
  const missing = (['panelCount', 'panelLengthMm', 'panelWidthMm', 'railLengthMm'] as const)
    .filter((k) => !input[k]);
  return { input, missing };
}
