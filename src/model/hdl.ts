/**
 * VHDL and Verilog export of MachSim's programmable logic.
 *
 * The source is a compiled logic program (`src/sim/devices/digital/logicExpr.ts`): Boolean
 * equations or a truth table, with combinational outputs (`O0 = …`), registered outputs
 * (`O1 := …`, a D flip-flop on the rising clock edge) and per-output enables (`O2.oe = …`). The
 * same program runs the PLD block in the simulator, so what the learner simulates and what the
 * exported file describes are the same logic.
 *
 * Both templates are MachSim's own: a plain entity / architecture pair for VHDL-93 and a
 * Verilog-2001 module, with every signal a single `std_logic` / `wire`, concurrent assignments for
 * the combinational outputs, one clocked process / `always` block for the registered ones and a
 * `when … else 'Z'` / `?:` for the tri-state ones. The text is deliberately simple so a learner can
 * read it next to the equations, and it carries a header comment saying where it came from.
 *
 * Port names. The learner names the signals, and the names a beginner reaches for first — IN, OUT,
 * CLK — are either reserved words of the two languages or clash with the ports MachSim adds itself.
 * {@link hdlModule} therefore makes the port list legal before anything is printed:
 *   - a name that is a reserved word of VHDL-93 (IEEE 1076) or Verilog-2001 (IEEE 1364) gets the
 *     suffix `_s` ("IN" -> "IN_s"); the lists below are the published keyword lists of the two
 *     standards;
 *   - inputs, outputs, the clock and the output-enable port are made unique in ONE pass, and
 *     case-insensitively, because VHDL does not distinguish `CLK` from `clk` (an input called
 *     "clk" next to a registered output used to give an entity two ports of the same name);
 *   - the register signal of a registered output (`q_<name>`) is kept clear of the port names too.
 * Every change is listed in {@link HdlModule.renamed} — the PLD wizard shows it, and the generated
 * file carries it as a comment, so the learner is never surprised by a name they did not type.
 *
 * Out of scope (documented, not attempted): JEDEC fuse maps. A JEDEC file is a bitmap of the fuse
 * array of ONE device family — the fuse numbering, the product-term order and the macrocell
 * configuration bits differ from device to device and come from the manufacturer's device file.
 * There is no sound generic mapping, so MachSim exports HDL (which every PLD / CPLD toolchain
 * compiles) instead of guessing a fuse map.
 */
import type { LogicNode, LogicProgram } from '../sim/devices/digital/logicExpr';

/** One output of the exported module. */
export interface HdlOutput {
  /** port name */
  name: string;
  /** the Boolean expression driving it */
  node: LogicNode;
  /** loaded from the expression on the rising clock edge instead of following it */
  registered: boolean;
  /** the output drives only while this expression is 1 (otherwise high impedance) */
  oe?: LogicNode;
  /** name of the register signal of a registered output (default `q_<name>`) */
  reg?: string;
}

export interface HdlModule {
  /** entity / module name */
  name: string;
  /** input port names; index k is `I<k>` in the equations */
  inputs: string[];
  /** output ports; index k is `O<k>` in the equations */
  outputs: HdlOutput[];
  /** clock port name (added when an output is registered) */
  clock: string;
  /** active-low global output-enable port name (added when any output is tri-state) */
  outputEnable: string;
  /** header comment lines (no comment markers) */
  comment: string[];
  /** names the export had to change to stay legal (reserved word, clash); empty when none */
  renamed: { from: string; to: string }[];
}

export interface HdlModuleOptions {
  name?: string;
  inputs?: readonly string[];
  outputs?: readonly string[];
  clock?: string;
  outputEnable?: string;
  comment?: readonly string[];
}

/**
 * Reserved words of VHDL-93 (IEEE 1076) and Verilog-2001 (IEEE 1364), lower-cased. Both lists are
 * part of the published language standards. A port may not be named after one of them, and VHDL is
 * case-insensitive, so "IN" is as reserved as "in".
 */
