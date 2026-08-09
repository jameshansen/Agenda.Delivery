import { db } from "@/db";
import { spiderCandidates, agentRuns } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const statusLabels: Record<string, string> = {
  discovered: "Discovered",
  geo_located: "Geo-located",
  queued: "Queued",
  created: "Created",
  rejected: "Rejected",
};

const statusColors: Record<string, string> = {
  discovered: "bg-neutral-800 text-neutral-300 border-neutral-700",
  geo_located: "bg-neutral-800 text-neutral-300 border-neutral-700",
  queued: "bg-blue-900/30 text-blue-300 border-blue-800",
  created: "bg-green-900/30 text-green-300 border-green-800",
  rejected: "bg-red-900/30 text-red-300 border-red-800",
};

export default async function AdminSpiderPage() {
  const [candidates, runs] = await Promise.all([
    db.select().from(spiderCandidates).orderBy(desc(spiderCandidates.createdAt)).limit(100),
    db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agent, "spider" as never))
      .orderBy(desc(agentRuns.createdAt))
      .limit(10),
  ]);

  const counts = candidates.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Spider</h1>

      {/* Status summary */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(statusLabels).map(([status, label]) => (
          <div
            key={status}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
              statusColors[status] ?? statusColors.discovered
            }`}
          >
            <span className="text-sm font-medium">{label}</span>
            <span className="text-sm font-bold">{counts[status] ?? 0}</span>
          </div>
        ))}
      </div>

      {/* Recent spider runs */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Recent runs</h2>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800">
                <th className="text-left px-4 py-2 font-medium text-neutral-400">Trigger</th>
                <th className="text-left px-4 py-2 font-medium text-neutral-400">Status</th>
                <th className="text-left px-4 py-2 font-medium text-neutral-400">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-3 text-neutral-500">No runs yet</td>
                </tr>
              )}
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-neutral-800 last:border-0">
                  <td className="px-4 py-2">{run.trigger}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        run.status === "completed"
                          ? "bg-green-900/30 text-green-300"
                          : run.status === "failed"
                          ? "bg-red-900/30 text-red-300"
                          : run.status === "running"
                          ? "bg-blue-900/30 text-blue-300"
                          : "bg-neutral-700 text-neutral-300"
                      }`}
                    >
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Candidates table */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Candidates</h2>
        <div className="bg-neutral-900 border border-neutral-800 rounded-lg overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-neutral-900">
              <tr className="border-b border-neutral-800">
                <th className="text-left px-4 py-2 font-medium text-neutral-400">Name</th>
                <th className="text-left px-4 py-2 font-medium text-neutral-400">Region</th>
                <th className="text-left px-4 py-2 font-medium text-neutral-400">Source</th>
                <th className="text-left px-4 py-2 font-medium text-neutral-400">Status</th>
                <th className="text-left px-4 py-2 font-medium text-neutral-400">Reject reason</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-neutral-500">No candidates yet</td>
                </tr>
              )}
              {candidates.map((c) => (
                <tr key={c.id} className="border-b border-neutral-800 last:border-0">
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2 text-neutral-300">{c.region ?? "—"}</td>
                  <td className="px-4 py-2 text-neutral-300">{c.source ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${statusColors[c.status]}`}>
                      {statusLabels[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-red-400">
                    {c.status === "rejected" ? c.rejectReason ?? "—" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
