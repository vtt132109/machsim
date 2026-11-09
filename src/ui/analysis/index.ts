/**
 * Analysis setup public API: the setup dialog, its forms, and the pure spec helpers
 * (catalog, defaults, validation, summaries, SimOptions metadata).
 */

export { AnalysisSetupDialog, OptionsForm, OutputSelector } from './AnalysisSetupDialog';
export type { AnalysisSetupDialogProps } from './AnalysisSetupDialog';
export { SpecForm, cloneSpec } from './forms';
export type { FormContext, SpecFormProps } from './forms';
export { CheckField, Group, ListField, NumField, SelectField, TextField, parseFieldText, parseNumberList } from './fields';
export { canRun, canSave, cleanOptions, draftIssues, ensureSpec, initialDraft, issueCounts } from './dialogModel';
export type { DraftIssues, SpecMap } from './dialogModel';
export * from './specs';
