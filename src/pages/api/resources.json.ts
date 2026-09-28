import { models } from "../../lib/data";

/** Public, static JSON feed of every tracked resource with its latest test result. */
export function GET() {
  const body = models.map(({ tests, href, indexable, fingerprint, ...m }) => ({
    ...m,
    agent_ready: m.agent.level,
    url_on_site: href,
  }));
  return new Response(JSON.stringify({ generated_at: new Date().toISOString(), resources: body }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
