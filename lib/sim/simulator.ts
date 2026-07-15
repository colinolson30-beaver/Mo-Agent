import { generateDistrict, districtCalendar } from "./district";
import type {
  ActionKind, Blacklist, Command, CommandState, Device, Group, Highlight, Plan, SimEvent, Stats,
} from "./types";

const CANARY_SIZE = 5;
const TICK_MS = 250;
// Demo clock: one fleet-hour in real milliseconds ("24 hours" ~= 2 minutes).
const MS_PER_HOUR = Number(process.env.FLEETPILOT_MS_PER_HOUR ?? 5000);

let planCounter = 0;
let cmdCounter = 0;

type Listener = (ev: SimEvent) => void;

export class Simulator {
  readonly createdAt = Date.now();
  readonly calendar = districtCalendar(this.createdAt);
  devices: Map<string, Device>;
  groups: Map<string, Group>;
  plans = new Map<string, Plan>();
  commands = new Map<string, Command>();
  blacklists = new Map<string, Blacklist>();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval>;
  private lastHighlight: Highlight = { deviceIds: [], kind: "none" };

  constructor() {
    const { devices, groups } = generateDistrict(this.createdAt);
    this.devices = devices;
    this.groups = groups;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    // Don't keep the dev process alive just for the tick loop.
    if (typeof (this.timer as unknown as { unref?: () => void }).unref === "function") {
      (this.timer as unknown as { unref: () => void }).unref();
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: SimEvent) {
    for (const fn of this.listeners) {
      try { fn(ev); } catch { /* listener gone */ }
    }
  }

  snapshot() {
    return {
      devices: [...this.devices.values()],
      groups: [...this.groups.values()],
      stats: this.stats(),
      plans: [...this.plans.values()],
      highlight: this.lastHighlight,
    };
  }

  stats(): Stats {
    let online = 0, pending = 0, failed = 0;
    for (const d of this.devices.values()) {
      if (d.status === "online") online++;
      if (d.activeCommand) {
        if (d.activeCommand.state === "failed") failed++;
        else if (d.activeCommand.state !== "done") pending++;
      }
    }
    return { total: this.devices.size, online, pendingCommands: pending, failed };
  }

  setHighlight(deviceIds: string[], kind: Highlight["kind"]) {
    this.lastHighlight = { deviceIds, kind };
    this.emit({ highlight: this.lastHighlight });
  }

  // ---- Plans ----

  pendingPlan(): Plan | undefined {
    return [...this.plans.values()].find((p) => p.status === "pending");
  }

  registerPlan(action: ActionKind, label: string, payload: Record<string, unknown>, deviceIds: string[], groupNames: string[]): Plan {
    // At most one pending plan; a new one (or Cancel, or any new user message) discards it.
    const existing = this.pendingPlan();
    if (existing) this.cancelPlan(existing.id);
    const offline = deviceIds.filter((id) => this.devices.get(id)?.status !== "online");
    const plan: Plan = {
      id: `pln_${++planCounter}`,
      action, label, payload,
      deviceIds, groupNames,
      offlineDeviceIds: offline,
      status: "pending",
      createdAt: Date.now(),
    };
    this.plans.set(plan.id, plan);
    this.setHighlight(deviceIds, "plan");
    this.emit({ plans: [plan] });
    return plan;
  }

  cancelPlan(planId: string): Plan | undefined {
    const plan = this.plans.get(planId);
    if (!plan || plan.status !== "pending") return plan;
    plan.status = "cancelled";
    this.setHighlight([], "none");
    this.emit({ plans: [plan] });
    return plan;
  }

  approvePlan(planId: string): { ok: boolean; message: string; plan?: Plan } {
    const plan = this.plans.get(planId);
    if (!plan) return { ok: false, message: `Plan ${planId} not found.` };
    if (plan.status !== "pending") return { ok: false, message: `Plan ${planId} is ${plan.status}, not pending.` };

    this.setHighlight([], "none");
    const online = plan.deviceIds.filter((id) => this.devices.get(id)?.status === "online");
    const now = Date.now();

    // Offline devices: command queued for next check-in, no timed transitions.
    for (const id of plan.offlineDeviceIds) {
      this.createCommand(plan, id, now, true);
    }

    if (online.length === 0) {
      plan.status = "completed";
      plan.resultSummary = `All ${plan.deviceIds.length} target devices are offline; commands queued for next check-in.`;
      this.emit({ plans: [plan] });
      return { ok: true, message: plan.resultSummary, plan };
    }

    // Canary rollout is simulator policy, not agent logic: first 5 online
    // devices go first; fan-out launches only after all 5 reach done.
    const canary = online.slice(0, CANARY_SIZE);
    canary.forEach((id, i) => this.createCommand(plan, id, now + i * 450, false));
    plan.status = "executing_canary";
    this.emit({ plans: [plan], stats: this.stats() });
    return {
      ok: true,
      message: `Approved. Executing "${plan.label}" on ${plan.deviceIds.length} devices (${canary.length} canary first${plan.offlineDeviceIds.length ? `, ${plan.offlineDeviceIds.length} offline queued` : ""}).`,
      plan,
    };
  }

  private createCommand(plan: Plan, deviceId: string, startAt: number, waitingForCheckIn: boolean): Command {
    const cmd: Command = {
      id: `cmd_${++cmdCounter}`,
      planId: plan.id,
      deviceId,
      action: plan.action,
      label: plan.label,
      state: "queued",
      waitingForCheckIn,
      nextAt: waitingForCheckIn ? Number.POSITIVE_INFINITY : startAt,
    };
    this.commands.set(cmd.id, cmd);
    const d = this.devices.get(deviceId)!;
    d.activeCommand = { commandId: cmd.id, label: plan.label, state: "queued" };
    this.emit({ devices: [d] });
    return cmd;
  }

  // ---- Tick: the propagation wave ----

  private tick() {
    const now = Date.now();
    const dirtyDevices = new Map<string, Device>();
    const dirtyPlans = new Map<string, Plan>();

    for (const cmd of this.commands.values()) {
      if (cmd.state === "done" || cmd.state === "failed") continue;
      if (now < cmd.nextAt) continue;
      const device = this.devices.get(cmd.deviceId)!;
      const jitter = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

      if (cmd.state === "queued") {
        cmd.state = "pushed";
        cmd.nextAt = now + jitter(700, 1800);
      } else if (cmd.state === "pushed") {
        cmd.state = "acknowledged";
        cmd.nextAt = now + jitter(900, 2600);
      } else if (cmd.state === "acknowledged") {
        if (device.failInstallThenOffline && cmd.action === "install_app") {
          cmd.state = "failed";
          device.status = "offline"; // fails the install, then drops off the network
        } else {
          cmd.state = "done";
          this.applyEffect(cmd, device);
        }
      }
      device.activeCommand = { commandId: cmd.id, label: cmd.label, state: cmd.state };
      dirtyDevices.set(device.id, device);

      const plan = this.plans.get(cmd.planId);
      if (plan && (cmd.state === "done" || cmd.state === "failed")) {
        this.advancePlan(plan, now);
        dirtyPlans.set(plan.id, plan);
      }
    }

    // Timed deployments: fire scheduled removal sweeps whose demo-clock expiry passed.
    for (const plan of this.plans.values()) {
      if (plan.removalScheduledAt && !plan.removalFired && now >= plan.removalScheduledAt) {
        plan.removalFired = true;
        const removal = this.fireScheduledRemoval(plan, now);
        dirtyPlans.set(plan.id, plan);
        if (removal) dirtyPlans.set(removal.id, removal);
      }
    }

    if (dirtyDevices.size || dirtyPlans.size) {
      this.emit({
        devices: [...dirtyDevices.values()],
        plans: [...dirtyPlans.values()],
        stats: this.stats(),
      });
    }
  }

  private fireScheduledRemoval(parent: Plan, now: number): Plan | undefined {
    const app = String(parent.payload.app_name ?? "");
    const targets = parent.deviceIds.filter((id) => {
      const d = this.devices.get(id);
      return d?.status === "online" && d.apps.some((a) => a.toLowerCase() === app.toLowerCase());
    });
    const plan: Plan = {
      id: `pln_${++planCounter}`,
      action: "remove_app",
      label: `Remove ${app} (scheduled)`,
      payload: { app_name: app },
      deviceIds: targets,
      groupNames: parent.groupNames,
      offlineDeviceIds: [],
      status: "executing_fanout",
      createdAt: now,
      parentPlanId: parent.id,
    };
    this.plans.set(plan.id, plan);
    if (targets.length === 0) {
      plan.status = "completed";
      plan.resultSummary = `No devices still had ${app} installed; nothing to remove.`;
      return plan;
    }
    // Removal was pre-approved as part of the timed deployment: fan out directly.
    const span = Math.min(12_000, Math.max(4_000, targets.length * 300));
    targets.forEach((id, i) => {
      this.createCommand(plan, id, now + (i / Math.max(1, targets.length - 1)) * span * (0.85 + Math.random() * 0.3), false);
    });
    return plan;
  }

  private applyEffect(cmd: Command, device: Device) {
    if (cmd.action === "install_app") {
      const app = String((this.plans.get(cmd.planId)?.payload.app_name as string) ?? cmd.label);
      if (!device.apps.includes(app)) device.apps.push(app);
    } else if (cmd.action === "remove_app") {
      const app = String((this.plans.get(cmd.planId)?.payload.app_name as string) ?? "");
      device.apps = device.apps.filter((a) => a.toLowerCase() !== app.toLowerCase());
    } else if (cmd.action === "push_content_filter") {
      const payload = this.plans.get(cmd.planId)?.payload ?? {};
      device.contentFilter = {
        name: String(payload.blacklist_name ?? "Content Filter"),
        urlCount: Number(payload.url_count ?? 0),
      };
    } else if (cmd.action === "lock_device") {
      device.locked = true;
    } else if (cmd.action === "erase_device") {
      device.apps = [];
      device.locked = true;
      delete device.contentFilter;
    }
    // push_profile / send_message: no lasting visible state beyond the green sweep
  }

  private advancePlan(plan: Plan, now: number) {
    const cmds = [...this.commands.values()].filter((c) => c.planId === plan.id);
    const active = cmds.filter((c) => !c.waitingForCheckIn);
    const terminal = active.filter((c) => c.state === "done" || c.state === "failed");

    if (plan.status === "executing_canary" && terminal.length >= Math.min(CANARY_SIZE, active.length)) {
      const canaryFailed = terminal.some((c) => c.state === "failed");
      if (canaryFailed) {
        plan.status = "paused_canary_failure";
        plan.resultSummary = "Canary verification failed; rollout paused before fan-out.";
        return;
      }
      // Verify passed -> fan out the rest, staggered ~15s across the wave.
      const remaining = plan.deviceIds.filter(
        (id) => !cmds.some((c) => c.deviceId === id) && this.devices.get(id)?.status === "online",
      );
      if (remaining.length > 0) {
        const span = Math.min(15_000, Math.max(6_000, remaining.length * 350));
        remaining.forEach((id, i) => {
          this.createCommand(plan, id, now + (i / Math.max(1, remaining.length - 1)) * span * (0.85 + Math.random() * 0.3), false);
        });
        plan.status = "executing_fanout";
        return;
      }
      plan.status = "executing_fanout"; // nothing left; completion check below
    }

    if (plan.status === "executing_fanout" || plan.status === "executing_canary") {
      const all = [...this.commands.values()].filter((c) => c.planId === plan.id && !c.waitingForCheckIn);
      const covered = new Set(all.map((c) => c.deviceId));
      const everyTargeted = plan.deviceIds.every(
        (id) => covered.has(id) || plan.offlineDeviceIds.includes(id),
      );
      if (everyTargeted && all.every((c) => c.state === "done" || c.state === "failed")) {
        const failed = all.filter((c) => c.state === "failed");
        plan.status = "completed";
        const failedNames = failed.map((c) => this.devices.get(c.deviceId)!.name);
        plan.resultSummary =
          `${all.length - failed.length}/${plan.deviceIds.length} succeeded` +
          (failed.length ? `; ${failed.length} FAILED (${failedNames.join(", ")})` : "") +
          (plan.offlineDeviceIds.length ? `; ${plan.offlineDeviceIds.length} offline, queued for next check-in` : "") +
          ".";
        // Timed deployment: schedule the removal sweep on the demo clock.
        const hours = Number(plan.payload.remove_after_hours ?? 0);
        if (plan.action === "install_app" && hours > 0 && !plan.removalScheduledAt) {
          plan.removalScheduledAt = now + hours * MS_PER_HOUR;
          plan.resultSummary += ` Successfully deployed — automatic removal scheduled in ${hours}h.`;
        }
      }
    }
  }

  // ---- Debug wave (zero AI): tune the choreography, demo-day fallback ----

  debugWave(appName = "Google Chrome 126", removeAfterHours?: number): Plan {
    const targets = [...(this.groups.get("G6-C1")?.deviceIds ?? []), ...(this.groups.get("G6-C2")?.deviceIds ?? [])];
    const label = `Install ${appName} (debug wave)` + (removeAfterHours ? ` — auto-remove after ${removeAfterHours}h` : "");
    const payload: Record<string, unknown> = { app_name: appName };
    if (removeAfterHours) payload.remove_after_hours = removeAfterHours;
    const plan = this.registerPlan("install_app", label, payload, targets, ["G6-C1", "G6-C2"]);
    this.approvePlan(plan.id);
    return plan;
  }
}

// Singleton on globalThis so Next.js HMR/module re-instantiation can't wipe
// fleet state or double-register the tick timer.
const g = globalThis as unknown as { __fleetpilotSim?: Simulator };

export function getSimulator(): Simulator {
  if (!g.__fleetpilotSim) g.__fleetpilotSim = new Simulator();
  return g.__fleetpilotSim;
}