export const HDL_RESERVED: ReadonlySet<string> = new Set([
  // VHDL-93
  'abs', 'access', 'after', 'alias', 'all', 'and', 'architecture', 'array', 'assert', 'attribute',
  'begin', 'block', 'body', 'buffer', 'bus', 'case', 'component', 'configuration', 'constant',
  'disconnect', 'downto', 'else', 'elsif', 'end', 'entity', 'exit', 'file', 'for', 'function',
  'generate', 'generic', 'group', 'guarded', 'if', 'impure', 'in', 'inertial', 'inout', 'is',
  'label', 'library', 'linkage', 'literal', 'loop', 'map', 'mod', 'nand', 'new', 'next', 'nor',
  'not', 'null', 'of', 'on', 'open', 'or', 'others', 'out', 'package', 'port', 'postponed',
  'procedure', 'process', 'pure', 'range', 'record', 'register', 'reject', 'rem', 'report',
  'return', 'rol', 'ror', 'select', 'severity', 'shared', 'signal', 'sla', 'sll', 'sra', 'srl',
  'subtype', 'then', 'to', 'transport', 'type', 'unaffected', 'units', 'until', 'use', 'variable',
  'wait', 'when', 'while', 'with', 'xnor', 'xor',
  // Verilog-2001 (the ones VHDL does not already cover)
  'always', 'assign', 'automatic', 'begin_', 'cell', 'cmos', 'config', 'deassign', 'default',
  'defparam', 'design', 'disable', 'edge', 'endcase', 'endconfig', 'endfunction', 'endgenerate',
  'endmodule', 'endprimitive', 'endspecify', 'endtable', 'endtask', 'event', 'force', 'forever',
  'fork', 'genvar', 'highz0', 'highz1', 'ifnone', 'incdir', 'include', 'initial', 'inside',
  'instance', 'integer', 'join', 'large', 'liblist', 'localparam', 'macromodule', 'medium',
  'module', 'negedge', 'nmos', 'noshowcancelled', 'parameter', 'pmos', 'posedge', 'primitive',
  'pull0', 'pull1', 'pulldown', 'pullup', 'rcmos', 'real', 'realtime', 'reg', 'release', 'repeat',
  'rnmos', 'rpmos', 'rtran', 'rtranif0', 'rtranif1', 'scalared', 'showcancelled', 'signed',
  'small', 'specify', 'specparam', 'strong0', 'strong1', 'supply0', 'supply1', 'table', 'task',
  'time', 'tran', 'tranif0', 'tranif1', 'tri', 'tri0', 'tri1', 'triand', 'trior', 'trireg',
  'unsigned', 'uwire', 'vectored', 'wand', 'weak0', 'weak1', 'wire', 'wor', 'xnor_',
  // Verilog port directions (the names the wizard sees most often)
  'input', 'output',
]);

/** Suffix a reserved word gets so it can be an identifier ("IN" -> "IN_s"). */
const RESERVED_SUFFIX = '_s';

/**
 * A valid VHDL / Verilog identifier: letters, digits and '_', starting with a letter and never a
 * reserved word of either language. Vietnamese letters keep their base letter ("bộ cộng đầy đủ" ->
 * "bo_cong_day_du") instead of being dropped, so the entity name still reads like the name the
 * learner typed.
 */
export function hdlIdentifier(text: string, fallback: string): string {
  const ascii = (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
  let s = ascii.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (s.length === 0 || !/^[A-Za-z]/.test(s)) s = `${fallback}${s.length > 0 ? `_${s}` : ''}`;
  while (HDL_RESERVED.has(s.toLowerCase())) s = `${s}${RESERVED_SUFFIX}`;
  return s;
}

/** Make every name unique (case-insensitively) by appending _2, _3 … */
function unique(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const key = n.toLowerCase();
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    return k === 0 ? n : `${n}_${k + 1}`;
  });
}

/** A name that is not in `taken` yet (case-insensitively), with `taken` updated. */
function freeName(name: string, taken: Set<string>): string {
  let out = name;
  for (let k = 2; taken.has(out.toLowerCase()); k++) out = `${name}_${k}`;
  taken.add(out.toLowerCase());
  return out;
}

/**
 * Build an export module from a compiled program. `inputs` / `outputs` name the ports (missing
 * names become I0 / O0 …); the module keeps one port per index of the program, so an output with
 * no equation is driven low. Reserved words and clashes are fixed up here — see the module header
 * — and reported in {@link HdlModule.renamed}.
 */
