/**
 * Placement defaults: extra parameter values a newly placed part starts with, on top of its
 * library defaults. The integration layer installs a provider for the user's default instrument
 * settings (Options > Default instrument settings); without a provider parts start with the
 * library defaults only.
 */
import type { PartDef } from '../../library/types';

type Provider = (part: PartDef) => Record<string, string> | undefined;

let provider: Provider | null = null;

/** Install (or with null remove) the placement-defaults provider. */
export function setPlacementDefaults(fn: Provider | null): void {
  provider = fn;
}

/** Saved defaults for a part about to be placed (only keys the part has). */
export function placementDefaults(part: PartDef): Record<string, string> {
  const extra = provider?.(part);
  if (!extra) return {};
  const keys = new Set(part.params.map((p) => p.key));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) if (keys.has(k)) out[k] = v;
  return out;
}
