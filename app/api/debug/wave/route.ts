import { NextRequest } from "next/server";
import { getSimulator } from "@/lib/sim/simulator";

export const dynamic = "force-dynamic";

// Debug wave: triggers the full canary->fanout choreography with zero AI.
// Used to tune the wave and as a demo-day fallback.
// Optional JSON body: { "app": "Kahoot", "remove_after_hours": 24 } to
// exercise timed deployments without the LLM.
export async function POST(req: NextRequest) {
  let app: string | undefined;
  let removeAfterHours: number | undefined;
  try {
    const body = await req.json();
    if (typeof body?.app === "string") app = body.app;
    if (typeof body?.remove_after_hours === "number") removeAfterHours = body.remove_after_hours;
  } catch { /* empty body is fine */ }

  const plan = getSimulator().debugWave(app, removeAfterHours);
  return Response.json({ ok: true, plan_id: plan.id, label: plan.label });
}
