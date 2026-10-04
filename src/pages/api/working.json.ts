import { activeModels, searchApis } from "../../lib/data";
import { workingFeed } from "../../../pipeline/working";
import { SITE } from "../../../site.config";

/** Free models (per use) and free search APIs that answered the latest daily test, best first. See /developers/. */
export function GET() {
  const feed = workingFeed(activeModels, SITE.url, new Date().toISOString(), searchApis);
  return new Response(JSON.stringify(feed, null, 2), { headers: { "Content-Type": "application/json" } });
}
