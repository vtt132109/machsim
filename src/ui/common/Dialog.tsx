/**
 * Modal dialog frame: backdrop, title bar, body and footer; Esc / close button dismiss, Tab is
 * trapped inside, focus moves into the dialog on open and returns to the previous element on close.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './icons';
import './common.css';
import { t } from '../../i18n';
import type { GuidePageId } from '../../i18n/helpGuides';

let helpOpener: ((page: GuidePageId) => void) | null = null;

/**
 * The help browser registers itself here (src/ui/help/open.ts), so a dialog can offer its guide page
 * (`guide` prop) without importing the help module: the common frame stays free of the help text.
 */
export function setDialogHelpOpener(opener: ((page: GuidePageId) => void) | null): void {
  helpOpener = opener;
}

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** CSS width (default 420px) */
  width?: number | string;
  /** element to focus first (selector inside the dialog) */
  initialFocus?: string;
  className?: string;
  /** guide page of the help browser that explains this dialog: shows a "?" button and answers F1 */
  guide?: GuidePageId;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ title, onClose, children, footer, width = 420, initialFocus, className, guide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (root) {
      // explicit target, then [data-autofocus], then the first control of the body / footer, then the close button
      const target =
        (initialFocus && root.querySelector<HTMLElement>(initialFocus)) ||
        root.querySelector<HTMLElement>('[data-autofocus]') ||
        root.querySelector<HTMLElement>(`.ms-dialog-body :is(${FOCUSABLE})`) ||
        root.querySelector<HTMLElement>(`.ms-dialog-footer :is(${FOCUSABLE})`) ||
        root.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? root).focus();
      if (target instanceof HTMLInputElement) target.select();
    }
    return () => {
      if (prev && document.contains(prev)) prev.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'F1' && guide) {
      e.preventDefault();
      helpOpener?.(guide);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeRef.current();
      return;
    }
    if (e.key === 'Tab' && ref.current) {
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div className="ms-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div
        ref={ref}
        className={`ms-dialog ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width }}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="ms-dialog-title">
          <h2 id={titleId}>{title}</h2>
          {guide ? (
            <button type="button" className="ms-icon-btn ms-dialog-help" aria-label={t('common.helpDialog')} title={t('common.helpDialog')} onClick={() => helpOpener?.(guide)}>
              ?
            </button>
          ) : null}
          <button type="button" className="ms-icon-btn" aria-label={t('common.close')} onClick={() => closeRef.current()}>
            <Icon name="close" />
          </button>
        </div>
        <div className="ms-dialog-body">{children}</div>
        {footer ? <div className="ms-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
