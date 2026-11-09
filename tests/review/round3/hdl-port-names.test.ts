/**
 * Review round 3: VHDL / Verilog export of the PLD wizard (step 5, src/model/hdl.ts and
 * src/model/wizards/pldDesign.ts).
 *
 * The wizard asks the learner for signal names and says the HDL uses them as port names. It only
 * refuses AND / OR / XOR / NOT / OE / C (translateNames RESERVED), and hdlIdentifier() only makes the
 * text an identifier. So the most natural names a Vietnamese beginner types for a block — "IN" and
 * "OUT" — and names such as "input", "signal", "begin", "end", "wire" are accepted and written as
 * ports, giving a file every VHDL / Verilog tool rejects ("in" / "out" are VHDL reserved words —
 * VHDL is case-insensitive — and "input" / "output" / "wire" are Verilog keywords).
 * Also, unique() is applied to the inputs and to the outputs SEPARATELY and never to the clock /
 * enable ports: an input called "clk" next to a registered output gives the VHDL entity two ports
 * named CLK / clk (the same identifier in VHDL), and an input "a" with an output "A" collide too.
 *
 * Expected: the exported port list never contains a reserved word of the language and no two ports
 * share a name (case-insensitively for VHDL). Fails today.
 */
import { describe, expect, it } from 'vitest';
import { compileLogicProgram } from '../../../src/sim/devices/digital/logicExpr';
import { hdlModule, verilogText, vhdlText } from '../../../src/model/hdl';
import { translateNames } from '../../../src/model/wizards/pldDesign';

const VHDL_RESERVED = new Set(['in', 'out', 'inout', 'signal', 'begin', 'end', 'entity', 'is', 'port', 'and', 'or', 'not', 'xor', 'process', 'architecture', 'of', 'buffer', 'register', 'wait', 'next']);
const VERILOG_RESERVED = new Set(['input', 'output', 'inout', 'wire', 'reg', 'module', 'endmodule', 'assign', 'begin', 'end', 'always', 'if', 'else']);

/** Port names of a VHDL entity (lines "    NAME : in  std_logic;"). */
function vhdlPorts(text: string): string[] {
  return [...text.matchAll(/^\s{4}(\w+)\s*:\s*(?:in|out|inout)\s/gm)].map((m) => m[1]);
}

/** Port names of a Verilog module header (lines "  input  wire NAME,"). */
function verilogPorts(text: string): string[] {
  return [...text.matchAll(/^\s*(?:input|output|inout)\s+(?:wire\s+|reg\s+)?(\w+)/gm)].map((m) => m[1]);
}

function exportFor(inputs: string[], outputs: string[], program: string) {
  const tr = translateNames(program, inputs, outputs);
  expect(tr.nameErrors).toEqual([]);
  const p = compileLogicProgram(tr.text, inputs.length, outputs.length);
  expect(p.errors).toEqual([]);
  const m = hdlModule(p, inputs.length, outputs.length, { name: 'khoi', inputs, outputs });
  return { vhdl: vhdlText(m), verilog: verilogText(m) };
}

describe('HDL export port names', () => {
  it('control: A, B → Y exports the ports A, B, Y', () => {
    const { vhdl, verilog } = exportFor(['A', 'B'], ['Y'], 'Y = A & B');
    expect(vhdlPorts(vhdl)).toEqual(['A', 'B', 'Y']);
    expect(verilogPorts(verilog)).toEqual(['A', 'B', 'Y']);
  });

  const reservedCases: [string[], string[], string][] = [
    [['IN', 'EN'], ['OUT'], 'OUT = IN & EN'],
    [['input', 'b'], ['output'], 'output = input | b'],
    [['signal', 'begin'], ['wire'], 'wire = signal & begin'],
  ];
  for (const [inputs, outputs, program] of reservedCases) {
    it(`names ${[...inputs, ...outputs].join(', ')} are either refused or exported as legal identifiers`, () => {
      const tr = translateNames(program, inputs, outputs);
      if (tr.nameErrors.length > 0) return; // refused with a message: fine
      const { vhdl, verilog } = exportFor(inputs, outputs, program);
      expect(vhdlPorts(vhdl).filter((p) => VHDL_RESERVED.has(p.toLowerCase()))).toEqual([]);
      expect(verilogPorts(verilog).filter((p) => VERILOG_RESERVED.has(p))).toEqual([]);
    });
  }

  it('an input "clk" next to a registered output does not give two clock ports', () => {
    const inputs = ['clk', 'en'];
    const outputs = ['Q'];
    const tr = translateNames('Q := en & !Q', inputs, outputs);
    if (tr.nameErrors.length > 0) return;
    const p = compileLogicProgram(tr.text, 2, 1);
    expect(p.errors).toEqual([]);
    const m = hdlModule(p, 2, 1, { name: 'dem', inputs, outputs });
    const ports = vhdlPorts(vhdlText(m)).map((x) => x.toLowerCase());
    expect(new Set(ports).size).toBe(ports.length);
  });
});
