/**
 * Showcase run (daily, GitHub Actions): make today's share of the missing showcase
 * images (see showcase.ts), save them as 768 px JPEGs in public/showcase/, and record
 * them in data/showcase.json. Does nothing, and commits nothing, once all exist.
 *
 * Cloudflare Workers AI only for now (the one free image source). Stops early when the
 * account's daily Neurons run out; the rest waits for tomorrow.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { fetchCloudflarePricing, imageCost } from "./cloudflare-pricing";
import { planShowcase, showcaseKey, SHOWCASE_PROMPTS, type ShowcaseFile } from "./showcase";
import { DATA_DIR, readResources } from "./store";

const SHOWCASE_FILE = join(DATA_DIR, "showcase.json");
const PUBLIC_DIR = join(process.cwd(), "public", "showcase");
const SIZE = 768;

async function generate(modelId: string, prompt: string, env: Record<string, string | undefined>): Promise<Buffer> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${modelId}`;
  const auth = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` };
  // Each model at its own defaults (steps, guidance); FLUX.2 takes a form and an explicit size.
  let init: RequestInit;
  if (modelId.includes("flux-2")) {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("width", "1024");
    form.append("height", "1024");
    init = { method: "POST", headers: auth, body: form };
  } else {
    init = { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) };
  }
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("image/")) return Buffer.from(await res.arrayBuffer());
  const json = (await res.json()) as { success?: boolean; errors?: Array<{ message: string }>; result?: { image?: string } };
  if (!res.ok || json.success === false || !json.result?.image) {
    throw new Error(json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}, no image`);
  }
  return Buffer.from(json.result.image, "base64");
}

async function main() {
  const env = process.env;
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    console.log("Cloudflare credentials not set; nothing to do.");
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const existing: ShowcaseFile = existsSync(SHOWCASE_FILE) ? JSON.parse(readFileSync(SHOWCASE_FILE, "utf8")) : { images: {} };
  const pricing = await fetchCloudflarePricing().catch(() => new Map());

  const models = readResources()
    .filter((r) => r.provider === "cloudflare" && r.kind === "image" && r.status === "active")
    .map((r) => {
      const lines = r.pricing ?? pricing.get(r.model_id) ?? null;
      return { r, id: r.id, neurons: lines ? imageCost(lines)?.neurons ?? null : null };
    });

  const plan = planShowcase(models, existing);
  if (plan.length === 0) {
    console.log("All showcase images exist.");
    return;
  }
  console.log(`Planned ${plan.length} image(s), ≈ ${Math.round(plan.reduce((s, p) => s + p.neurons, 0))} Neurons.`);

  let made = 0;
  for (const item of plan) {
    const m = models.find((x) => x.id === item.resourceId)!;
    const prompt = SHOWCASE_PROMPTS.find((p) => p.id === item.promptId)!;
    const started = Date.now();
    try {
      const raw = await generate(m.r.model_id, prompt.prompt, env);
      const jpg = await sharp(raw).resize(SIZE, SIZE, { fit: "inside" }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      const rel = `showcase/${m.r.provider}/${m.r.slug}/${prompt.id}.jpg`;
      mkdirSync(join(PUBLIC_DIR, m.r.provider, m.r.slug), { recursive: true });
      writeFileSync(join(process.cwd(), "public", rel), jpg);
      existing.images[showcaseKey(m.id, prompt.id)] = {
        file: `/${rel}`,
        generated_on: today,
        neurons: item.neurons ? Math.round(item.neurons) : null,
        ms: Date.now() - started,
      };
      made++;
      console.log(`  ✓ ${m.r.model_id} / ${prompt.id}: ${Math.round(jpg.length / 1024)} KB, ${Date.now() - started} ms`);
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      console.error(`  ✗ ${m.r.model_id} / ${prompt.id}: ${message.slice(0, 200)}`);
      if (/daily free allocation/.test(message)) {
        console.log("Daily Neurons used up; the rest waits for tomorrow.");
        break;
      }
    }
  }

  if (made) {
    const sorted = Object.fromEntries(Object.entries(existing.images).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(SHOWCASE_FILE, `${JSON.stringify({ images: sorted }, null, 2)}\n`);
  }
  console.log(`Made ${made} image(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
