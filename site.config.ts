/**
 * Site identity, shared by the pipeline and the Astro site.
 *
 * `url` must be the address the site is really served from: it's used for canonical
 * links, the sitemap, RSS and README links. Search engines drop pages whose canonical
 * points elsewhere. freetierradar.com is registered by someone else (parked, checked
 * 2026-09-29), so until we have our own domain this is the Cloudflare address. When a
 * domain is added in Cloudflare, change it here (or set SITE_URL) in the same push.
 */
export const SITE = {
  name: "FreeTier Radar",
  url: process.env.SITE_URL || "https://freetier-radar.marcelkanters.workers.dev",
  tagline: "Free AI models and developer tiers: what's free, what changed, and what actually works.",
  repo: "https://github.com/Calmer26/FreeTier_Radar",
};
