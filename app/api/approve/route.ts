import { NextRequest } from "next/server";
import { getSimulator } from "@/lib/sim/simulator";

export const dynamic = "force-dynamic";

// Executes an approved plan against the simulator directly — no LLM in the
// execution path. The model never has a code path to execute without a
// registered, human-approved plan.
export async function POST(req: NextRequest) {
  const { plan_id, decision } = (await req.json()) as { plan_id: string; decision: "approve" | "cancel" };
  const sim = getSimulator();

  if (decision === "cancel") {
    const plan = sim.cancelPlan(plan_id);
    return Response.json({ ok: true, message: plan ? `Plan cancelled: ${plan.label}.` : "Plan not found." });
  }

  const result = sim.approvePlan(plan_id);
  return Response.json(result);
}
