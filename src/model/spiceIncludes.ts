/**
 * `.include` / `.lib` resolution for SPICE decks (import, run, command-line batch runs).
 *
 *   const r = await resolveDeckIncludes(text, fetch, { fileName });
 *   r.result    the final parseSpice result (includes inlined through resolveInclude)
 *   r.files     path -> text of every file read
 *   r.missing   include paths no fetch could provide
 *
 * parseSpice asks for each included path (first next to the including file, then as written);
 * this loop records the requests, fetches what is missing (desktop: next to the deck through the
 * bridge; browser: the user picks the file; CLI: the main process reads it) and parses again until
 * nothing new is asked for.
 */
import { parseSpice, type SpiceParseResult } from '../sim/spice';

export type DeckFetcher = (path: string) => Promise<string | null>;

export interface ResolvedDeck {
  result: SpiceParseResult;
  files: Map<string, string>;
  missing: string[];
}

/** Path spelling used as the file-map key ("lib\\a.LIB" -> "lib/a.lib"). */
export function includeKey(path: string): string {
  return path.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

export async function resolveDeckIncludes(text: string, fetch: DeckFetcher, opts: { fileName?: string; known?: ReadonlyMap<string, string>; maxRounds?: number } = {}): Promise<ResolvedDeck> {
  const files = new Map<string, string>();
  for (const [k, v] of opts.known ?? []) files.set(includeKey(k), v);
  const failed = new Set<string>();
  let result: SpiceParseResult = { netlist: parseSpice('').netlist, warnings: [], errors: [] };
  for (let round = 0; round < (opts.maxRounds ?? 16); round++) {
    const asked: string[] = [];
    result = parseSpice(text, {
      fileName: opts.fileName,
      resolveInclude: (path) => {
        const k = includeKey(path);
        const hit = files.get(k);
        if (hit === undefined && !asked.includes(path)) asked.push(path);
        return hit;
      },
    });
    // a path is only worth fetching when no spelling of it is known yet
    const todo = asked.filter((p) => !failed.has(includeKey(p)) && !files.has(includeKey(p)));
    if (!todo.length) break;
    let fetched = false;
    for (const p of todo) {
      const content = await fetch(p);
      if (content === null) failed.add(includeKey(p));
      else {
        files.set(includeKey(p), content);
        fetched = true;
      }
    }
    if (!fetched) break;
  }
  // an include counts as missing when every spelling the parser tried failed
  const missing = [...failed].filter((k) => !files.has(k));
  const byBase = new Map<string, string>();
  for (const k of missing) {
    const base = k.split('/').pop() ?? k;
    if (![...files.keys()].some((f) => f.endsWith(`/${base}`) || f === base)) byBase.set(base, k);
  }
  return { result, files, missing: [...byBase.values()] };
}
