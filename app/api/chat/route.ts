import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { TOOLS, executeTool } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { getSimulator } from "@/lib/sim/simulator";
import { runLocalAppTurn } from "@/lib/agent/localApp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MODEL = process.env.FLEETPILOT_MODEL ?? "claude-sonnet-5";
const MAX_TURNS = 8;

interface ClientMessage {
  role: "user" | "assistant" | "event";
  content: string;
}

export async function POST(req: NextRequest) {
  const { messages: clientMessages } = (await req.json()) as { messages: ClientMessage[] };
  const sim = getSimulator();

  // No API key? Proxy through the locally installed Claude Code app instead
  // (Claude Agent SDK — uses the machine's existing Claude login).
  if (!process.env.ANTHROPIC_API_KEY) {
    const pendingLocal = sim.pendingPlan();
    if (pendingLocal) sim.cancelPlan(pendingLocal.id);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          await runLocalAppTurn(clientMessages, send);
          send({ type: "done" });
        } catch (err) {
          send({
            type: "error",
            message:
              `Local Claude app path failed: ${err instanceof Error ? err.message : String(err)}. ` +
              `Either sign in to Claude Code on this machine, or set ANTHROPIC_API_KEY in .env.local.`,
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" },
    });
  }

  const client = new Anthropic();

  // A new user message discards any unapproved plan (plan lifecycle rule).
  const pending = sim.pendingPlan();
  if (pending) sim.cancelPlan(pending.id);

  // Map client history to API messages. "event" entries are fleet status cards
  // (approvals, results) injected so the model sees what happened between turns.
  // Consecutive same-role user messages are allowed; the API combines them.
  const messages: Anthropic.MessageParam[] = clientMessages.map((m) =>
    m.role === "event"
      ? { role: "user" as const, content: `[FLEET EVENT — system status, not the user speaking] ${m.content}` }
      : { role: m.role, content: m.content },
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const msgStream = client.messages.stream({
            model: MODEL,
            max_tokens: 16000,
            system: buildSystemPrompt(),
            tools: TOOLS,
            messages,
          });

          msgStream.on("text", (delta) => send({ type: "delta", text: delta }));

          const message = await msgStream.finalMessage();
          messages.push({ role: "assistant", content: message.content });

          if (message.stop_reason === "pause_turn") continue;

          if (message.stop_reason !== "tool_use") {
            if (message.stop_reason === "refusal") {
              send({ type: "delta", text: "\n\n(The model declined this request for safety reasons.)" });
            }
            break;
          }

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of message.content) {
            if (block.type !== "tool_use") continue;
            send({ type: "tool", name: block.name });
            const result = executeTool(block.name, block.input);
            // Surface plan/refusal payloads to the UI so it can render cards.
            try {
              const parsed = JSON.parse(result);
              if (parsed.plan_id && parsed.requires_approval) {
                const plan = sim.plans.get(parsed.plan_id);
                send({ type: "plan", plan, blast_radius: parsed.blast_radius, rollout: parsed.rollout, offline_queued: parsed.offline_devices_queued });
              } else if (parsed.refused) {
                send({ type: "refusal", action: parsed.action, blast_radius: parsed.blast_radius, elevation_text: parsed.elevation_text });
              }
            } catch { /* non-JSON result */ }
            toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
          }
          // All tool results go back in ONE user message.
          messages.push({ role: "user", content: toolResults });
          send({ type: "turn" });
        }
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" },
  });
}
