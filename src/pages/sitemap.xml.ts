import { SITE } from "../../site.config";
import { PROVIDER_IDS } from "../../pipeline/providers";
import { rank, RANKINGS } from "../../pipeline/rankings";
import { activeModels } from "../lib/data";
import { roundups } from "../lib/roundups";

/**
 * Only pages we want indexed: model pages once they have a test result (and aren't
 * "listed but not callable"), providers with models, and the site's own pages. Pages
 * marked noindex are left out, so the sitemap never contradicts them.
 */
export function GET() {
  const url = (path: string) => new URL(path, SITE.url).href;
  const entries: Array<{ loc: string; lastmod?: string }> = [
    "/", "/changes/", "/rankings/", "/cline/", "/image-models/", "/free-apps/", "/offers/", "/providers/", "/roundups/", "/methodology/", "/sponsor/",
  ].map((p) => ({ loc: url(p) }));

  const inputs = activeModels.map((m) => ({ r: m, history: m.tests, tools: m.toolTests, arena: m.arena }));
  // Empty rankings are noindex, so leave them out too.
  for (const r of RANKINGS) if (rank(r, inputs).length) entries.push({ loc: url(`/rankings/${r.slug}/`) });
  for (const p of PROVIDER_IDS) {
    if (activeModels.some((m) => m.provider === p)) entries.push({ loc: url(`/providers/${p}/`) });
  }
  for (const m of activeModels) {
    if (!m.indexable) continue;
    entries.push({ loc: url(m.href), lastmod: (m.lastTest?.at ?? m.last_seen).slice(0, 10) });
  }
  for (const r of roundups) entries.push({ loc: url(r.href), lastmod: r.frontmatter.end });

  const body = entries
    .map((e) => `  <url><loc>${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`)
    .join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
