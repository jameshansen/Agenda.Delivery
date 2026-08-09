import { db } from "@/db";
import { agentConfig } from "@/db/schema";
import { asc } from "drizzle-orm";
import { saveAgentConfig } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminAgentsPage() {
  const rows = await db.select().from(agentConfig).orderBy(asc(agentConfig.agent));

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <h1 className="text-2xl font-bold mb-6">Agent Configuration</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {rows.map((row) => (
          <div key={row.agent} className="bg-neutral-900 border border-neutral-800 rounded-lg p-4">
            <form action={saveAgentConfig} className="space-y-4">
              <input type="hidden" name="agent" value={row.agent} />
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor={`displayName-${row.agent}`}>
                  Display Name
                </label>
                <input
                  id={`displayName-${row.agent}`}
                  name="displayName"
                  defaultValue={row.displayName}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor={`model-${row.agent}`}>
                  Model
                </label>
                <input
                  id={`model-${row.agent}`}
                  name="model"
                  defaultValue={row.model}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor={`scheduleSecs-${row.agent}`}>
                  Schedule (seconds)
                </label>
                <input
                  id={`scheduleSecs-${row.agent}`}
                  type="number"
                  name="scheduleSecs"
                  defaultValue={row.scheduleSecs ?? ""}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
                  placeholder="Empty = not scheduled"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id={`enabled-${row.agent}`}
                  type="checkbox"
                  name="enabled"
                  defaultChecked={row.enabled}
                  className="h-4 w-4"
                />
                <label className="text-sm" htmlFor={`enabled-${row.agent}`}>
                  Enabled
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor={`systemPrompt-${row.agent}`}>
                  System Prompt
                </label>
                <textarea
                  id={`systemPrompt-${row.agent}`}
                  name="systemPrompt"
                  rows={6}
                  defaultValue={row.systemPrompt}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm font-mono"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-2 px-4 rounded transition-colors"
              >
                Save
              </button>
            </form>
            <p className="text-xs text-neutral-500 mt-3">
              Updated: {row.updatedAt.toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
