/**
 * Instructor restrictions of a design (Design.restrictions): password hashing and the rules the
 * editor, the simulation controller, the reports and the exports enforce.
 *
 *   createRestrictions(password, options, design) -> DesignRestrictions  (async: PBKDF2)
 *   verifyPassword(restrictions, password)       -> boolean               (async)
 *   valuesHidden / partLocked / analysisAllowed / instrumentAllowed / descriptionLocked / answersHidden
 *   restrictionViolation(prev, next)             -> what a proposed edit would break, or null
 *   maskValue(design, text)                      -> "?" when values are hidden
 *   clipboardRestrictionKey / pasteAllowed       -> copied hidden values only paste back under the same restrictions
 *   partValuesHidden(design, def)                -> the values of this part are hidden (not instruments / power symbols)
 *
 * Only a salted PBKDF2-HMAC-SHA-256 hash of the password is stored (RESTRICTION_ITERATIONS
 * rounds, 16-byte random salt). The restrictions guard the editor UI of MachSim: a student who
 * edits the .msim JSON by hand can remove them, so they are a classroom aid, not encryption.
 */
import type { AnalysisType } from '../sim/netlist';
import { fromHex, pbkdf2Sha256, randomBytes, toHex, utf8 } from '../util/sha256';
import type { Design, DesignRestrictions, InstrumentKind, PartInstance } from './types';

/** PBKDF2 rounds for new passwords (fast enough for the plain-JS fallback, ≈ 0.1–0.3 s). */
export const RESTRICTION_ITERATIONS = 20000;

/** What the instructor restricts (everything except the password fields). */
export type RestrictionOptions = Omit<DesignRestrictions, 'passwordHash' | 'salt' | 'iterations' | 'lockedParts'>;

/** Hash of a password with a salt (hex in, hex out). */
export async function hashPassword(password: string, saltHex: string, iterations: number): Promise<string> {
  return toHex(await pbkdf2Sha256(utf8(password), fromHex(saltHex), iterations, 32));
}

/** Every part instance of the design (root sheets and child designs). */
export function allPartInstances(design: Design): PartInstance[] {
  const out: PartInstance[] = [];
  for (const s of design.sheets) out.push(...s.parts);
  for (const c of design.children ?? []) for (const s of c.sheets) out.push(...s.parts);
  return out;
}

/**
 * New restrictions protected by `password`. With `lockParts` the parts placed now (root and child
 * designs) become locked; parts added later by students stay editable.
 */
export async function createRestrictions(password: string, options: RestrictionOptions, design: Design, salt = toHex(randomBytes(16))): Promise<DesignRestrictions> {
  const passwordHash = await hashPassword(password, salt, RESTRICTION_ITERATIONS);
  const r: DesignRestrictions = { passwordHash, salt, iterations: RESTRICTION_ITERATIONS };
  if (options.hideValues) r.hideValues = true;
  if (options.lockParts) {
    r.lockParts = true;
    r.lockedParts = allPartInstances(design).map((p) => p.id);
  }
  if (options.disabledAnalyses?.length) r.disabledAnalyses = [...options.disabledAnalyses];
  if (options.disabledInstruments?.length) r.disabledInstruments = [...options.disabledInstruments];
  if (options.lockDescription) r.lockDescription = true;
  if (options.hideAnswers) r.hideAnswers = true;
  return r;
}

/** Same restrictions with new options (the password stays; locked parts are taken again). */
export function updateRestrictions(r: DesignRestrictions, options: RestrictionOptions, design: Design): DesignRestrictions {
  const next: DesignRestrictions = { passwordHash: r.passwordHash, salt: r.salt, iterations: r.iterations };
  if (options.hideValues) next.hideValues = true;
  if (options.lockParts) {
    next.lockParts = true;
    next.lockedParts = allPartInstances(design).map((p) => p.id);
  }
  if (options.disabledAnalyses?.length) next.disabledAnalyses = [...options.disabledAnalyses];
  if (options.disabledInstruments?.length) next.disabledInstruments = [...options.disabledInstruments];
  if (options.lockDescription) next.lockDescription = true;
  if (options.hideAnswers) next.hideAnswers = true;
  return next;
}

/** The options of existing restrictions (for the instructor dialog). */
export function restrictionOptions(r: DesignRestrictions | undefined): RestrictionOptions {
  return {
    hideValues: !!r?.hideValues,
    lockParts: !!r?.lockParts,
    disabledAnalyses: [...(r?.disabledAnalyses ?? [])],
    disabledInstruments: [...(r?.disabledInstruments ?? [])],
    lockDescription: !!r?.lockDescription,
    hideAnswers: !!r?.hideAnswers,
  };
}

