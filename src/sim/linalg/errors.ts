/**
 * Errors raised by the sparse factorisations.
 *
 * Both extend the contract {@link SimulationError} so callers that only know the
 * contract still get a meaningful `code`:
 * - {@link SingularMatrixError} (code 'singular'): no usable pivot in a column;
 *   `unknown` is the index of the unknown (matrix column) that could not be solved for.
 * - {@link NonFiniteMatrixError} (code 'noconv'): the matrix contains NaN/Infinity,
 *   which in a Newton loop means the iterate diverged rather than a structural problem.
 */
import { SimulationError } from '../results';

/** Describes an unknown for diagnostics, e.g. `node 'out'` or `branch current of 'V1'`. */
export type UnknownDescriber = (index: number) => string;

export class SingularMatrixError extends SimulationError {
  readonly unknown: number;
  constructor(unknown: number, describe?: UnknownDescriber) {
    const what = describe ? describe(unknown) : `unknown #${unknown}`;
    super(`Singular matrix: no valid pivot for ${what}`, 'singular', what);
    this.name = 'SingularMatrixError';
    this.unknown = unknown;
  }
}

export class NonFiniteMatrixError extends SimulationError {
  readonly unknown: number;
  constructor(unknown: number, describe?: UnknownDescriber) {
    const what = describe ? describe(unknown) : `unknown #${unknown}`;
    super(`Non-finite value in the system matrix at ${what}`, 'noconv', what);
    this.name = 'NonFiniteMatrixError';
    this.unknown = unknown;
  }
}
