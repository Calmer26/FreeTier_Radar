/**
 * Voice samples run (daily, with the image showcase): make the missing samples (see
 * voices.ts), save them as small MP3s in public/voices/, and record them in
 * data/voices.json. Does nothing, and commits nothing, once all exist.
 *
 * Requests are built by the daily test's buildRequest, with a sentence instead of "OK",
 * so every provider is called exactly the way its test already proves works.
 * ffmpeg (installed in the workflow) turns every format into mono 64 kbit/s MP3; without
 * it, MP3 is kept as is and anything else is stored as WAV.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRequest, ttsVoice } from "./probe";
import { DATA_DIR, readResources, readTests } from "./store";
import { audioFromBody, planVoices, sniffAudio, voiceKey, VOICE_SENTENCES, type VoicesFile } from "./voices";

const VOICES_FILE = join(DATA_DIR, "voices.json");
const PUBLIC_DIR = join(process.cwd(), "public");
const GAP_MS = 3_000;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** MP3 bytes when ffmpeg is there (or the audio already is MP3); otherwise the audio as WAV/other. */
function toStoredAudio(audio: Uint8Array): { bytes: Uint8Array; ext: string } {
  const format = sniffAudio(audio);
  if (!hasFfmpeg) return { bytes: audio, ext: format === "unknown" ? "mp3" : format };
  const dir = mkdtempSync(join(tmpdir(), "voice-"));
  try {
    const input = join(dir, `in.${format === "unknown" ? "bin" : format}`);
    const output = join(dir, "out.mp3");
    writeFileSync(input, audio);
    const run = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", input, "-ac", "1", "-b:a", "64k", output]);
    if (run.status !== 0) throw new Error(`ffmpeg: ${run.stderr.toString().slice(0, 200)}`);
    return { bytes: readFileSync(output), ext: "mp3" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const env = process.env;
  const today = new Date().toISOString().slice(0, 10);
  const existing: VoicesFile = existsSync(VOICES_FILE) ? JSON.parse(readFileSync(VOICES_FILE, "utf8")) : { samples: {} };
  const tests = readTests();
  // Non-commercial free plans (ElevenLabs) don't allow publishing their output on a sponsored site.
  const models = readResources().filter((r) => r.kind === "tts" && r.status === "active" && r.usage_terms !== "non-commercial");
  const plan = planVoices(
    models.map((r) => ({ id: r.id, model_id: r.model_id, lastStatus: tests.results[r.id]?.at(-1)?.status ?? null })),
    existing,
  );
  if (plan.length === 0) {
    console.log("All voice samples exist.");
    return;
  }
  console.log(`Planned ${plan.length} sample(s); ffmpeg ${hasFfmpeg ? "found" : "not found (keeping original formats)"}.`);

  let made = 0;
  for (const item of plan) {
    const r = models.find((m) => m.id === item.resourceId)!;
    const sentence = VOICE_SENTENCES.find((s) => s.id === item.sentenceId)!;
    const started = Date.now();
    try {
      const { url, init } = buildRequest(r, env, sentence.text);
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
      const body = new Uint8Array(await res.arrayBuffer());
      if (!res.ok) throw new Error(`HTTP ${res.status} ${new TextDecoder().decode(body.slice(0, 200))}`);
      const audio = audioFromBody(res.headers.get("content-type") ?? "", body);
      if (audio.length < 2_000) throw new Error(`audio too small (${audio.length} bytes)`);
      const { bytes, ext } = toStoredAudio(audio);
      const rel = `voices/${r.provider}/${r.slug}/${sentence.id}.${ext}`;
      mkdirSync(join(PUBLIC_DIR, "voices", r.provider, r.slug), { recursive: true });
      writeFileSync(join(PUBLIC_DIR, rel), bytes);
      existing.samples[voiceKey(r.id, sentence.id)] = { file: `/${rel}`, generated_on: today, voice: ttsVoice(r) ?? null, ms: Date.now() - started };
      made++;
      console.log(`  ✓ ${r.provider} ${r.model_id} / ${sentence.id}: ${Math.round(bytes.length / 1024)} KB ${ext}, ${Date.now() - started} ms`);
    } catch (err) {
      console.error(`  ✗ ${r.provider} ${r.model_id} / ${sentence.id}: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    }
    await sleep(GAP_MS);
  }

  if (made) {
    const sorted = Object.fromEntries(Object.entries(existing.samples).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(VOICES_FILE, `${JSON.stringify({ samples: sorted }, null, 2)}\n`);
  }
  console.log(`Made ${made} sample(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
