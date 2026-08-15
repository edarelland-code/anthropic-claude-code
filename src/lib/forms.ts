/**
 * The one thing that happens to every submitted form before anything reads it.
 *
 * HTML form submission normalises line breaks to CRLF. A user types `\n` into
 * a textarea, the browser sends `\r\n`, and what ContextShelf stores is not
 * what the user wrote. Nothing in the app does this — it is the platform — but
 * "nothing is ever destroyed" and "Layer 1 is verbatim evidence" are claims
 * about the stored bytes, and stored bytes that were never typed break both.
 *
 * It matters most where the product's promises are strictest:
 *
 *   * A captured source is Layer 1 evidence. Every provenance anchor, every
 *     duplicate fingerprint and every re-read of that source is computed
 *     against the stored copy.
 *   * A prompt body must survive verbatim — that is the whole point of storing
 *     it rather than describing it. A prompt carrying invisible carriage
 *     returns is not the prompt that was used, and pasting it into a terminal
 *     is where the user finds out.
 *
 * Undoing a transport artefact is not editing the user's content: `\r\n` here
 * is a fact about form encoding, not something anybody typed. Single-line
 * fields are unaffected — they contain no line breaks to normalise.
 */

/**
 * Rewrites CRLF to LF in every string field, in place, and returns the same
 * FormData so it can be used inline.
 *
 * Multi-valued keys keep their values and their order: the entry is rebuilt by
 * append rather than collapsed with `set`, which would silently discard all
 * but the last value of a repeated field.
 */
export function normaliseNewlines(formData: FormData): FormData {
  const keys = [...new Set([...formData.keys()])];

  for (const key of keys) {
    const values = formData.getAll(key);
    const needsWork = values.some((v) => typeof v === 'string' && v.includes('\r'));
    if (!needsWork) continue;

    formData.delete(key);
    for (const value of values) {
      formData.append(key, typeof value === 'string' ? value.replace(/\r\n/g, '\n') : value);
    }
  }

  return formData;
}
