export type DeviceStatus = "online" | "offline";

// queued -> pushed -> acknowledged -> done | failed
export type CommandState = "queued" | "pushed" | "acknowledged" | "done" | "failed";

export type ActionKind =
  | "install_app"
  | "remove_app"
  | "push_profile"
  | "lock_device"
  | "send_message"
  | "erase_device";

export interface Device {
  id: string;
  name: string;
  school: string;
  group: string;
  room: string;
  status: DeviceStatus;
  lastCheckIn: number; // epoch ms
  os: string;
  apps: string[];
  locked: boolean;
  // Beat 4 seed: acks and fails the first install, then stops checking in,
  // so the retry sits queued. The only bespoke seed behavior in the district.
  failInstallThenOffline?: boolean;
  activeCommand?: { commandId: string; label: string; state: CommandState };
}

export interface Group {
  name: string;
  school: string;
  kind: "cart" | "staff";
  room: string;
  deviceIds: string[];
  aliases: string[];
}

export type PlanStatus =
  | "pending"
  | "executing_canary"
  | "executing_fanout"
  | "paused_canary_failure"
  | "completed"
  | "cancelled";

export interface Plan {
  id: string;
  action: ActionKind;
  label: string; // e.g. "Install Google Chrome 126"
  payload: Record<string, unknown>;
  deviceIds: string[];
  groupNames: string[];
  offlineDeviceIds: string[];
  status: PlanStatus;
  createdAt: number;
  resultSummary?: string;
  // Timed deployments: when set, a removal sweep fires at this epoch ms
  // (fleet-hours run on a compressed demo clock).
  removalScheduledAt?: number;
  removalFired?: boolean;
  parentPlanId?: string;
}

export interface Command {
  id: string;
  planId: string;
  deviceId: string;
  action: ActionKind;
  label: string;
  state: CommandState;
  waitingForCheckIn: boolean;
  nextAt: number; // epoch ms of next state transition; Infinity = waiting
}

export interface Stats {
  total: number;
  online: number;
  pendingCommands: number;
  failed: number;
}

export interface Highlight {
  deviceIds: string[];
  kind: "info" | "plan" | "danger" | "none";
}

export interface SimEvent {
  devices?: Device[];
  plans?: Plan[];
  stats?: Stats;
  highlight?: Highlight;
}
