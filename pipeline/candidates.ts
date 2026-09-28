/**
 * Which listed models count as general text/vision chat models for Phase 1.
 *
 * Ported from solo_developer's model-rotation `candidates.ts` (2026-09-28). Providers
 * list many models that are not chat models: image generation, TTS, speech-to-text,
 * embedders, safety classifiers, reward models. Those belong to later categories
 * (Phase 2) and are left out of the directory for now.
 *
 * Filtering at fetch time is safe here: a model id never moves between categories,
 * so a filtered-out model can never look "removed".
 */

export const NON_CHAT_PATTERNS = [
  "-image", "-tts", "robotics", "lyria", "deep-research",
  "computer-use", "antigravity", "nano-banana", "video-understanding",
  "-eap", "embedding",
  // Tool-calling variant of a model already listed under its base id.
  "customtools",
  "transcribe",
  // Groq: speech-to-text, TTS, safety classifiers, and the compound systems.
  "whisper", "orpheus", "playai", "guard", "compound",
  // NVIDIA: retrieval and task models mixed into the catalogue. Code-only families
  // are named explicitly; "code" alone would also drop general models like qwen3-coder.
  "embed", "safety", "reward", "parse", "nvclip", "deplot", "kosmos", "detector",
  "calibration", "starcoder", "codellama", "codegemma", "codestral", "-code-instruct",
  "deepseek-coder",
];

export function isChatModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return !NON_CHAT_PATTERNS.some((p) => id.includes(p));
}
