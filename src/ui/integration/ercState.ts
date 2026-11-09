/**
 * Result of the last electrical rules check (Tools > ERC), so the ERC tab can tell "no problems
 * found" apart from "not checked yet", and say when the design changed after the check.
 */
import type { Design } from '../../model/types';
import { createStore } from '../store/createStore';

export interface ErcCheck {
  /** number of findings (errors + warnings) */
  issues: number;
  /** the design object that was checked (designs are immutable: any edit makes a new one) */
  design: Design;
}

export const lastErcCheck = createStore<ErcCheck | null>(null);
