/**
 * Programmable logic block (PLD) code model.
 *
 *   D_PLD   i0..i(n-1) clk ~oe o0..o(m-1)
 *     params n_in (n), n_out (m); model literal `program` = Boolean equations or a truth table
 *     (logicExpr.ts). Combinational outputs follow their equation (operands Ok read the output's
 *     present value: feedback); registered outputs (':=') load their equation on the rising edge
 *     of clk, evaluated with the input values at the edge; all registers update together.
 *     ~oe (NULL = enabled) high releases every output; "Ok.oe = expr" releases one output while
 *     expr is 0. Registers start at 0. Outputs without an equation stay low.
 */
import { Z, netlistError, range, type BehaviourFactory } from './behaviour';
import { compileLogicProgram, type CompiledOutput } from './logicExpr';

const pld: BehaviourFactory = (ctx) => {
  const nIn = ctx.p.int('n_in', 0);
  const nOut = ctx.p.int('n_out', 0);
  if (!(nIn >= 1 && nIn <= 32) || !(nOut >= 1 && nOut <= 32)) throw netlistError(ctx.name, `n_in and n_out must be 1..32 (got ${nIn}, ${nOut})`);
  if (ctx.ports !== nIn + 2 + nOut) throw netlistError(ctx.name, `expected ${nIn + 2 + nOut} port nodes (i.. clk ~oe o..), got ${ctx.ports}`);
  const prog = compileLogicProgram(ctx.p.text('program') ?? '', nIn, nOut);
  if (prog.errors.length) throw netlistError(ctx.name, `logic program: ${prog.errors[0]}`);
  const byIndex: (CompiledOutput | null)[] = new Array<CompiledOutput | null>(nOut).fill(null);
  for (const o of prog.outputs) byIndex[o.index] = o;
  const clk = nIn;
  const oe = nIn + 1;
  const inBuf = new Float64Array(nIn);
  const fb = new Float64Array(nOut);
  return {
    inputs: range(0, nIn + 2),
    outputs: range(nIn + 2, nOut).map((port) => ({ port })),
    // st[k] = register / last driven value of output k (feedback)
    state: nOut,
    eval(io) {
      if (!io.dc && io.rising(clk)) {
        const t = io.cross[clk];
        io.setTime(t);
        for (let k = 0; k < nIn; k++) inBuf[k] = io.at(k, t);
        for (let k = 0; k < nOut; k++) fb[k] = io.st[k];
        for (const o of prog.outputs) if (o.registered) io.st[o.index] = o.fn(inBuf, fb);
      }
      for (let k = 0; k < nIn; k++) inBuf[k] = io.in[k];
      for (let k = 0; k < nOut; k++) fb[k] = io.st[k];
      for (let k = 0; k < nOut; k++) {
        const o = byIndex[k];
        if (o && !o.registered) io.st[k] = o.fn(inBuf, fb);
      }
      const globalOff = io.present[oe] === 1 && io.in[oe] === 1;
      for (let k = 0; k < nOut; k++) {
        const o = byIndex[k];
        const off = globalOff || (o?.oe !== undefined && o.oe(inBuf, fb) === 0);
        io.out[k] = off ? Z : o ? io.st[k] : 0;
      }
    },
  };
};

export const PLD_BEHAVIOURS: Record<string, BehaviourFactory> = { D_PLD: pld };
