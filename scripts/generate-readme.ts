/**
 * Regenerates the auto-updated list in README.md between the LIST markers, from
 * data/. Run after discovery and after the daily tests; writes only on change.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentReadiness } from "../pipeline/agent-ready";
import { PROVIDER_IDS, PROVIDERS } from "../pipeline/providers";
import { readResources, readTests } from "../pipeline/store";
import { isUnreachable } from "../pipeline/reachability";
import { formatContext, KIND_LABELS } from "../pipeline/templates";
import { MODEL_KINDS, type Resource } from "../pipeline/types";
import { SITE } from "../site.config";

const START = "<!-- LIST:START -->";
const END = "<!-- LIST:END -->";
const README = join(process.cwd(), "README.md");

const tests = readTests();
const history = (id: string) => tests.results[id] ?? [];
const resources = readResources().filter((r) => r.status !== "removed" && !isUnreachable(history(r.id)));

const status = (id: string) => {
  const last = history(id).at(-1);
  return !last ? "–" : last.status === "responded" ? "🟢" : last.status === "rate_limited" || last.status === "slow" || last.status === "restricted" ? "🟡" : "🔴";
};
const link = (r: Resource) => `[${r.name.replace(/\|/g, "\\|")}](${SITE.url}/models/${r.provider}/${r.slug}/)`;

const sections = MODEL_KINDS.flatMap((kind) => {
  const ofKind = resources.filter((r) => r.kind === kind);
  if (ofKind.length === 0) return [];
  const byProvider = PROVIDER_IDS.flatMap((p) => {
    const list = ofKind.filter((r) => r.provider === p).sort((a, b) => a.name.localeCompare(b.name));
    if (list.length === 0) return [];
    const info = PROVIDERS[p];
    const rows = kind === "chat"
      ? list.map((r) => {
          const agent = agentReadiness(r, history(r.id), tests.tool_results?.[r.id]).level === "yes" ? "🤖" : "";
          const tools = r.tool_calling === true ? "yes" : r.tool_calling === false ? "no" : "?";
          return `| ${link(r)} | \`${r.model_id}\` | ${formatContext(r.context_length)} | ${tools} | ${status(r.id)} | ${agent} |`;
        })
      : list.map((r) => `| ${link(r)} | \`${r.model_id}\` | ${status(r.id)} |`);
    return [
      `#### ${info.label}${info.usage_terms === "evaluation-only" ? " ⚠ evaluation only" : ""}`,
      "",
      kind === "chat" ? "| Model | ID | Context | Tools | Last test | Agent |\n|---|---|---|---|---|---|" : "| Model | ID | Last test |\n|---|---|---|",
      ...rows,
      "",
    ];
  });
  return [`### ${KIND_LABELS[kind]} (${ofKind.length})`, "", ...byProvider];
});

const body = [
  START,
  `_${resources.length} free models. Updated automatically; see [${SITE.name}](${SITE.url}) for filters, limits and change history._`,
  "",
  "🟢 responded to the latest daily test · 🟡 rate-limited or slow · 🔴 failed · 🤖 agent-ready (tool calling, ≥64k context, answered 5 of the last 7 days)",
  "",
  ...sections,
  END,
].join("\n");

const readme = readFileSync(README, "utf8");
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) throw new Error("README.md is missing the LIST markers");
const next = readme.slice(0, start) + body + readme.slice(end + END.length);
if (next !== readme) {
  writeFileSync(README, next);
  console.log("README.md updated");
} else {
  console.log("README.md unchanged");
}