export function hdlModule(program: LogicProgram, nIn: number, nOut: number, opts: HdlModuleOptions = {}): HdlModule {
  const given = [
    ...Array.from({ length: nIn }, (_, k) => (opts.inputs?.[k] ?? '').trim()),
    (opts.clock ?? '').trim(),
    (opts.outputEnable ?? '').trim(),
    ...Array.from({ length: nOut }, (_, k) => (opts.outputs?.[k] ?? '').trim()),
  ];
  // one uniqueness pass over every port of the entity: inputs, clock, enable and outputs together
  const all = unique([
    ...Array.from({ length: nIn }, (_, k) => hdlIdentifier(opts.inputs?.[k] ?? '', `I${k}`)),
    hdlIdentifier(opts.clock ?? '', 'CLK'),
    hdlIdentifier(opts.outputEnable ?? '', 'OE_N'),
    ...Array.from({ length: nOut }, (_, k) => hdlIdentifier(opts.outputs?.[k] ?? '', `O${k}`)),
  ]);
  const renamed: { from: string; to: string }[] = [];
  all.forEach((to, k) => {
    const from = given[k];
    if (from && from !== to) renamed.push({ from, to });
  });
  const inputs = all.slice(0, nIn);
  const clock = all[nIn];
  const outputEnable = all[nIn + 1];
  const outNames = all.slice(nIn + 2);
  // register signals must not collide with a port either
  const taken = new Set(all.map((n) => n.toLowerCase()));
  const byIndex = new Map(program.outputs.map((o) => [o.index, o]));
  const outputs: HdlOutput[] = outNames.map((name, k) => {
    const o = byIndex.get(k);
    return {
      name,
      node: o ? o.node : ({ k: 'c', v: 0 } as LogicNode),
      registered: !!o?.registered,
      ...(o?.oeNode ? { oe: o.oeNode } : {}),
      reg: freeName(hdlIdentifier(`q_${name}`, `q_O${k}`), taken),
    };
  });
  return {
    name: hdlIdentifier(opts.name ?? '', 'machsim_logic'),
    inputs,
    outputs,
    clock,
    outputEnable,
    comment: [...(opts.comment ?? [])],
    renamed,
  };
}

/** True when the module needs a clock port. */
export function needsClock(m: HdlModule): boolean {
  return m.outputs.some((o) => o.registered);
}

/** True when the module needs the global output-enable port. */
export function needsEnable(m: HdlModule): boolean {
  return m.outputs.some((o) => o.oe !== undefined);
}

// ---------------------------------------------------------------------------------------------
// expression printing

interface Dialect {
  not: (inner: string) => string;
  and: string;
  or: string;
  xor: string;
  one: string;
  zero: string;
}

const VHDL: Dialect = { not: (s) => `not ${s}`, and: 'and', or: 'or', xor: 'xor', one: "'1'", zero: "'0'" };
const VERILOG: Dialect = { not: (s) => `~${s}`, and: '&', or: '|', xor: '^', one: "1'b1", zero: "1'b0" };

/**
 * Print an expression. `operand` gives the text of input k / output k. VHDL has no precedence
 * between and / or / xor, so every binary node is parenthesised in both dialects — the result is
 * explicit and reads the same in either language.
 */
function printNode(n: LogicNode, d: Dialect, operand: (kind: 'i' | 'o', index: number) => string): string {
  switch (n.k) {
    case 'c':
      return n.v ? d.one : d.zero;
    case 'i':
      return operand('i', n.i);
    case 'o':
      return operand('o', n.i);
    case 'not': {
      const inner = printNode(n.a, d, operand);
      return d.not(n.a.k === 'and' || n.a.k === 'or' || n.a.k === 'xor' ? inner : `${inner}`);
    }
    default: {
      const op = n.k === 'and' ? d.and : n.k === 'or' ? d.or : d.xor;
      return `(${printNode(n.a, d, operand)} ${op} ${printNode(n.b, d, operand)})`;
    }
  }
}

/** Register signal name of a registered output. */
function regName(o: HdlOutput): string {
  return o.reg ?? `q_${o.name}`;
}

/** Operand lookup: inputs are ports, a registered output reads its register. */
function operandOf(m: HdlModule): (kind: 'i' | 'o', index: number) => string {
  return (kind, index) => {
    if (kind === 'i') return m.inputs[index] ?? `I${index}`;
    const o = m.outputs[index];
    if (!o) return `O${index}`;
    return o.registered ? regName(o) : o.name;
  };
}

/** Comment lines about the names the export had to change (empty when nothing changed). */
function renameNotes(m: HdlModule): string[] {
  if (!m.renamed.length) return [];
  return [`exported with changed signal names (reserved word or duplicate): ${m.renamed.map((r) => `${r.from} -> ${r.to}`).join(', ')}`];
}

// ---------------------------------------------------------------------------------------------
// VHDL

