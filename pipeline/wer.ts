/**
 * Word error rate for the speech-to-text test: how far a model's transcript of our
 * 18-second clip (fixtures/stt-sample.mp3) is from its script. Only this number is
 * stored, never the transcript. Pure.
 */

/** The clip's script (fixtures/README.md). */
export const STT_REFERENCE =
  "Olympus Mons is the largest volcano in the solar system. It rises far above the dusty plains of Mars, and its base would cover most of Poland. If you stood at its edge, you could not see the summit, because the slope is so gentle that the horizon hides it. Follow for more space facts.";

/** Lowercase words without punctuation, so "edge," and "Edge" match. Exported for tests. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** (substitutions + deletions + insertions) / reference words, by word-level edit distance. */
export function wordErrorRate(hypothesis: string, reference = STT_REFERENCE): number {
  const ref = words(reference);
  const hyp = words(hypothesis);
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return ref.length ? prev[hyp.length] / ref.length : 0;
}

export interface TranscriptAccuracy {
  /** Word error rate of the latest scored test. */
  latest: number | null;
  /** Mean word error rate over the scored tests in the window. */
  mean: number | null;
  scored: number;
}

/** Accuracy over the last `window` scored tests (older results have no score). */
export function transcriptAccuracy(history: Array<{ wer?: number }>, window = 7): TranscriptAccuracy {
  const scored = history.filter((t) => typeof t.wer === "number").slice(-window).map((t) => t.wer!);
  return {
    latest: scored.at(-1) ?? null,
    mean: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null,
    scored: scored.length,
  };
}

/** "98% of words right" from a word error rate (can't go below 0). */
export const accuracyText = (wer: number) => `${Math.max(0, Math.round((1 - wer) * 100))}%`;
