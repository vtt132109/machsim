/**
 * `.step` cards inside a block of SPICE text that is NOT a whole deck (the custom SPICE text of a
 * schematic): finding them and blanking them out.
 *
 * A schematic does not run its SPICE text as a deck: the text only adds elements, models and
 * `.param`s to the circuit, and a `.step` card is applied to the analysis that is about to run
 * (src/model/steps.ts). The netlister therefore blanks the cards before the text is parsed, with
 * their lines kept as comments so error messages still name the right line numbers.
 */

/** `.step` cards of a text (one logical line each, `+` continuation lines joined). */
export function stepCards(text: string | undefined): string[] {
  const out: string[] = [];
  let open = false;
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('+') && open) {
      out[out.length - 1] += ` ${line.slice(1).trim()}`;
      continue;
    }
    open = /^\.step\b/i.test(line);
    if (open) out.push(line);
  }
  return out;
}

/** The text with every `.step` card (and its continuation lines) replaced by a comment line. */
export function blankStepCards(text: string): string {
  let open = false;
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (line.startsWith('+') && open) return '*';
      open = /^\.step\b/i.test(line);
      return open ? '*' : raw;
    })
    .join('\n');
}
