/**
 * Deterministic size estimation.
 *
 * No tokenizer, no API call. A Resume must work offline from model APIs
 * (4AI), and a rough number a person can sanity-check by eye is more useful
 * here than an exact one that costs a network round trip.
 *
 * The ratio is documented rather than tuned: English prose averages close to
 * four characters per token across Claude's tokenizer, and Markdown structure
 * pushes it slightly lower because punctuation and newlines tokenize
 * individually. 3.7 is the working figure, and it is stated in the UI so nobody
 * mistakes it for a measurement.
 *
 * Deliberately never used to truncate. The estimate informs the user and offers
 * them a smaller density; silently dropping context to hit a number would be
 * the failure the brief calls out explicitly.
 */

export const CHARS_PER_TOKEN = 3.7;

export interface SizeEstimate {
  characters: number;
  words: number;
  approxTokens: number;
  /** How this reads to a person choosing a density. */
  band: 'normal' | 'moderate' | 'large' | 'very_large';
  /** The largest sections, biggest first, so a warning can name them. */
  bySection: Array<{ section: string; characters: number; share: number }>;
}

const BANDS: Array<[number, SizeEstimate['band']]> = [
  [4_000, 'normal'],
  [12_000, 'moderate'],
  [30_000, 'large'],
];

export function estimateResumeSize(
  markdown: string,
  sections: Array<{ section: string; markdown: string }> = [],
): SizeEstimate {
  const characters = markdown.length;
  const words = markdown.trim() === '' ? 0 : markdown.trim().split(/\s+/).length;
  const approxTokens = Math.ceil(characters / CHARS_PER_TOKEN);

  const band = BANDS.find(([limit]) => approxTokens <= limit)?.[1] ?? 'very_large';

  const bySection = sections
    .map((s) => ({
      section: s.section,
      characters: s.markdown.length,
      share: characters === 0 ? 0 : s.markdown.length / characters,
    }))
    .sort((a, b) => b.characters - a.characters);

  return { characters, words, approxTokens, band, bySection };
}

export const SIZE_BAND_LABELS: Record<SizeEstimate['band'], string> = {
  normal: 'Normal',
  moderate: 'Moderate',
  large: 'Large',
  very_large: 'Very large',
};

/**
 * What a person can do about a large export, in the order worth trying.
 *
 * Returned as suggestions rather than applied, and each one names the section
 * it would affect, so accepting it is an informed choice rather than a
 * shrug.
 */
export function reductionSuggestions(estimate: SizeEstimate, density: string): string[] {
  if (estimate.band === 'normal' || estimate.band === 'moderate') return [];

  const out: string[] = [];
  if (density === 'full_audit') out.push('Switch to Standard density — it keeps every current record and drops the deep history.');
  else if (density === 'standard') out.push('Switch to Compact — it keeps the current direction, the next action and the avoid list.');

  const biggest = estimate.bySection.slice(0, 3).filter((s) => s.share > 0.12);
  for (const s of biggest) {
    out.push(`“${s.section}” is ${Math.round(s.share * 100)}% of this export. Excluding it would remove ${s.characters.toLocaleString()} characters.`);
  }
  return out;
}
