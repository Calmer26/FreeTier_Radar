import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { roundups } from "../../lib/roundups";
import { SITE } from "../../../site.config";

/** Full-text feed of the weekly roundups; a newsletter tool can send it as email. */
export async function GET(context: APIContext) {
  const items = await Promise.all(
    roundups.slice(0, 30).map(async (r) => ({
      title: r.frontmatter.title,
      pubDate: new Date(`${r.frontmatter.end}T12:00:00Z`),
      link: r.href,
      description: `${r.frontmatter.events} change(s) from ${r.frontmatter.start} to ${r.frontmatter.end}.`,
      // compiledContent() is async in current Astro; await covers both shapes.
      content: await (r as unknown as { compiledContent: () => string | Promise<string> }).compiledContent(),
    })),
  );
  return rss({
    title: `${SITE.name}: weekly roundup`,
    description: "Every week: which AI models became free, which disappeared, and what changed in free tiers and credits.",
    site: context.site!,
    trailingSlash: false,
    items,
  });
}
