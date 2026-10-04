/**
 * Display helpers for the search API pages (/search-apis/).
 */

import { buildSearchRequest, freeQueriesPerMonth } from "../../pipeline/search";
import type { SearchApi } from "../../pipeline/types";

const n = (x: number) => x.toLocaleString("en-US");

/** "1,000 searches a month". */
export function queriesLine(s: SearchApi): string {
  return `${n(freeQueriesPerMonth(s))} searches a month`;
}

/** One search's price in the allowance's unit: "$0.005", "2 credits". */
export function costText(s: SearchApi, cost: number): string {
  if (s.allowance.unit === "usd") return `$${cost}`;
  if (s.allowance.unit === "credits") return `${n(cost)} credit${cost === 1 ? "" : "s"}`;
  return `${n(cost)} quer${cost === 1 ? "y" : "ies"}`;
}

/** "$5 credit a month", "1,000 credits a month". */
export function allowanceText(s: SearchApi): string {
  const { amount, unit, period } = s.allowance;
  const what = unit === "usd" ? `$${n(amount)} credit` : `${n(amount)} ${unit}`;
  return `${what} a ${period}`;
}

export function limitsText(s: SearchApi): string {
  const l = s.rate_limits;
  if (!l) return "Not published";
  const parts = [
    l.rps != null && `${n(l.rps)}/second`,
    l.rpm != null && `${n(l.rpm)}/minute`,
    l.rph != null && `${n(l.rph)}/hour`,
    l.rpd != null && `${n(l.rpd)}/day`,
    l.concurrency != null && `${n(l.concurrency)} at a time`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Not published";
}

/** The badge part of a card note: its first sentence. */
export const cardBadge = (s: SearchApi) => (s.card_note ?? "Card required").split(/(?<=\.)\s/)[0].replace(/\.$/, "");

export const TERMS_LABEL: Record<SearchApi["usage_terms"], string> = {
  "production-ok": "Production use allowed",
  "evaluation-only": "Evaluation only",
  "non-commercial": "Non-commercial only",
  unknown: "Terms not yet checked",
};

export const DATA_LABEL: Record<SearchApi["data_logging"], string> = {
  "not-used": "Not logged or used",
  "none-stated": "Nothing stated",
  "logs-prompts": "Logs queries",
  "may-train": "May use your queries",
  unknown: "Not yet checked",
};

export const STORAGE_LABEL: Record<SearchApi["result_storage"], string> = {
  allowed: "Allowed",
  "not-allowed": "Not on the free credit",
  unknown: "Not stated",
};

export const INDEX_LABEL: Record<SearchApi["index"], string> = {
  own: "Its own index",
  "google-serp": "Google results",
  mixed: "Its own index, plus third-party indexes when needed",
  unknown: "Not stated",
};

const yn = (v: "yes" | "no" | "unknown") => (v === "yes" ? "yes" : v === "no" ? "no" : "?");

/** "NL yes · nl yes" style summary of country and language targeting. */
export function localeText(s: SearchApi): string {
  return `country ${yn(s.locale.country)} · language ${yn(s.locale.language)}`;
}

/** The exact request our daily test sends, as curl, with the key read from its env var. */
export function curlFor(s: SearchApi): string {
  const { url, init } = buildSearchRequest(s, { [s.key_env]: `$${s.key_env}` });
  const headers = Object.entries(init.headers as Record<string, string>).map(([k, v]) => `  -H "${k}: ${v}"`);
  const body = init.body ? [`  -d '${String(init.body)}'`] : [];
  return [`curl -s ${init.method === "POST" ? "-X POST " : ""}"${url}"`, ...headers, ...body].join(" \\\n");
}
