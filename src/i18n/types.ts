/** Message catalogue types: every entry is a [Vietnamese, English] pair. */

export type Entry = readonly [vi: string, en: string];

/** A catalogue section: key -> [vi, en]. Keys are dotted, e.g. 'app.toolbar.zoomIn'. */
export type Catalogue = Record<string, Entry>;
