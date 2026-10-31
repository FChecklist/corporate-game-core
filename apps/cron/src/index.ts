// The scheduled job: once a minute it asks Corporate Bingo to do its housekeeping (send finished games' reports, delete participant data on time,
// delete engagements at the end of their 365 days). It holds one secret, the job key, which can call only that one address. All the logic is in the app itself.
export interface Env { CRON_KEY: string; TARGET?: string }
async function tick(env: Env): Promise<string> {
  const r = await fetch((env.TARGET ?? "https://corporate-bingo.pages.dev") + "/api/lifecycle/tick", { method: "POST", headers: { "x-cron-key": env.CRON_KEY, "content-type": "application/json" }, body: "{}" });
  return `${r.status} ${(await r.text()).slice(0, 200)}`;
}
export default {
  scheduled: async (_e: unknown, env: Env) => { console.log("tick", await tick(env)); },
  fetch: async () => new Response("Corporate Bingo scheduled job. Nothing to see here.", { status: 200 }),
};
