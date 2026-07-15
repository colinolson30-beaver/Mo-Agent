"use client";

import { create } from "zustand";
import type { Device, Group, Highlight, Plan, Stats } from "@/lib/sim/types";

interface FleetState {
  connected: boolean;
  devices: Record<string, Device>;
  groups: Group[];
  stats: Stats;
  plans: Record<string, Plan>;
  highlight: Highlight;
  pendingPrompt: string | null;
  setPendingPrompt: (p: string | null) => void;
  connect: () => void;
}

export const useFleet = create<FleetState>((set, get) => ({
  connected: false,
  devices: {},
  groups: [],
  stats: { total: 0, online: 0, pendingCommands: 0, failed: 0 },
  plans: {},
  highlight: { deviceIds: [], kind: "none" },
  pendingPrompt: null,
  setPendingPrompt: (p) => set({ pendingPrompt: p }),

  connect: () => {
    if (get().connected || typeof window === "undefined") return;
    set({ connected: true });
    const es = new EventSource("/api/events");
    es.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === "ping") return;

      if (data.type === "snapshot") {
        const devices: Record<string, Device> = {};
        for (const d of data.devices as Device[]) devices[d.id] = d;
        const plans: Record<string, Plan> = {};
        for (const p of data.plans as Plan[]) plans[p.id] = p;
        set({ devices, groups: data.groups, stats: data.stats, plans, highlight: data.highlight });
        return;
      }

      // delta
      set((state) => {
        const next: Partial<FleetState> = {};
        if (data.devices?.length) {
          const devices = { ...state.devices };
          for (const d of data.devices as Device[]) devices[d.id] = d;
          next.devices = devices;
        }
        if (data.plans?.length) {
          const plans = { ...state.plans };
          for (const p of data.plans as Plan[]) plans[p.id] = p;
          next.plans = plans;
        }
        if (data.stats) next.stats = data.stats;
        if (data.highlight) next.highlight = data.highlight;
        return next;
      });
    };
    es.onerror = () => {
      es.close();
      set({ connected: false });
      setTimeout(() => get().connect(), 2000);
    };
  },
}));