/** VHDL-93 entity and architecture of a module. */
export function vhdlText(m: HdlModule): string {
  const operand = operandOf(m);
  const expr = (n: LogicNode) => printNode(n, VHDL, operand);
  const clock = needsClock(m);
  const enable = needsEnable(m);
  const ports: string[] = [
    ...m.inputs.map((n) => `${n} : in  std_logic`),
    ...(clock ? [`${m.clock} : in  std_logic`] : []),
    ...(enable ? [`${m.outputEnable} : in  std_logic`] : []),
    ...m.outputs.map((o) => `${o.name} : out std_logic`),
  ];
  const width = Math.max(...ports.map((p) => p.indexOf(' :')));
  const portLines = ports.map((p, i) => {
    const colon = p.indexOf(' :');
    const padded = `${p.slice(0, colon).padEnd(width)}${p.slice(colon)}`;
    return `    ${padded}${i === ports.length - 1 ? '' : ';'}`;
  });
  const regs = m.outputs.filter((o) => o.registered);
  const body: string[] = [];
  for (const o of m.outputs) {
    const source = o.registered ? regName(o) : expr(o.node);
    if (o.oe) body.push(`  ${o.name} <= ${source} when (${expr(o.oe)} = '1'${enable ? ` and ${m.outputEnable} = '0'` : ''}) else 'Z';`);
    else if (enable) body.push(`  ${o.name} <= ${source} when (${m.outputEnable} = '0') else 'Z';`);
    else body.push(`  ${o.name} <= ${source};`);
  }
  const process: string[] = regs.length
    ? [
        '',
        `  registers : process (${m.clock}) is`,
        '  begin',
        `    if rising_edge(${m.clock}) then`,
        ...regs.map((o) => `      ${regName(o)} <= ${expr(o.node)};`),
        '    end if;',
        '  end process registers;',
      ]
    : [];
  return [
    ...[...m.comment, ...renameNotes(m)].map((c) => `-- ${c}`),
    'library IEEE;',
    'use IEEE.STD_LOGIC_1164.all;',
    '',
    `entity ${m.name} is`,
    '  port (',
    ...portLines,
    '  );',
    `end entity ${m.name};`,
    '',
    `architecture rtl of ${m.name} is`,
    ...regs.map((o) => `  signal ${regName(o)} : std_logic := '0';`),
    'begin',
    ...body,
    ...process,
    'end architecture rtl;',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Verilog

/** Verilog-2001 module of a logic program. */
export function verilogText(m: HdlModule): string {
  const operand = operandOf(m);
  const expr = (n: LogicNode) => printNode(n, VERILOG, operand);
  const clock = needsClock(m);
  const enable = needsEnable(m);
  const regs = m.outputs.filter((o) => o.registered);
  const ports: string[] = [
    ...m.inputs.map((n) => `  input  wire ${n}`),
    ...(clock ? [`  input  wire ${m.clock}`] : []),
    ...(enable ? [`  input  wire ${m.outputEnable}`] : []),
    ...m.outputs.map((o) => `  output wire ${o.name}`),
  ];
  const body: string[] = [];
  for (const o of m.outputs) {
    const source = o.registered ? regName(o) : expr(o.node);
    const on = o.oe ? `${expr(o.oe)}${enable ? ` & ~${m.outputEnable}` : ''}` : enable ? `~${m.outputEnable}` : '';
    body.push(on.length > 0 ? `  assign ${o.name} = (${on}) ? ${source} : 1'bz;` : `  assign ${o.name} = ${source};`);
  }
  const always: string[] = regs.length
    ? [
        '',
        `  always @(posedge ${m.clock}) begin`,
        ...regs.map((o) => `    ${regName(o)} <= ${expr(o.node)};`),
        '  end',
      ]
    : [];
  return [
    ...[...m.comment, ...renameNotes(m)].map((c) => `// ${c}`),
    '`timescale 1ns / 1ps',
    '',
    `module ${m.name} (`,
    ports.join(',\n'),
    ');',
    ...regs.map((o) => `  reg ${regName(o)} = 1'b0;`),
    ...body,
    ...always,
    'endmodule',
    '',
  ].join('\n');
}

/** The two languages the export offers. */
export type HdlLanguage = 'vhdl' | 'verilog';

/** File extension of a language. */
export function hdlExtension(lang: HdlLanguage): string {
  return lang === 'vhdl' ? '.vhd' : '.v';
}

/** Text of a module in either language. */
export function hdlText(m: HdlModule, lang: HdlLanguage): string {
  return lang === 'vhdl' ? vhdlText(m) : verilogText(m);
}
