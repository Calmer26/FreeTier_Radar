/**
 * Data for the "Help me choose" picker on the home page: per use, the ranked candidates
 * (with and without evaluation-only models), small enough to embed in the page. The
 * page's script filters them by the visitor's answers; the order is the rankings' own.
 */

import { toolStats } from "../../pipeline/agent-ready";
import { formatNeurons, imageCost } from "../../pipeline/cloudflare-pricing";
import { PROVIDERS } from "../../pipeline/providers";
import { rank, RANKINGS, RANKING_WINDOW_DAYS, type RankedModel } from "../../pipeline/rankings";
import { accuracyText, transcriptAccuracy } from "../../pipeline/wer";
import { activeModels, type ModelView } from "./data";
import { allFamilies } from "./families";

const familyOf = new Map(allFamilies.flatMap((f) => f.members.map((m) => [m.id, f] as const)));

export interface PickerUse {
  id: string;
  label: string;
  ranking: string;
}

export const PICKER_USES: PickerUse[] = [
  { id: "coding", label: "Coding (chat, editor or agent like Cline)", ranking: "coding" },
  { id: "app", label: "Text or chat in my app", ranking: "most-reliable" },
  { id: "vision", label: "Understanding images", ranking: "vision" },
  { id: "image", label: "Generating images", ranking: "image-generation" },
  { id: "tts", label: "Text to speech", ranking: "text-to-speech" },
  { id: "stt", label: "Speech to text (transcription)", ranking: "speech-to-text" },
];

export interface PickerCandidate {
  name: string;
  /** Same model at several providers: shown once, at the best place, with the others listed. */
  family: string;
  provider: string;
  href: string;
  why: string;
  eval: boolean;
  /** The provider says it logs prompts or may use them for training. */
  usesPrompts: boolean;
  /** Data use not stated by the provider. */
  dataUnknown: boolean;
  noSignup: boolean;
}

function why(x: RankedModel, use: string): string {
  const m = x.r as ModelView;
  const parts = [x.rel.tested ? `answered ${x.rel.responded} of ${x.rel.tested} tests` : "not tested enough yet"];
  if (use === "coding") {
    const t = toolStats(m.toolTests, RANKING_WINDOW_DAYS);
    if (t.tested) parts.push(`tool calls ${t.passed}/${t.tested}`);
    const b = m.arena?.boards.webdev ?? m.arena?.boards.text;
    if (b?.rating) parts.push(`LMArena ${m.arena?.boards.webdev ? "WebDev" : "Text"} ${Math.round(b.rating)}`);
  } else if (use === "app" || use === "vision") {
    const b = use === "vision" ? m.arena?.boards.vision : m.arena?.boards.text;
    if (b?.rating) parts.push(`LMArena ${use === "vision" ? "Vision" : "Text"} ${Math.round(b.rating)}`);
  } else if (use === "image") {
    if (m.arena?.boards.text_to_image?.rating) parts.push(`LMArena image ${Math.round(m.arena.boards.text_to_image.rating)}`);
    const c = m.pricing ? imageCost(m.pricing) : null;
    if (c?.neurons) parts.push(`${formatNeurons(c.neurons)} per image`);
  } else if (use === "stt") {
    const a = transcriptAccuracy(m.tests);
    if (a.mean != null) parts.push(`${accuracyText(a.mean)} of words right`);
  }
  if (x.rel.medianLatencyMs != null && use !== "image") parts.push(`${(x.rel.medianLatencyMs / 1000).toFixed(1)} s`);
  return parts.join(" · ");
}

const inputs = activeModels.map((m) => ({ r: m, history: m.tests, tools: m.toolTests, arena: m.arena }));

const candidate = (x: RankedModel, use: string): PickerCandidate => {
  const m = x.r as ModelView;
  return {
    name: familyOf.get(m.id)?.name ?? m.name.replace(/\s*\(free\)$/i, ""),
    family: familyOf.get(m.id)?.key ?? m.id,
    provider: PROVIDERS[m.provider].label.split(" (")[0],
    href: m.href,
    why: why(x, use),
    eval: m.usage_terms === "evaluation-only",
    usesPrompts: m.data_logging === "may-train" || m.data_logging === "logs-prompts",
    dataUnknown: m.data_logging === "unknown",
    noSignup: m.account_required === "no",
  };
};

/** Never recommend a model that was tested but hasn't answered once (a ranking may still list it). */
const works = (x: RankedModel) => !(x.rel.tested > 0 && x.rel.responded === 0);

/** use id → { production: candidates, experiment: candidates incl. evaluation-only }. */
export const pickerData = Object.fromEntries(
  PICKER_USES.map((u) => {
    const def = RANKINGS.find((r) => r.slug === u.ranking)!;
    return [u.id, {
      ranking: `/rankings/${u.ranking}/`,
      production: rank(def, inputs, 15).filter(works).map((x) => candidate(x, u.id)),
      experiment: rank(def, inputs, 15, { allowEval: true }).filter(works).map((x) => candidate(x, u.id)),
    }];
  }),
);
