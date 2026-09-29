import { activeModels } from "../../lib/data";
import { workingFeed } from "../../../pipeline/working";
import { SITE } from "../../../site.config";

/** Free models that answered the latest daily test, per use, best first. See /developers/. */
export function GET() {
  const feed = workingFeed(activeModels, SITE.url, new Date().toISOString());
  return new Response(JSON.stringify(feed, null, 2), { headers: { "Content-Type": "application/json" } });
}
