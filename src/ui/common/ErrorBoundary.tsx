/**
 * Error boundary for extension-provided content (dock tabs, floating windows): a failing panel
 * shows its error and a retry button instead of taking the whole application down.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../../i18n';

export interface ErrorBoundaryProps {
  /** what failed, e.g. "Oscilloscope panel" */
  label: string;
  children: ReactNode;
  /** reset the boundary when this value changes (e.g. the tab id) */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.label} failed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="ms-error-panel" role="alert">
        <strong>{t('common.errorBoundary.labelFailed', { label: this.props.label })}</strong>
        <pre>{this.state.error.message}</pre>
        <button type="button" className="ms-btn ms-btn-small" onClick={() => this.setState({ error: null })}>
          {t('common.errorBoundary.retry')}
        </button>
      </div>
    );
  }
}
