import type { Resource } from "./types";

/**
 * Fills fields added after a record was first written. Records from before model
 * kinds existed are chat models from a model list. No imports beyond types, so the
 * site can use it too.
 */
export function withDefaults(r: Resource): Resource {
  return { ...r, kind: r.kind ?? "chat", listed_by: r.listed_by ?? "api" };
}
