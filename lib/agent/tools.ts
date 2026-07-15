import type Anthropic from "@anthropic-ai/sdk";
import { getSimulator, Simulator } from "@/lib/sim/simulator";
import type { ActionKind, Device, Plan } from "@/lib/sim/types";

const DAY = 86_400_000;

// ---------- Tool schemas ----------

const TARGET_SCHEMA = {
  type: "object" as const,
  description:
    "Which devices this applies to. Provide at least one of: group_names, school, device_ids, or scope:'district'.",
  properties: {
    group_names: { type: "array", items: { type: "string" }, description: "Group names, e.g. ['G6-C1','G6-C2']. Fuzzy names like '6th grade carts' also resolve." },
    school: { type: "string", description: "All devices at a school, e.g. 'Lincoln Middle'." },
    device_ids: { type: "array", items: { type: "string" }, description: "Specific device IDs, e.g. ['G6-C2-10']." },
    scope: { type: "string", enum: ["district"], description: "Every device in the district." },
  },
};

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_devices",
    description:
      "Search the fleet. Call this for any question about devices (check-ins, apps, status). Matching devices are highlighted on the fleet board automatically.",
    input_schema: {
      type: "object",
      properties: {
        group_name: { type: "string", description: "Filter to one group (fuzzy names OK)." },
        school: { type: "string" },
        status: { type: "string", enum: ["online", "offline"] },
        not_checked_in_days: { type: "number", description: "Devices whose last check-in is older than N days." },
        has_app: { type: "string", description: "Devices that HAVE this app installed." },
        missing_app: { type: "string", description: "Devices MISSING this app." },
        locked: { type: "boolean" },
      },
    },
  },
  {
    name: "list_groups",
    description: "List every device group (carts and staff sets) with school, room, and device counts. Call this first when unsure of exact group names.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_device",
    description: "Full detail for one device by ID.",
    input_schema: { type: "object", properties: { device_id: { type: "string" } }, required: ["device_id"] },
  },
  {
    name: "get_command_status",
    description: "Status of a plan's rollout: per-state counts, failed devices with names/rooms, offline-queued devices. Call after a push to check how it went.",
    input_schema: { type: "object", properties: { plan_id: { type: "string", description: "Omit to get the most recent plan." } } },
  },
  {
    name: "install_app",
    description:
      "Install an app on target devices. Registers a plan requiring human approval; nothing executes until the user clicks Approve. Supports timed deployments: set remove_after_hours to automatically remove the app after N fleet-hours (e.g. 'push Kahoot for 24 hours').",
    input_schema: {
      type: "object",
      properties: {
        app_name: { type: "string", description: "e.g. 'Google Chrome', 'Kahoot'" },
        target: TARGET_SCHEMA,
        remove_after_hours: { type: "number", description: "Optional. Automatically remove the app this many hours after a successful deploy. The removal is covered by the same approval." },
      },
      required: ["app_name", "target"],
    },
  },
  {
    name: "push_profile",
    description: "Push a configuration profile (e.g. content filter, Wi-Fi, restrictions) to target devices. Registers a plan requiring human approval.",
    input_schema: {
      type: "object",
      properties: { profile_name: { type: "string", description: "e.g. 'CIPA Content Filter'" }, target: TARGET_SCHEMA },
      required: ["profile_name", "target"],
    },
  },
  {
    name: "lock_device",
    description: "Remote-lock target devices (lost/stolen). Registers a plan requiring human approval. Refused outright at fleet-wide scope.",
    input_schema: {
      type: "object",
      properties: { target: TARGET_SCHEMA, message: { type: "string", description: "Message shown on the lock screen." } },
      required: ["target"],
    },
  },
  {
    name: "send_message",
    description: "Send an on-screen message to target devices. Registers a plan requiring human approval.",
    input_schema: {
      type: "object",
      properties: { target: TARGET_SCHEMA, message: { type: "string" } },
      required: ["target", "message"],
    },
  },
  {
    name: "erase_device",
    description: "Factory-erase target devices. DESTRUCTIVE. Single group: registers a plan requiring human approval. Multi-group or fleet-wide: refused by policy (the refusal shows the blast radius).",
    input_schema: { type: "object", properties: { target: TARGET_SCHEMA }, required: ["target"] },
  },
];

// ---------- Target resolution ----------