/** True when `password` is the instructor password of the restrictions. */
export async function verifyPassword(r: DesignRestrictions, password: string): Promise<boolean> {
  const h = await hashPassword(password, r.salt, r.iterations);
  // compare all characters (no early exit)
  let diff = h.length ^ r.passwordHash.length;
  for (let i = 0; i < Math.min(h.length, r.passwordHash.length); i++) diff |= h.charCodeAt(i) ^ r.passwordHash.charCodeAt(i);
  return diff === 0;
}

export const isRestricted = (design: Pick<Design, 'restrictions'>): boolean => !!design.restrictions;
export const valuesHidden = (design: Pick<Design, 'restrictions'>): boolean => !!design.restrictions?.hideValues;
export const descriptionLocked = (design: Pick<Design, 'restrictions'>): boolean => !!design.restrictions?.lockDescription;
export const answersHidden = (design: Pick<Design, 'restrictions'>): boolean => !!design.restrictions?.hideAnswers;

/** A part locked by the instructor (it cannot be moved, deleted or edited). */
export function partLocked(design: Pick<Design, 'restrictions'>, partInstanceId: string): boolean {
  const r = design.restrictions;
  return !!r?.lockParts && !!r.lockedParts?.includes(partInstanceId);
}

export function analysisAllowed(design: Pick<Design, 'restrictions'>, type: AnalysisType): boolean {
  return !design.restrictions?.disabledAnalyses?.includes(type);
}

export function instrumentAllowed(design: Pick<Design, 'restrictions'>, kind: InstrumentKind | undefined): boolean {
  return kind === undefined || !design.restrictions?.disabledInstruments?.includes(kind);
}

/** Text shown instead of a part value while values are hidden. */
export const HIDDEN_VALUE = '?';

/** `text`, or "?" when the design hides part values. */
export function maskValue(design: Pick<Design, 'restrictions'>, text: string): string {
  return valuesHidden(design) ? HIDDEN_VALUE : text;
}

/**
 * Key of the instructor restrictions that hide the values of `design` (null when values are not
 * hidden). The editor keeps it with the clipboard: parts copied from such a design carry their real
 * values, so they may only be pasted back into a design under the same restrictions.
 */
export function clipboardRestrictionKey(design: Pick<Design, 'restrictions'>): string | null {
  const r = design.restrictions;
  return r?.hideValues ? `${r.salt}:${r.passwordHash}` : null;
}

/** True when a clipboard copied under `hiddenBy` (see clipboardRestrictionKey) may be pasted into `target`. */
export function pasteAllowed(hiddenBy: string | null, target: Pick<Design, 'restrictions'>): boolean {
  return hiddenBy === null || clipboardRestrictionKey(target) === hiddenBy;
}

/**
 * True when the instructor hides the parameter values of this part in `design`: components and
 * sources (instruments and power symbols keep their settings visible).
 */
export function partValuesHidden(design: Pick<Design, 'restrictions'>, def: { instrument?: unknown; globalNet?: unknown } | undefined): boolean {
  return valuesHidden(design) && !!def && !def.instrument && def.globalNet === undefined;
}

export type RestrictionViolation = 'lockedPart' | 'description';

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * What the change prev -> next would break while the restrictions stay the same, or null. A change
 * of the restrictions object itself (the instructor dialog, after checking the password) is allowed.
 * Locked parts must keep their position, orientation, part, refdes and parameters; a locked
 * description box keeps its text, images and questions (the student's answers may change).
 */
export function restrictionViolation(prev: Design, next: Design): RestrictionViolation | null {
  const r = prev.restrictions;
  if (!r || prev === next) return null;
  if (!sameJson(r, next.restrictions)) return null;
  if (r.lockParts && r.lockedParts?.length) {
    const before = new Map(allPartInstances(prev).map((p) => [p.id, p]));
    const after = new Map(allPartInstances(next).map((p) => [p.id, p]));
    for (const id of r.lockedParts) {
      const a = before.get(id);
      if (!a) continue;
      const b = after.get(id);
      if (!b) return 'lockedPart';
      if (a === b) continue;
      if (a.x !== b.x || a.y !== b.y || a.rotation !== b.rotation || a.mirror !== b.mirror || a.partId !== b.partId || a.refdes !== b.refdes) return 'lockedPart';
      if (!sameJson(a.params, b.params) || !sameJson(a.faults, b.faults) || a.modelOverride !== b.modelOverride || a.excludeFromSim !== b.excludeFromSim || !sameJson(a.notFitted, b.notFitted)) return 'lockedPart';
    }
  }
  if (r.lockDescription) {
    const a = prev.descriptionBox;
    const b = next.descriptionBox;
    if (a !== b && (a?.text !== b?.text || !sameJson(a?.images, b?.images) || !sameJson(a?.questions, b?.questions) || a?.showOnOpen !== b?.showOnOpen)) return 'description';
  }
  return null;
}
