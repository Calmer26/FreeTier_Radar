/**
 * What kind of model a listed id is: chat, text-to-speech, speech-to-text, or
 * something the directory doesn't cover yet (null).
 *
 * Ported from solo_developer's model-rotation `candidates.ts` and
 * `speech-discovery.ts` (2026-09-28). Providers list many models that are not chat
 * models; speech models get their own tabs and tests, and the rest (image
 * generation, embeddings, safety classifiers, reward models…) are left out until
 * they get categories of their own.
 *
 * Classifying at fetch time is safe: a model id never moves between kinds, so a
 * model left out can never look "removed".
 */

import type { ModelKind } from "./types";

const TTS_PATTERNS = ["-tts", "orpheus", "playai", "flux-tts", "fish-audio"];
const STT_PATTERNS = ["whisper", "transcribe"];

/** Not covered yet: matched case-insensitively anywhere in the id. */
export const UNCOVERED_PATTERNS = [
  "-image", "robotics", "lyria", "deep-research",
  "computer-use", "antigravity", "nano-banana", "video-understanding",
  "-eap", "embedding",
  // Tool-calling variant of a model already listed under its base id; LoRA adapters.
  "customtools", "-lora",
  // Groq: safety classifiers, and the compound systems (which run their own tools).
  "guard", "compound",
  // NVIDIA: retrieval and task models mixed into the catalogue. Code-only families
  // are named explicitly; "code" alone would also drop general models like qwen3-coder.
  "embed", "safety", "reward", "parse", "nvclip", "deplot", "kosmos", "detector",
  "calibration", "starcoder", "codellama", "codegemma", "codestral", "-code-instruct",
  "deepseek-coder",
];

export function classifyModel(modelId: string): ModelKind | null {
  const id = modelId.toLowerCase();
  if (TTS_PATTERNS.some((p) => id.includes(p))) return "tts";
  if (STT_PATTERNS.some((p) => id.includes(p))) return "stt";
  if (UNCOVERED_PATTERNS.some((p) => id.includes(p))) return null;
  return "chat";
}