interface Target {
  group_names?: string[];
  school?: string;
  device_ids?: string[];
  scope?: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveGroups(sim: Simulator, names: string[]): string[] {
  const found = new Set<string>();
  for (const raw of names) {
    const n = norm(raw);
    for (const g of sim.groups.values()) {
      const candidates = [g.name, ...g.aliases, `${g.school} ${g.name}`];
      if (candidates.some((c) => norm(c) === n || norm(c).includes(n) || n.includes(norm(g.name)))) {
        found.add(g.name);
      }
    }
  }
  return [...found];
}

function resolveTarget(sim: Simulator, target: Target): { deviceIds: string[]; groupNames: string[]; error?: string } {
  const deviceIds = new Set<string>();
  const groupNames = new Set<string>();

  if (target.scope === "district") {
    for (const d of sim.devices.values()) deviceIds.add(d.id);
    for (const gname of sim.groups.keys()) groupNames.add(gname);
  }
  if (target.school) {
    const school = [...sim.groups.values()].filter((g) => norm(g.school).includes(norm(target.school!)));
    for (const g of school) {
      groupNames.add(g.name);
      g.deviceIds.forEach((id) => deviceIds.add(id));
    }
  }
  if (target.group_names?.length) {
    const resolved = resolveGroups(sim, target.group_names);
    if (resolved.length === 0) {
      return { deviceIds: [], groupNames: [], error: `No groups matched ${JSON.stringify(target.group_names)}. Call list_groups for exact names.` };
    }
    for (const gname of resolved) {
      groupNames.add(gname);
      sim.groups.get(gname)!.deviceIds.forEach((id) => deviceIds.add(id));
    }
  }
  if (target.device_ids?.length) {
    for (const id of target.device_ids) {
      const d = sim.devices.get(id.toUpperCase()) ?? sim.devices.get(id);
      if (d) {
        deviceIds.add(d.id);
        groupNames.add(d.group);
      }
    }
  }
  if (deviceIds.size === 0) {
    return { deviceIds: [], groupNames: [], error: "Target resolved to zero devices. Call list_groups or search_devices to find valid targets." };
  }
  return { deviceIds: [...deviceIds], groupNames: [...groupNames] };
}

// ---------- Guardrail policy (enforced HERE, in the executor — not the prompt) ----------
// Taxonomy: a group is a cart or staff set. Precedence: fleet-wide (>50% of
// district) is evaluated FIRST and wins regardless of group count.

function evaluatePolicy(sim: Simulator, action: ActionKind, deviceIds: string[], groupCount: number): "plan" | "refuse" {
  const fleetWide = deviceIds.length > sim.devices.size / 2;
  if (action === "erase_device") return fleetWide || groupCount > 1 ? "refuse" : "plan";
  if (action === "lock_device") return fleetWide ? "refuse" : "plan";
  return "plan"; // install_app, push_profile, send_message
}

const ELEVATION_TEXT =
  "In a production deployment this action would require elevated confirmation: a typed device-count confirmation plus a break-glass admin credential. This demo deliberately has no elevation path.";

// ---------- Executor ----------

function deviceBrief(d: Device) {
  return {
    id: d.id, name: d.name, group: d.group, school: d.school, room: d.room,
    status: d.status, locked: d.locked,
    last_check_in: new Date(d.lastCheckIn).toISOString(),
    days_since_check_in: Math.round((Date.now() - d.lastCheckIn) / DAY * 10) / 10,
    os: d.os, apps: d.apps,
  };
}

function blastRadius(sim: Simulator, deviceIds: string[], groupNames: string[]) {
  const bandwidthGb = Math.round(deviceIds.length * 0.28 * 10) / 10;
  return {
    device_count: deviceIds.length,
    group_count: groupNames.length,
    groups: groupNames,
    share_of_district: `${Math.round((deviceIds.length / sim.devices.size) * 100)}%`,
    est_bandwidth_gb: bandwidthGb,
  };
}

function labelFor(action: ActionKind, input: Record<string, unknown>): string {
  switch (action) {
    case "install_app":
      return `Install ${input.app_name}` + (input.remove_after_hours ? ` — auto-remove after ${input.remove_after_hours}h` : "");
    case "push_profile": return `Push profile: ${input.profile_name}`;
    case "lock_device": return "Remote lock";
    case "send_message": return "Send on-screen message";
    case "erase_device": return "FACTORY ERASE";
    default: return action;
  }
}

export function executeTool(name: string, rawInput: unknown): string {
  const sim = getSimulator();
  const input = (rawInput ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "list_groups": {
        const groups = [...sim.groups.values()].map((g) => ({
          name: g.name, school: g.school, kind: g.kind, room: g.room,
          device_count: g.deviceIds.length,
          online: g.deviceIds.filter((id) => sim.devices.get(id)!.status === "online").length,
        }));
        return JSON.stringify({ total_devices: sim.devices.size, groups });
      }

      case "get_device": {
        const d = sim.devices.get(String(input.device_id).toUpperCase()) ?? sim.devices.get(String(input.device_id));
        if (!d) return JSON.stringify({ error: `Device ${input.device_id} not found.` });
        sim.setHighlight([d.id], "info");
        return JSON.stringify(deviceBrief(d));
      }

      case "search_devices": {
        let results = [...sim.devices.values()];
        if (input.group_name) {
          const gs = new Set(resolveGroups(sim, [String(input.group_name)]));
          results = results.filter((d) => gs.has(d.group));
        }
        if (input.school) results = results.filter((d) => norm(d.school).includes(norm(String(input.school))));
        if (input.status) results = results.filter((d) => d.status === input.status);
        if (typeof input.not_checked_in_days === "number") {
          results = results.filter((d) => Date.now() - d.lastCheckIn > (input.not_checked_in_days as number) * DAY);
        }
        if (input.has_app) results = results.filter((d) => d.apps.some((a) => norm(a).includes(norm(String(input.has_app)))));
        if (input.missing_app) results = results.filter((d) => !d.apps.some((a) => norm(a).includes(norm(String(input.missing_app)))));
        if (typeof input.locked === "boolean") results = results.filter((d) => d.locked === input.locked);

        if (results.length > 0 && results.length <= 120) sim.setHighlight(results.map((d) => d.id), "info");

        const byGroup: Record<string, number> = {};
        for (const d of results) byGroup[d.group] = (byGroup[d.group] ?? 0) + 1;
        return JSON.stringify({
          count: results.length,
          by_group: byGroup,
          devices: results.slice(0, 30).map(deviceBrief),
          truncated: results.length > 30,
          note: results.length > 0 && results.length <= 120 ? "These devices are now highlighted on the fleet board." : undefined,
        });
      }

      case "get_command_status": {
        const plan: Plan | undefined = input.plan_id
          ? sim.plans.get(String(input.plan_id))
          : [...sim.plans.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!plan) return JSON.stringify({ error: "No plans found." });
        const cmds = [...sim.commands.values()].filter((c) => c.planId === plan.id);
        const byState: Record<string, number> = {};
        for (const c of cmds) byState[c.waitingForCheckIn ? "queued_offline" : c.state] = (byState[c.waitingForCheckIn ? "queued_offline" : c.state] ?? 0) + 1;
        const failed = cmds.filter((c) => c.state === "failed").map((c) => {
          const d = sim.devices.get(c.deviceId)!;
          return { id: d.id, name: d.name, group: d.group, room: d.room, device_status_now: d.status };
        });
        return JSON.stringify({
          plan_id: plan.id, label: plan.label, status: plan.status,
          target_devices: plan.deviceIds.length, by_state: byState,
          failed_devices: failed, result_summary: plan.resultSummary,
          scheduled_removal: plan.removalScheduledAt
            ? { fires_at: new Date(plan.removalScheduledAt).toISOString(), fired: !!plan.removalFired }
            : undefined,
        });
      }

      case "install_app":
      case "push_profile":
      case "lock_device":
      case "send_message":
      case "erase_device": {
        const action = name as ActionKind;
        const { deviceIds, groupNames, error } = resolveTarget(sim, (input.target ?? {}) as Target);
        if (error) return JSON.stringify({ error });

        const radius = blastRadius(sim, deviceIds, groupNames);
        const verdict = evaluatePolicy(sim, action, deviceIds, groupNames.length);

        if (verdict === "refuse") {
          // Refuse cell: NO plan registered; light up the full blast radius so
          // the room sees exactly what was just declined.
          sim.setHighlight(deviceIds, "danger");
          return JSON.stringify({
            refused: true,
            action,
            blast_radius: radius,
            reason: `Policy: ${action} at this scope (${radius.device_count} devices, ${radius.group_count} groups, ${radius.share_of_district} of the district) is refused without elevation.`,
            elevation_text: ELEVATION_TEXT,
            note: "The affected devices are highlighted in red on the fleet board. Explain the refusal to the user plainly.",
          });
        }

        const label = labelFor(action, input);
        const plan = sim.registerPlan(action, label, input, deviceIds, groupNames);
        return JSON.stringify({
          plan_id: plan.id,
          requires_approval: true,
          label,
          blast_radius: radius,
          offline_devices_queued: plan.offlineDeviceIds.length,
          rollout: `${Math.min(5, deviceIds.length)} canary devices first, verify, then fan out`,
          note: "Plan registered and shown to the user as an approval card; targets are highlighted amber on the board. NOTHING has executed. Do not claim execution — tell the user to review and approve the card.",
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: `Tool execution error: ${err instanceof Error ? err.message : String(err)}` });
  }
}
