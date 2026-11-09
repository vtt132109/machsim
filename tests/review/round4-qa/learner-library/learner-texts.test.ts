/**
 * Round 4 QA (learner experience and library), failing repro tests for wording / UI-text findings.
 *
 * QL5  ten Vietnamese texts (8051 code editor empty state, the 8051 help page, lesson hints, ERC fix,
 *      ladder messages) send the learner to the library group "Số linh tinh"; the group is called
 *      "Số lý tưởng" in the part browser, so the learner cannot find it.
 * QL6  the WAV export dialog says "Độ dài thật của tín hiệu: 420 s s": the template adds " s" after
 *      a value that formatEng already wrote with its unit.
 * QL7  the dual-opamp lesson theory has the heading "Mạch trong lesson" (English word).
 * QL8  the live-readout table of the Simulation panel shows the raw part kind ("led", "seven-seg",
 *      "ammeter", "voltmeter", "lamp", "mecha", "speaker", "probe", "lcd") and the mode line shows
 *      "Tương tác (running)" (raw session state).
 * QL9  a script run that hits an ERC error shows the raw English engine message inside the
 *      Vietnamese text: "Mạch có lỗi nên chưa mô phỏng được: Net oa: a 'output' pin (U1A.1OUT) meets
 *      a 'output' pin (…)".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setLang, t } from '../../../../src/i18n';
import { aut } from '../../../../src/i18n/audioText';
import { ROUND4_TEXT } from '../../../../src/i18n/lessons/round4';
import { formatEng } from '../../../../src/util/units';

const SRC = join(__dirname, '../../../../src');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('QL5 the library group named in Vietnamese texts exists', () => {
  it('every text that says "Số linh tinh" names a real group', () => {
    setLang('vi');
    const groupName = t('group.misc-digital');
    const users = files(join(SRC, 'i18n')).filter((f) => readFileSync(f, 'utf8').includes('Số linh tinh'));
    if (users.length) expect(groupName, `group is "${groupName}" but ${users.length} files say "Số linh tinh"`).toBe('Số linh tinh');
  });
});

describe('QL6 WAV export length line', () => {
  it('does not print the unit twice', () => {
    setLang('vi');
    const line = aut('exportSeconds', { t: formatEng(420, 's', 3), n: 18522000 });
    expect(line).not.toMatch(/\bs s\b/);
  });
});

describe('QL7 dual-opamp lesson theory', () => {
  it('has no English word "lesson" in the Vietnamese theory', () => {
    const vi = JSON.stringify(ROUND4_TEXT['dual-opamp'] ?? ROUND4_TEXT).replace(/"en":"(?:[^"\\]|\\.)*"/g, '');
    expect(vi).not.toMatch(/Mạch trong lesson/);
  });
});

describe('QL8 Simulation panel shows raw ids', () => {
  const panels = readFileSync(join(SRC, 'ui/integration/panels.tsx'), 'utf8');
  it('the live-readout table does not print the raw part kind', () => {
    expect(panels).not.toMatch(/<td className="msx-dim">\{r\.kind\}<\/td>/);
  });
  it('the mode line does not print the raw session state', () => {
    expect(panels).not.toMatch(/interactiveSession', \{ session: live\.session \}/);
  });
});

describe('QL9 script ERC error text', () => {
  it('translates the ERC message instead of joining the raw engine text', () => {
    const session = readFileSync(join(SRC, 'script/session.ts'), 'utf8');
    expect(session).not.toMatch(/sx\('ercErrors', \{ list: errors\.map\(\(m\) => m\.message\)/);
  });
});
