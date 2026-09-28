import { events } from "../../lib/data";

/** Public, static JSON feed of the latest 500 change events, newest first. */
export function GET() {
  return new Response(JSON.stringify({ generated_at: new Date().toISOString(), events: events.slice(0, 500) }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
