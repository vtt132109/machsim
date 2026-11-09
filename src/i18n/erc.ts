/**
 * Beginner-friendly explanations of ERC findings and simulation errors.
 *
 *   explainErc(m)          -> { title, why, fix } for an ErcMessage (uses m.detail when present)
 *   explainSimError(text)  -> { title, why, fix, detail } for an engine error message
 *
 * The netlister / engine keep their short technical English messages (stable for logs and tests);
 * this module turns them into "what is wrong, why it matters, how to fix it" in the current
 * language. Texts live in the catalogue section src/i18n/messages/erc.ts (keys erc.<id>.title /
 * .why / .fix and sim.err.<kind>.*).
 */
import type { ErcMessage } from '../model/types';
import { hasMessage, t, tDynamic, type MessageParams } from './index';
import { ladderProblemText } from './ladderErrors';

export interface Explanation {
  /** what is wrong (one line, with the part / net names) */
  title: string;
  /** why it is a problem */
  why: string;
  /** how to fix it */
  fix: string;
  /** the original technical message (shown small, for reference) */
  detail?: string;
}

const CODE_FALLBACK: Record<ErcMessage['code'], string> = {
  'no-ground': 'noGround',
  'floating-pin': 'floatingPin',
  'single-pin-net': 'singlePinNet',
  'duplicate-refdes': 'duplicateRefdes',
  'unknown-part': 'unknownPart',
  'bad-param': 'badParam',
  'voltage-loop': 'sourceLoop',
  'current-cutset': 'noDcPath',
  'dangling-wire': 'danglingWire',
  'pin-type': 'pinTypeClash',
  other: 'other',
};

function texts(id: string, params: MessageParams | undefined, fallbackTitle: string): Explanation {
  const key = (part: string) => `erc.${id}.${part}`;
  return {
    title: hasMessage(key('title')) ? tDynamic(key('title'), params) : fallbackTitle,
    why: tDynamic(key('why'), params, t('erc.other.why')),
    fix: tDynamic(key('fix'), params, t('erc.other.fix')),
  };
}

/** Explanation of one ERC message in the current language. */
export function explainErc(m: ErcMessage): Explanation {
  if (m.detail && hasMessage(`erc.${m.detail.id}.title`)) {
    // the compiler's problem codes of a ladder program read as the ladder editor words them
    const params = m.detail.id === 'ladderRung' ? { ...m.detail.params, summary: ladderProblemText(m.detail.params as Parameters<typeof ladderProblemText>[0]) } : m.detail.params;
    return { ...texts(m.detail.id, params, m.message), detail: m.message };
  }
  // messages without structured detail: explain by rule, keep the technical line as the title
  const id = CODE_FALLBACK[m.code] ?? 'other';
  const e = texts(id, { refdes: m.refdes ?? '?', pin: m.pin ?? '?', net: m.net ?? '?' }, m.message);
  return { ...e, title: m.message, detail: m.message };
}

/** Severity word in the current language. */
export function severityText(severity: 'error' | 'warning' | 'info'): string {
  return t(`erc.severity.${severity}`);
}

/** Rule name in the current language. */
export function ruleText(code: ErcMessage['code']): string {
  return tDynamic(`erc.rule.${code}`, undefined, code);
}

// ---------------------------------------------------------------------------------------------
// simulation errors

interface SimPattern {
  kind: string;
  re: RegExp;
  params?: (m: RegExpMatchArray) => MessageParams;
}

const SIM_PATTERNS: SimPattern[] = [
  { kind: 'singularNode', re: /Singular matrix: no valid pivot for (node [^;]+|V\([^)]*\))/i, params: (m) => ({ what: m[1] }) },
  { kind: 'singular', re: /Singular matrix: no valid pivot for ([^;]+)/i, params: (m) => ({ what: m[1] }) },
  { kind: 'singular', re: /singular/i, params: () => ({ what: '?' }) },
  { kind: 'timestep', re: /Timestep too small at t = (\S+) s/i, params: (m) => ({ time: m[1] }) },
  { kind: 'noconv', re: /did not converge|not converging|Operating point failed|iteration limit/i },
  { kind: 'aborted', re: /aborted|cancell?ed/i },
  { kind: 'noGround', re: /no ground/i },
  { kind: 'unsupported', re: /not supported|unsupported|cannot be swept|has no adjustable/i },
  { kind: 'notFound', re: /'([^']+)' not found|unknown node '([^']+)'|none of the outputs/i, params: (m) => ({ name: m[1] ?? m[2] ?? '?' }) },
  { kind: 'badSetting', re: /invalid|must be|needs|no output selected|no tolerances|no sweep values|no analyses|required/i },
];

/** Explanation of a simulation error message (engine or controller) in the current language. */
export function explainSimError(message: string): Explanation {
  for (const p of SIM_PATTERNS) {
    const m = message.match(p.re);
    if (!m) continue;
    const params = p.params ? p.params(m) : undefined;
    return {
      title: tDynamic(`sim.err.${p.kind}.title`, params),
      why: tDynamic(`sim.err.${p.kind}.why`, params),
      fix: tDynamic(`sim.err.${p.kind}.fix`, params),
      detail: message,
    };
  }
  return { title: t('sim.err.generic.title'), why: t('sim.err.generic.why'), fix: t('sim.err.generic.fix'), detail: message };
}

/**
 * Element or part names mentioned in an error message (e.g. "V1", "R3", "V_XFG1_p" -> XFG1),
 * used to offer "show on the schematic".
 */
export function mentionedRefdes(message: string): string[] {
  const out = new Set<string>();
  for (const m of message.matchAll(/\b([A-Z][A-Z0-9]*_)?([A-Z]{1,4}\d+)(?:_\w+)?\b/g)) out.add(m[2]);
  return [...out];
}
