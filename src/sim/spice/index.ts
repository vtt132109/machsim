/**
 * SPICE netlist I/O and the expression engine — public entry point.
 *
 *   parseSpice(text, opts?)        SPICE text -> Netlist IR (+ warnings, line-numbered errors)
 *   writeSpice(netlist, opts?)     Netlist IR -> SPICE text that parseSpice reads back equally
 *   flattenNetlist(netlist)        expand X instances, evaluate .param / {expr} values
 *   compileExpression(text, env)   fast closures with gradients w.r.t. V()/I() signals
 *
 * Module map: lexer.ts (lines/tokens), elements.ts (element cards), controls.ts (analysis and
 * control cards), parser.ts (driver), params.ts (.param/.func scopes), irfields.ts (stringParams
 * conventions), flatten.ts, writer.ts, numbers.ts (exact number text), expr.ts.
 */
export { parseSpice, type SpiceParseError, type SpiceParseOptions, type SpiceParseResult } from './parser';
export { writeSpice, type WriteSpiceOptions } from './writer';
export { FlattenError, flattenNetlist, flattenNetlistWithWarnings, type FlattenResult } from './flatten';
export {
  BUILTIN_CONSTANTS,
  ExprError,
  RUNTIME_VARIABLE_DEFAULTS,
  builtinFunctionNames,
  calledFunctions,
  compileExpression,
  evaluateExpression,
  formatExpression,
  freeIdentifiers,
  isBuiltinFunction,
  parseExpression,
  resolveExpression,
  signalKey,
  signalName,
  stripExpressionDelimiters,
  walkExpression,
  type CompiledExpression,
  type ExprNode,
  type ExprSignal,
  type ExprVariables,
  type ResolveEnv,
  type UserFunction,
} from './expr';
export {
  GLOBAL_NODES_KEY,
  ParamError,
  ParamScope,
  buildParamScope,
  globalNodeSet,
  isFuncKey,
  isReservedParamKey,
  makeFuncKey,
  parseFuncKey,
} from './params';
export { applyElementStringParams, cloneElement, distofKey, tranArgKey } from './irfields';
export { formatSpiceNumber, parseSpiceNumberExact } from './numbers';
