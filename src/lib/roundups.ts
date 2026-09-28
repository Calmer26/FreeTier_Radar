/**
 * Published weekly roundups: content/roundups/<ISO week>.md, merged from the
 * Monday PR. Bundled at build time like the rest of data/.
 */

import type { AstroComponentFactory } from "astro/runtime/server/index.js";

interface RoundupModule {
  frontmatter: { title: string; week: string; start: string; end: string; events: number };
  Content: AstroComponentFactory;
  rawContent: () => string;
}

const files = import.meta.glob<RoundupModule>("../../content/roundups/*.md", { eager: true });

export interface Roundup extends RoundupModule {
  slug: string;
  href: string;
}

/** Newest first. */
export const roundups: Roundup[] = Object.values(files)
  .map((m) => ({ ...m, slug: m.frontmatter.week.toLowerCase(), href: `/roundups/${m.frontmatter.week.toLowerCase()}/` }))
  .sort((a, b) => b.frontmatter.week.localeCompare(a.frontmatter.week));
