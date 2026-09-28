/**
 * Template text for change events. Facts only, built from structured fields —
 * no model writes these, so they cannot invent a number.
 */

import { PROVIDERS } from "./providers";
import type { EventType, ModelKind, ObservedModel, PriceLine, RateLimits } from "./types";

export function formatContext(tokens: number | null): string {
  if (!tokens) return "unknown";
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

export function formatLimits(l: RateLimits | null): string {
  if (!l) return "limits not published in a form we track";
  const parts = [
    l.rpm != null ? `${l.rpm} req/min` : null,
    l.rph != null ? `${l.rph} req/hour` : null,
    l.rpd != null ? `${l.rpd} req/day` : null,
    l.tpm != null ? `${l.tpm.toLocaleString("en-US")} tokens/min` : null,
    l.tpd != null ? `${l.tpd.toLocaleString("en-US")} tokens/day` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "limits unknown";
}

export function formatValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return "unknown";
  if (field === "context_length") return formatContext(v as number);
  if (field === "rate_limits") return formatLimits(v as RateLimits);
  if (field === "pricing") return (v as PriceLine[]).map((l) => `$${l.usd} per ${l.unit}`).join(", ") || "none";
  if (Array.isArray(v)) return v.join(", ") || "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

export const KIND_LABELS: Record<ModelKind, string> = {
  chat: "Chat",
  tts: "Text-to-speech",
  stt: "Speech-to-text",
  image: "Image",
};

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  price_type: "price",
  context_length: "context window",
  input_modalities: "input types",
  tool_calling: "tool calling",
  rate_limits: "rate limits",
  limit_scope: "limit scope",
  usage_terms: "usage terms",
  licence: "licence",
  card_required: "card required",
  account_required: "account required",
  data_logging: "data use",
  pricing: "price",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function eventText(
  type: EventType,
  m: Pick<ObservedModel, "provider" | "kind" | "name" | "context_length" | "tool_calling" | "usage_terms" | "rate_limits" | "input_modalities">,
  change?: { field: string; old: unknown; new: unknown },
): string {
  const provider = PROVIDERS[m.provider].label;
  switch (type) {
    case "NEW": {
      if (m.kind !== "chat") {
        return `${m.name} (${KIND_LABELS[m.kind].toLowerCase()}) is now listed as free on ${provider}.` +
          (m.usage_terms === "evaluation-only" ? " Evaluation only: not for production use." : "");
      }
      const bits = [
        `${m.name} is now listed as free on ${provider}.`,
        `Context: ${formatContext(m.context_length)}.`,
        m.tool_calling === true ? "Supports tool calling." : m.tool_calling === false ? "No tool calling." : null,
        m.input_modalities?.includes("image") ? "Accepts images." : null,
        m.usage_terms === "evaluation-only" ? "Evaluation only: not for production use." : null,
      ];
      return bits.filter(Boolean).join(" ");
    }
    case "REMOVED":
      return `${m.name} is no longer listed as free on ${provider}. It has been missing for at least 12 hours.`;
    case "RETURNED":
      return `${m.name} is listed as free on ${provider} again.`;
    case "OFFER":
      return change ? String(change.new) : `${m.name} changed.`;
    case "CHANGED": {
      if (!change) return `${m.name} on ${provider} changed.`;
      return `${m.name} on ${provider}: ${fieldLabel(change.field)} changed from ${formatValue(change.field, change.old)} to ${formatValue(change.field, change.new)}.`;
    }
  }
}
