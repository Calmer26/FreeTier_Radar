/**
 * FreeTier Radar scheduler: a Cloudflare Worker with a cron trigger that starts the
 * GitHub Actions data workflows on time (workflow_dispatch). No public URL.
 *
 * Secret GITHUB_TOKEN: a fine-grained token for Calmer26/FreeTier_Radar only, with
 * "Actions: Read and write". Set it with `npx wrangler secret put GITHUB_TOKEN`.
 */

import { due } from "./schedule";

const REPO = "Calmer26/FreeTier_Radar";

interface Env {
  GITHUB_TOKEN: string;
}

async function dispatch(workflow: string, token: string): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "freetier-radar-scheduler",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  // 204 = started. Anything else shows in the Worker's logs.
  if (res.status !== 204) throw new Error(`${workflow}: HTTP ${res.status} ${await res.text()}`);
  console.log(`started ${workflow}`);
}

export default {
  async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
    const workflows = due(new Date(controller.scheduledTime));
    const results = await Promise.allSettled(workflows.map((w) => dispatch(w, env.GITHUB_TOKEN)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const f of failed) console.error(String(f.reason));
    if (failed.length) throw new Error(`${failed.length} workflow(s) not started`);
  },
};
