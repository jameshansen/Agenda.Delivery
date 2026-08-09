"use server";

import { db } from "@/db";
import { agentConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function saveAgentConfig(formData: FormData) {
  const agent = formData.get("agent") as string;
  const displayName = formData.get("displayName") as string;
  const model = formData.get("model") as string;
  const scheduleSecsRaw = formData.get("scheduleSecs");
  const scheduleSecs =
    scheduleSecsRaw === "" || scheduleSecsRaw === null
      ? null
      : parseInt(scheduleSecsRaw as string, 10);
  const enabled = formData.get("enabled") === "on";
  const systemPrompt = formData.get("systemPrompt") as string;

  await db
    .update(agentConfig)
    .set({ displayName, model, scheduleSecs, enabled, systemPrompt, updatedAt: new Date() })
    .where(eq(agentConfig.agent, agent as never));

  revalidatePath("/admin/agents");
}
