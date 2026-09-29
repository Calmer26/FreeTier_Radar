/**
 * Voice samples: every free text-to-speech model reads the same three sentences, so
 * visitors can hear differences no benchmark covers (LMArena has no speech board).
 *
 * Each sentence targets something that separates models: natural tone, reading
 * numbers/dates/abbreviations, and intonation. Samples are made once per model (and
 * when a new model appears). Pure planning and audio handling here; the calls live
 * in run-voices.ts.
 */

export interface VoiceSentence {
  id: string;
  title: string;
  text: string;
  /** What to listen for, shown with the samples. */
  listen_for: string;
}

export const VOICE_SENTENCES: VoiceSentence[] = [
  {
    id: "plain",
    title: "Natural reading",
    text: "Welcome to FreeTier Radar. Every morning we test the free AI models, so you can see which ones actually work.",
    listen_for: "Does it sound like a person reading, or like a machine? Listen for flat tone, odd pauses and robotic endings.",
  },
  {
    id: "numbers",
    title: "Numbers, dates and abbreviations",
    text: "On 3 Oct 2026, Dr. Nguyen paid $1,250 for 2 GPUs at 9:45 a.m., a 15% discount.",
    listen_for: "\"3 Oct 2026\", \"Dr.\", \"$1,250\", \"GPUs\", \"9:45 a.m.\" and \"15%\": weaker models spell them out letter by letter or skip them.",
  },
  {
    id: "question",
    title: "Question and emotion",
    text: "Wait, the model you relied on yesterday is gone today? That's exactly why we check every single morning!",
    listen_for: "Does the voice rise on the question and sound surprised, then emphatic? Many models read it all in one tone.",
  },
];

export interface VoiceSample {
  file: string;
  generated_on: string;
  voice: string | null;
  ms: number;
}

export interface VoicesFile {
  /** "<resource id>|<sentence id>" → sample. */
  samples: Record<string, VoiceSample>;
}

export const voiceKey = (resourceId: string, sentenceId: string) => `${resourceId}|${sentenceId}`;

/** Models whose voice isn't English would read these sentences badly; left out. */
export const NON_ENGLISH = /arabic|saudi|chinese|japanese|korean|spanish|french|german|hindi/i;

/**
 * Samples to make: missing ones for models that answered their latest test and speak
 * English, sentence by sentence so a comparison row completes first. Pure.
 */
export function planVoices(
  models: Array<{ id: string; model_id: string; lastStatus: string | null }>,
  existing: VoicesFile,
): Array<{ resourceId: string; sentenceId: string }> {
  const ok = models.filter((m) => (m.lastStatus === "responded" || m.lastStatus === "slow") && !NON_ENGLISH.test(m.model_id));
  return VOICE_SENTENCES.flatMap((s) =>
    ok.filter((m) => !existing.samples[voiceKey(m.id, s.id)]).map((m) => ({ resourceId: m.id, sentenceId: s.id })),
  );
}

export type AudioFormat = "mp3" | "wav" | "ogg" | "flac" | "unknown";

/** What kind of audio these bytes are, from their first bytes. Exported for tests. */
export function sniffAudio(b: Uint8Array): AudioFormat {
  const ascii = (from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav";
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(0, 4) === "fLaC") return "flac";
  return "unknown";
}

/** Raw 16-bit little-endian mono PCM (Gemini's speech output) wrapped as a WAV file. Exported for tests. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => [...s].forEach((c, i) => header.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + pcm.length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  header.setUint32(16, 16, true); // fmt chunk size
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true); // byte rate
  header.setUint16(32, 2, true); // block align
  header.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  header.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(pcm, 44);
  return out;
}

/**
 * The audio in a TTS response body: raw audio, or base64 inside JSON (Mistral's
 * `audio_data`, Cloudflare's `audio`, Gemini's `inlineData` with raw PCM). Exported for tests.
 */
export function audioFromBody(contentType: string, body: Uint8Array): Uint8Array {
  if (!contentType.includes("json")) return body;
  const json = JSON.parse(new TextDecoder().decode(body)) as {
    audio_data?: string;
    audio?: string;
    result?: { audio?: string };
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };
  const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
  if (json.audio_data) return b64(json.audio_data);
  const cf = json.result?.audio ?? json.audio;
  if (cf) return b64(cf);
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (inline?.data) {
    const pcm = b64(inline.data);
    const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? 24_000);
    return /l16|pcm/i.test(inline.mimeType ?? "") ? pcmToWav(pcm, rate) : pcm;
  }
  throw new Error("no audio in response");
}
