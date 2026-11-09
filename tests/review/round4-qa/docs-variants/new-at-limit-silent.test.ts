/**
 * QA round 4 (QD2): at the limit of open designs (16), File > "Thiết kế mới" (Ctrl+N) does NOTHING
 * and says nothing when the current tab is an untouched "Chưa đặt tên.msim".
 *
 * newDocument() (src/ui/app/document.ts) first asks confirmDiscardChanges(), which calls
 * documents.canOpen() with its default replace = true: an untouched start-up design "could be
 * replaced", so the limit dialog ("Đang mở quá nhiều thiết kế") is skipped. It then opens with
 * { replace: false }, and the manager refuses (null) because 16 tabs are open. In the app: open 16
 * designs with File > Thiết kế mới; the 17th click from the last (empty) tab changes nothing and no
 * message appears. From a tab with changes the same command shows the limit dialog.
 *
 * Expected: whenever New cannot add a tab, the pre-check says so (canOpen must agree with the
 * replace: false open that New performs).
 */
import { describe, expect, it } from 'vitest';
import { createEditor } from '../../../../src/ui/store/editorStore';
import { testLookup } from '../../../../src/ui/store/testParts';
import { newDesign } from '../../../../src/model/types';
import { createDocumentManager } from '../../../../src/ui/app/documents';

describe('QD2: File > New at the document limit from an untouched tab', () => {
  it('the pre-check used by New agrees with the open New performs', async () => {
    const editor = createEditor({ lookup: testLookup });
    const manager = createDocumentManager({ editor, blank: () => newDesign('Blank'), maxDocuments: 2 });
    // File > New twice: the second tab is an untouched "Untitled.msim", now the current one
    expect(await manager.open(newDesign('Blank 2'), 'Untitled.msim', { replace: false })).not.toBeNull();
    expect(manager.count()).toBe(2);
    // confirmDiscardChanges() asks canOpen() (replace defaults to true) and lets New go on ...
    const preCheck = manager.canOpen();
    // ... but New opens with replace: false, which the manager refuses at the limit
    const opened = await manager.open(newDesign('Blank 3'), 'Untitled.msim', { replace: false });
    expect(opened).toBeNull();
    // so the learner gets neither a new tab nor the "too many designs" message
    expect(preCheck).toBe(false);
  });
});
