import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { eventHref, events } from "../lib/data";
import { SITE } from "../../site.config";

export function GET(context: APIContext) {
  return rss({
    title: `${SITE.name}: changes`,
    description: "Free AI models that appeared, changed or disappeared.",
    site: context.site!,
    trailingSlash: false,
    items: events.slice(0, 100).map((e) => ({
      title: `${e.event_type}: ${e.name}`,
      description: e.text,
      pubDate: new Date(e.detected_at),
      link: eventHref(e) ?? "/changes/",
      categories: [e.provider, e.event_type],
    })),
  });
}
