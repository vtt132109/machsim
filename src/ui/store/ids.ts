/**
 * Unique id generation for schematic objects.
 *
 * Ids only need to be unique inside one design; they combine a per-session counter with a short
 * random suffix so that fragments pasted between browser tabs do not collide.
 */
let counter = 0;

/** New id such as "w-1a-k3j9x" (prefix "w" for wires, "p" for parts, ...). */
export function newId(prefix: string): string {
  counter += 1;
  const rnd = Math.random().toString(36).slice(2, 7).padEnd(5, '0');
  return `${prefix}-${counter.toString(36)}-${rnd}`;
}
