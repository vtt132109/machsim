/**
 * Linear algebra for the circuit engine: sparse MNA storage, fill-reducing ordering,
 * real/complex sparse LU with partial pivoting and symbolic reuse, dense LU helpers.
 */
export {
  MatrixPattern,
  SparseMatrix,
  ComplexSparseMatrix,
  buildCsc,
  growFloat64,
  growInt32,
  type CscStructure,
} from './pattern';
export { minimumDegreeOrdering } from './ordering';
export { SparseLU } from './sparse-lu';
export { ComplexSparseLU, type ComplexVector } from './complex-lu';
export { DenseLU, DenseComplexLU } from './dense';
export { SingularMatrixError, NonFiniteMatrixError, type UnknownDescriber } from './errors';
