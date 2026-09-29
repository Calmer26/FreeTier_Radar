import { describe, expect, it } from "vitest";
import { audioFromBody, pcmToWav, planVoices, sniffAudio, voiceKey } from "./voices";

const enc = (s: string) => new TextEncoder().encode(s);

describe("planVoices", () => {
  it("plans missing samples for working English voices, sentence by sentence", () => {
    const plan = planVoices(
      [
        { id: "a", model_id: "orpheus-v1-english", lastStatus: "responded" },
        { id: "b", model_id: "orpheus-arabic-saudi", lastStatus: "responded" },
        { id: "c", model_id: "paid-tts", lastStatus: "no_free_quota" },
        { id: "d", model_id: "melotts", lastStatus: "slow" },
      ],
      { samples: { [voiceKey("a", "plain")]: { file: "x", generated_on: "2026-09-29", voice: null, ms: 1 } } },
    );
    expect(plan.map((p) => `${p.resourceId}:${p.sentenceId}`)).toEqual(["d:plain", "a:numbers", "d:numbers", "a:question", "d:question"]);
  });
});

describe("audio", () => {
  it("recognises formats from their first bytes", () => {
    expect(sniffAudio(enc("ID3\u0004rest"))).toBe("mp3");
    expect(sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0]))).toBe("mp3");
    expect(sniffAudio(enc("OggS...."))).toBe("ogg");
    expect(sniffAudio(pcmToWav(new Uint8Array(10), 24_000))).toBe("wav");
  });

  it("wraps PCM in a 44-byte WAV header with the right sizes", () => {
    const wav = pcmToWav(new Uint8Array(100), 24_000);
    const v = new DataView(wav.buffer);
    expect(wav.length).toBe(144);
    expect(v.getUint32(24, true)).toBe(24_000);
    expect(v.getUint32(40, true)).toBe(100);
  });

  it("finds the audio in raw and JSON responses", () => {
    const b64 = Buffer.from("ID3audio").toString("base64");
    expect(new TextDecoder().decode(audioFromBody("audio/mpeg", enc("ID3raw")))).toBe("ID3raw");
    expect(new TextDecoder().decode(audioFromBody("application/json", enc(JSON.stringify({ audio_data: b64 }))))).toBe("ID3audio");
    expect(new TextDecoder().decode(audioFromBody("application/json", enc(JSON.stringify({ result: { audio: b64 } }))))).toBe("ID3audio");
    const gemini = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.from([1, 2]).toString("base64") } }] } }] };
    expect(sniffAudio(audioFromBody("application/json", enc(JSON.stringify(gemini))))).toBe("wav");
    expect(() => audioFromBody("application/json", enc("{}"))).toThrow("no audio");
  });
});
