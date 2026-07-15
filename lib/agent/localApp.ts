// No-API-key path: run the agent through the locally installed Claude Code
// app (Claude Agent SDK). Auth comes from the user's existing Claude login;
// the 11 fleet tools run in-process against the same simulator singleton.
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { executeTool } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/prompt";

type Send = (obj: unknown) => void;

const targetShape = z
  .object({
    group_names: z.array(z.string()).optional().describe("Group names, e.g. ['G6-C1','G6-C2']. Fuzzy names like '6th grade carts' also resolve."),
    school: z.string().optional().describe("All devices at a school, e.g. 'Lincoln Middle'."),
    device_ids: z.array(z.string()).optional().describe("Specific device IDs, e.g. ['G6-C2-10']."),
    scope: z.enum(["district"]).optional().describe("Every device in the district."),
  })
  .describe("Which devices this applies to. Provide at least one field.");

// Wraps executeTool and surfaces plan/refusal payloads to the UI stream.
function run(send: Send, name: string) {
  return async (args: Record<string, unknown>) => {
    send({ type: "tool", name });
    const result = executeTool(name, args);
    try {
      const parsed = JSON.parse(result);
      if (parsed.plan_id && parsed.requires_approval) {
        const { getSimulator } = await import("@/lib/sim/simulator");
        const plan = getSimulator().plans.get(parsed.plan_id);
        send({ type: "plan", plan, blast_radius: parsed.blast_radius, rollout: parsed.rollout, offline_queued: parsed.offline_devices_queued });
      } else if (parsed.refused) {
        send({ type: "refusal", action: parsed.action, blast_radius: parsed.blast_radius, elevation_text: parsed.elevation_text });
      }
    } catch { /* non-JSON */ }
    return { content: [{ type: "text" as const, text: result }] };
  };
}

function buildFleetServer(send: Send) {
  return createSdkMcpServer({
    name: "fleet",
    version: "1.0.0",
    tools: [
      tool("search_devices", "Search the fleet. Call this for any question about devices (check-ins, apps, status). Matching devices are highlighted on the fleet board automatically.", {
        group_name: z.string().optional().describe("Filter to one group (fuzzy names OK)."),
        school: z.string().optional(),
        status: z.enum(["online", "offline"]).optional(),
        not_checked_in_days: z.number().optional().describe("Devices whose last check-in is older than N days."),
        has_app: z.string().optional().describe("Devices that HAVE this app installed."),
        missing_app: z.string().optional().describe("Devices MISSING this app."),
        locked: z.boolean().optional(),
        has_content_filter: z.boolean().optional().describe("Devices that DO (true) or do NOT (false) have a content filter applied."),
      }, run(send, "search_devices")),
      tool("list_groups", "List every device group (carts and staff sets) with school, room, and device counts. Call this first when unsure of exact group names.", {}, run(send, "list_groups")),
      tool("get_device", "Full detail for one device by ID.", { device_id: z.string() }, run(send, "get_device")),
      tool("get_command_status", "Status of a plan's rollout: per-state counts, failed devices, offline-queued devices, scheduled removals. Call after a push to check how it went.", {
        plan_id: z.string().optional().describe("Omit to get the most recent plan."),
      }, run(send, "get_command_status")),
      tool("install_app", "Install an app on target devices. Registers a plan requiring human approval; nothing executes until the user clicks Approve. Supports timed deployments via remove_after_hours (e.g. 'push Kahoot for 24 hours').", {
        app_name: z.string().describe("e.g. 'Google Chrome', 'Kahoot'"),
        target: targetShape,
        remove_after_hours: z.number().optional().describe("Optional. Automatically remove the app this many hours after a successful deploy. Covered by the same approval."),
      }, run(send, "install_app")),
      tool("create_blacklist", "Create (or replace) a named URL blocklist in the MDM console. Executes immediately — it only saves configuration, no devices are touched. When asked to block a category of sites (e.g. popular gaming sites), identify the URLs yourself and pass them here, then push with push_content_filter.", {
        name: z.string().describe("Blocklist name, e.g. 'Gaming Sites Blacklist'."),
        category: z.string().optional().describe("Optional category tag, e.g. 'gaming'."),
        urls: z.array(z.string()).describe("Domains to block, e.g. ['roblox.com','coolmathgames.com']."),
      }, run(send, "create_blacklist")),
      tool("push_content_filter", "Push a content-filter (web block) built from an existing blocklist to target devices. Create the blocklist first with create_blacklist. Registers a plan requiring human approval.", {
        blacklist_name: z.string().describe("Name of a blocklist previously created with create_blacklist."),
        target: targetShape,
      }, run(send, "push_content_filter")),
      tool("push_profile", "Push a configuration profile (e.g. content filter, Wi-Fi, restrictions) to target devices. Registers a plan requiring human approval.", {
        profile_name: z.string().describe("e.g. 'CIPA Content Filter'"),
        target: targetShape,
      }, run(send, "push_profile")),
      tool("lock_device", "Remote-lock target devices (lost/stolen). Registers a plan requiring human approval. Refused outright at fleet-wide scope.", {
        target: targetShape,
        message: z.string().optional().describe("Message shown on the lock screen."),
      }, run(send, "lock_device")),
      tool("send_message", "Send an on-screen message to target devices. Registers a plan requiring human approval.", {
        target: targetShape,
        message: z.string(),
      }, run(send, "send_message")),
      tool("erase_device", "Factory-erase target devices. DESTRUCTIVE. Single group: registers a plan requiring human approval. Multi-group or fleet-wide: refused by policy (the refusal shows the blast radius).", {
        target: targetShape,
      }, run(send, "erase_device")),
    ],
  });
}

interface ClientMessage {
  role: "user" | "assistant" | "event";
  content: string;
}

export async function runLocalAppTurn(clientMessages: ClientMessage[], send: Send): Promise<void> {
  const transcript = clientMessages
    .map((m) => (m.role === "event" ? `[FLEET EVENT — system status] ${m.content}` : `${m.role.toUpperCase()}: ${m.content}`))
    .join("\n\n");

  const prompt =
    `Conversation so far between the IT admin (USER) and you (ASSISTANT):\n\n${transcript}\n\n` +
    `Respond to the last USER message. Use your fleet tools; do not answer fleet questions from memory.`;

  let emittedText = false;

  for await (const message of query({
    prompt,
    options: {
      systemPrompt: buildSystemPrompt(),
      model: "sonnet",
      maxTurns: 10,
      tools: [], // no built-ins (Read/Bash/Web...) — fleet tools only
      mcpServers: { fleet: buildFleetServer(send) },
      allowedTools: ["mcp__fleet__*"],
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim()) {
          send({ type: "delta", text: block.text });
          send({ type: "turn" });
          emittedText = true;
        }
        // tool_use notes are emitted from the tool handlers themselves
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        if (!emittedText && message.result?.trim()) {
          send({ type: "delta", text: message.result });
        }
      } else {
        send({ type: "error", message: `Local Claude app run ended: ${message.subtype}` });
      }
    }
  }
}
