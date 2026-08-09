import { db } from "@/db";
import { modules, agentRuns, spiderCandidates } from "@/db/schema";
import { sql, eq, desc, gte } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [totalModules] = await db.select({ value: sql<number>`count(*)` }).from(modules);
  const [demoModules] = await db
    .select({ value: sql<number>`count(*)` })
    .from(modules)
    .where(eq(modules.isDemo, true));
  const [brokenModules] = await db
    .select({ value: sql<number>`count(*)` })
    .from(modules)
    .where(eq(modules.health, "broken" as never));
  const [spiderCount] = await db
    .select({ value: sql<number>`count(*)` })
    .from(spiderCandidates);
  const [runsToday] = await db
    .select({ value: sql<number>`count(*)` })
    .from(agentRuns)
    .where(gte(agentRuns.createdAt, todayStart));

  const recentRuns = await db
    .select({
      id: agentRuns.id,
      agent: agentRuns.agent,
      trigger: agentRuns.trigger,
      status: agentRuns.status,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .orderBy(desc(agentRuns.createdAt))
    .limit(8);

  const stats = [
    { label: "Total Modules", value: totalModules.value },
    { label: "Demo Modules", value: demoModules.value },
    { label: "Broken Modules", value: brokenModules.value },
    { label: "Spider Candidates", value: spiderCount.value },
    { label: "Agent Runs Today", value: runsToday.value },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
            <p className="text-sm text-neutral-400">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="mb-3 text-lg font-semibold">Recent Agent Runs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-700 text-left text-neutral-400">
                <th className="pb-2 pr-4">Agent</th>
                <th className="pb-2 pr-4">Trigger</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-neutral-500">No runs yet</td>
                </tr>
              )}
              {recentRuns.map((run) => (
                <tr key={run.id} className="border-b border-neutral-800 last:border-0">
                  <td className="py-2 pr-4">{run.agent}</td>
                  <td className="py-2 pr-4">{run.trigger}</td>
                  <td className="py-2 pr-4">{run.status}</td>
                  <td className="py-2">{run.createdAt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
