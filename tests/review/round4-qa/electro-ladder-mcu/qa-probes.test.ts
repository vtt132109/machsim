/**
 * Round-4 hands-on QA (electromechanical / audio / ladder / 8051 / scripts / exchange): repro tests
 * for defects found by clicking through the app. Each test states the learner-visible symptom.
 * They are expected to FAIL until the defect is fixed.
 */
import { describe, expect, it } from 'vitest';
import { getLang, setLang } from '../../../../src/i18n';
import { aut } from '../../../../src/i18n/audioText';
import { mt, type McuTextKey } from '../../../../src/i18n/mcuText';
import { formatEng } from '../../../../src/util/units';
import { compileWatch } from '../../../../src/mcu/watch';
import { Cpu8051, machineCycleSeconds } from '../../../../src/mcu/cpu8051';
import { CoreDebugger } from '../../../../src/mcu/debugger';
import { ScriptSession, type ScriptIO } from '../../../../src/script/session';
import { partName } from '../../../../src/i18n/library';

function inVi<T>(fn: () => T): T {
  const before = getLang();
  setLang('vi');
  try {
    return fn();
  } finally {
    setLang(before);
  }
}

describe('QE: Grapher > Export WAV length line', () => {
  // The dialog shows aut('exportSeconds', { t: formatEng(duration, 's', 3), … }) and the template
  // already ends "{t} s": the learner reads "Độ dài thật của tín hiệu: 1 s s" (and "1 ks s" for 1000 s).
  it('does not print the unit twice', () => {
    const line = inVi(() => aut('exportSeconds', { t: formatEng(1, 's', 3), n: 44100 }));
    expect(line).not.toMatch(/\bs s\b/);
    const long = inVi(() => aut('exportSeconds', { t: formatEng(1000, 's', 3), n: 44100000 }));
    expect(long).not.toMatch(/ks s/);
  });
});

describe('QE: 8051 Watch tab, "Dừng khi đổi" on a port pin', () => {
  // The tooltip says stop-on-change works "cho ô nhớ, SFR và bit"; P1 is an SFR and P1.0 a bit, the
  // signal sample 93 is about. Both compile without memory refs, so the checkbox stays disabled.
  it('P1.0 and P1 give the hardware watch a cell to stop on', () => {
    const bit = compileWatch('P1.0');
    const sfr = compileWatch('P1');
    expect(bit.ok && bit.refs.length, 'P1.0 refs').toBeGreaterThan(0);
    expect(sfr.ok && sfr.refs.length, 'P1 refs').toBeGreaterThan(0);
  });
});

describe('QE: 8051 debugger, "Dừng ngay" after running', () => {
  // A manual break (Dừng ngay) holds with the "start" reason, so after 13 million cycles the status
  // line reads "Đã dừng (trước lệnh đầu tiên)" — "before the first instruction".
  it('a manual break after the program ran is not reported as "before the first instruction"', () => {
    const cpu = new Cpu8051();
    // MAIN: CPL P1.0 ; SJMP MAIN
    cpu.loadCode([0xb2, 0x90, 0x80, 0xfc]);
    for (let i = 0; i < 100; i++) cpu.step();
    expect(cpu.cycles).toBeGreaterThan(0);
    const dbg = new CoreDebugger(cpu, machineCycleSeconds(12e6));
    dbg.breakNow();
    const text = inVi(() => mt(`dbgReason${dbg.reason}` as McuTextKey));
    expect(text).not.toBe('trước lệnh đầu tiên');
  });
});

describe('QE: BOM tab of sample 70 in the Vietnamese UI', () => {
  // BomTab renders partName({ id: r.partId, name: r.name }) / partDescription({ id, description }):
  // the plain object has no textVi, so parts whose Vietnamese text lives on the definition (the
  // round-4 relays, contactor coils, overload relays) show "Thermal Overload Relay 1P",
  // "Contactor Coil 24 V DC" and English descriptions next to "Điện trở" / "Bóng đèn".
  it('names the overload relay and the contactor coil in Vietnamese', () => {
    const names = inVi(() => [
      partName({ id: 'electromechanical/overload-relay-1p', name: 'Thermal Overload Relay 1P' }),
      partName({ id: 'electromechanical/contactor-coil-24vdc', name: 'Contactor Coil 24 V DC' }),
    ]);
    // control: the resistor row of the same BOM is Vietnamese through the same call
    expect(inVi(() => partName({ id: 'basic/resistor', name: 'Resistor' }))).toBe('Điện trở');
    expect(names[0]).not.toBe('Thermal Overload Relay 1P');
    expect(names[1]).not.toBe('Contactor Coil 24 V DC');
  });
});

describe('QE: Scripts, MachSim.newDesign() in the Vietnamese UI', () => {
  // A design built by a script and opened with showDesign() has a sheet named "Sheet 1" (status bar,
  // sheet tab) while every other new design in the Vietnamese UI starts with "Trang 1".
  it('names the first sheet in the UI language', async () => {
    const io = {} as ScriptIO;
    const before = getLang();
    setLang('vi');
    try {
      const s = new ScriptSession(io);
      await s.call('newDesign', ['Loc RC']);
      expect(s.design.sheets[0].name).toBe('Trang 1');
    } finally {
      setLang(before);
    }
  });
});
