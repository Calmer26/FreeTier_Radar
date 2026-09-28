/**
 * Regenerates the auto-updated list in README.md between the LIST markers, from
 * data/. Run after discovery and after the daily tests; writes only on change.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentReadiness } from "../pipeline/agent-ready";
import { PROVIDER_IDS, PROVIDERS } from "../pipeline/providers";
import { readResources, readTests } from "../pipeline/store";
import { formatContext } from "../pipeline/templates";
import { SITE } from "../site.config";

const START = "<!-- LIST:START -->";
const END = "<!-- LIST:END -->";
const README = join(process.cwd(), "README.md");

const tests = readTests();
const resources = readResources().filter((r) => r.status !== "removed");

const sections = PROVIDER_IDS.flatMap((p) => {
  const list = resources.filter((r) => r.provider === p).sort((a, b) => a.name.localeCompare(b.name));
  if (list.length === 0) return [];
  const info = PROVIDERS[p];
  const rows = list.map((r) => {
    const history = tests.results[r.id] ?? [];
    const last = history.at(-1);
    const agent = agentReadiness(r, history).level === "yes" ? "🤖" : "";
    const status = !last ? "–" : last.status === "responded" ? "🟢" : last.status === "rate_limited" || last.status === "slow" ? "🟡" : "🔴";
    const tools = r.tool_calling === true ? "yes" : r.tool_calling === false ? "no" : "?";
    return `| [${r.name.replace(/\|/g, "\\|")}](${SITE.url}/models/${r.provider}/${r.slug}/) | \`${r.model_id}\` | ${formatContext(r.context_length)} | ${tools} | ${status} | ${agent} |`;
  });
  return [
    `### ${info.label}${info.usage_terms === "evaluation-only" ? " ⚠ evaluation only" : ""}`,
    "",
    info.summary,
    "",
    "| Model | ID | Context | Tools | Last test | Agent |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ];
});

const body = [
  START,
  `_${resources.length} free chat models. Updated automatically; see [${SITE.name}](${SITE.url}) for filters, limits and change history._`,
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
