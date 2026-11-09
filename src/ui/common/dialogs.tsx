/**
 * Promise-based standard dialogs (prompt, confirm, choice, alert) and custom modal dialogs.
 *
 *   const name = await promptText({ title: 'Net label', label: 'Name', initial: 'N1' });
 *   if (await confirmDialog({ title: 'Delete sheet', message: '...' })) ...
 *   const close = openCustomDialog((close) => <MyDialog onClose={close} />);
 *
 * Mount <DialogHost /> once (the app shell does). Dialogs stack; the newest is on top.
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { createStore } from '../store/createStore';
import { Dialog } from './Dialog';
import { t } from '../../i18n';

interface Entry {
  id: number;
  render: (close: () => void) => ReactNode;
  onDismiss: () => void;
}

const stack = createStore<Entry[]>([]);
let seq = 0;

function push(render: (close: () => void) => ReactNode, onDismiss: () => void): () => void {
  seq += 1;
  const id = seq;
  const close = () => stack.setState((s) => s.filter((e) => e.id !== id));
  stack.setState((s) => [...s, { id, render: () => render(close), onDismiss }]);
  return close;
}

/** Open a custom modal. `render` receives a `close` callback; returns the same callback. */
export function openCustomDialog(render: (close: () => void) => ReactNode): () => void {
  let closeFn: () => void = () => undefined;
  closeFn = push((close) => render(close), () => closeFn());
  return closeFn;
}

/** True when any modal dialog is open (global shortcuts are suspended). */
export function isDialogOpen(): boolean {
  return stack.getState().length > 0;
}

export interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  okLabel?: string;
  multiline?: boolean;
  /** return an error message to block OK */
  validate?: (value: string) => string | null;
}

function PromptBody({ opts, done }: { opts: PromptOptions; done: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? '');
  const error = opts.validate ? opts.validate(value) : null;
  const submit = () => {
    if (!error) done(value);
  };
  return (
    <Dialog
      title={opts.title}
      onClose={() => done(null)}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={() => done(null)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={!!error} onClick={submit}>
            {opts.okLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <form
        className="ms-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="ms-field">
          <span>{opts.label}</span>
          {opts.multiline ? (
            <textarea
              data-autofocus
              rows={5}
              value={value}
              placeholder={opts.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          ) : (
            <input data-autofocus value={value} placeholder={opts.placeholder} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
          )}
        </label>
        {error ? (
          <div className="ms-field-error" role="alert">
            {error}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Ask for a line (or block) of text. Resolves null when cancelled. */
export function promptText(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let close: () => void = () => undefined;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      close();
      resolve(v);
    };
    close = push(() => <PromptBody opts={opts} done={done} />, () => done(null));
  });
}

export interface ChoiceOption {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

/** Show a message with several buttons; resolves the chosen id or null when dismissed. */
export function choiceDialog(opts: { title: string; message: ReactNode; choices: ChoiceOption[]; width?: number }): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let close: () => void = () => undefined;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      close();
      resolve(v);
    };
    close = push(
      () => (
        <Dialog
          title={opts.title}
          width={opts.width}
          onClose={() => done(null)}
          footer={opts.choices.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`ms-btn ${c.primary ? 'ms-btn-primary' : ''} ${c.danger ? 'ms-btn-danger' : ''}`}
              data-autofocus={c.primary ? true : undefined}
              onClick={() => done(c.id)}
            >
              {c.label}
            </button>
          ))}
        >
          <div className="ms-dialog-message">{opts.message}</div>
        </Dialog>
      ),
      () => done(null),
    );
  });
}

/** OK / Cancel confirmation. */
export async function confirmDialog(opts: { title: string; message: ReactNode; okLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  const r = await choiceDialog({
    title: opts.title,
    message: opts.message,
    choices: [
      { id: 'cancel', label: opts.cancelLabel ?? t('common.cancel') },
      { id: 'ok', label: opts.okLabel ?? 'OK', primary: !opts.danger, danger: opts.danger },
    ],
  });
  return r === 'ok';
}

/** Information / error message with a single OK button. */
export async function alertDialog(opts: { title: string; message: ReactNode }): Promise<void> {
  await choiceDialog({ title: opts.title, message: opts.message, choices: [{ id: 'ok', label: 'OK', primary: true }] });
}

/** Renders the dialog stack; mount once near the root. */
export function DialogHost() {
  const entries = useSyncExternalStore(stack.subscribe, stack.getState, stack.getState);
  return (
    <>
      {entries.map((e) => (
        <div key={e.id} className="ms-dialog-layer">
          {e.render(() => e.onDismiss())}
        </div>
      ))}
    </>
  );
}
