import { mulberry32 } from "./rng";
import type { Device, Group } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;

// District calendar is generated relative to run time so beat 1 ("since
// spring break") never goes stale. The agent's system prompt gets these dates.
export function districtCalendar(now: number) {
  const springBreakStart = now - 25 * DAY;
  const springBreakEnd = now - 18 * DAY;
  return { springBreakStart, springBreakEnd };
}

const BASE_APPS = ["Safari", "GoGuardian", "Self Service"];
const EXTRA_APPS = ["Notability", "GarageBand", "iMovie", "Keynote", "Pages"];
const OS_VERSIONS = ["macOS 15.5", "macOS 15.4", "macOS 14.7"];

interface CartSpec {
  name: string;
  school: string;
  size: number;
  room: string;
  aliases: string[];
}

export function generateDistrict(now: number): { devices: Map<string, Device>; groups: Map<string, Group> } {
  const rand = mulberry32(42);
  const { springBreakStart } = districtCalendar(now);
  const devices = new Map<string, Device>();
  const groups = new Map<string, Group>();

  const carts: CartSpec[] = [
    { name: "G3-C1", school: "Maplewood Elementary", size: 16, room: "Room 104", aliases: ["grade 3 cart 1", "3rd grade cart"] },
    { name: "G4-C1", school: "Maplewood Elementary", size: 16, room: "Room 108", aliases: ["grade 4 cart 1", "4th grade cart"] },
    { name: "G5-C1", school: "Maplewood Elementary", size: 16, room: "Room 110", aliases: ["grade 5 cart 1", "5th grade cart 1"] },
    { name: "G5-C2", school: "Maplewood Elementary", size: 16, room: "Room 111", aliases: ["grade 5 cart 2", "5th grade cart 2"] },
    { name: "G6-C1", school: "Maplewood Elementary", size: 16, room: "Room 112", aliases: ["grade 6 cart 1", "6th grade cart 1", "6th grade carts", "6th grade cart"] },
    { name: "G6-C2", school: "Maplewood Elementary", size: 16, room: "Room 114", aliases: ["grade 6 cart 2", "6th grade cart 2", "6th grade carts", "6th grade cart"] },
    { name: "LN-C1", school: "Lincoln Middle", size: 20, room: "Room 201", aliases: ["lincoln cart 1"] },
    { name: "LN-C2", school: "Lincoln Middle", size: 20, room: "Room 204", aliases: ["lincoln cart 2"] },
    { name: "LN-C3", school: "Lincoln Middle", size: 20, room: "Room 209", aliases: ["lincoln cart 3"] },
    { name: "LN-C4", school: "Lincoln Middle", size: 20, room: "Room 212", aliases: ["lincoln cart 4"] },
    { name: "RH-C1", school: "Roosevelt High", size: 26, room: "Room 301", aliases: ["roosevelt cart 1"] },
    { name: "RH-C2", school: "Roosevelt High", size: 26, room: "Room 305", aliases: ["roosevelt cart 2"] },
    { name: "RH-C3", school: "Roosevelt High", size: 26, room: "Room 310", aliases: ["roosevelt cart 3"] },
    { name: "RH-C4", school: "Roosevelt High", size: 26, room: "Room 314", aliases: ["roosevelt cart 4"] },
    { name: "RH-C5", school: "Roosevelt High", size: 26, room: "Library", aliases: ["roosevelt cart 5", "library cart"] },
    { name: "RH-C6", school: "Roosevelt High", size: 26, room: "Science Wing", aliases: ["roosevelt cart 6", "science cart"] },
  ];

  const addDevice = (d: Device) => devices.set(d.id, d);

  for (const cart of carts) {
    const ids: string[] = [];
    for (let i = 1; i <= cart.size; i++) {
      const name = `${cart.name}-${String(i).padStart(2, "0")}`;
      const id = name;
      ids.push(id);
      const extra = EXTRA_APPS.filter(() => rand() < 0.3);
      addDevice({
        id,
        name,
        school: cart.school,
        group: cart.name,
        room: cart.room,
        status: "online",
        lastCheckIn: now - rand() * 36 * HOUR,
        os: OS_VERSIONS[Math.floor(rand() * OS_VERSIONS.length)],
        apps: [...BASE_APPS, ...extra],
        locked: false,
      });
    }
    // Teachers say "class" as often as "cart" — mirror every cart alias.
    const aliases = [...cart.aliases, ...cart.aliases.map((a) => a.replace("cart", "class"))];
    groups.set(cart.name, { name: cart.name, school: cart.school, kind: "cart", room: cart.room, deviceIds: ids, aliases });
  }

  // Roosevelt staff: 180 one-to-one MacBooks
  const staffIds: string[] = [];
  for (let i = 1; i <= 180; i++) {
    const name = `RH-ST-${String(i).padStart(3, "0")}`;
    staffIds.push(name);
    addDevice({
      id: name,
      name,
      school: "Roosevelt High",
      group: "RH-STAFF",
      room: "Staff 1:1",
      status: "online",
      lastCheckIn: now - rand() * 24 * HOUR,
      os: OS_VERSIONS[Math.floor(rand() * OS_VERSIONS.length)],
      apps: [...BASE_APPS, "Keynote", "Pages"],
      locked: false,
    });
  }
  groups.set("RH-STAFF", {
    name: "RH-STAFF", school: "Roosevelt High", kind: "staff", room: "Staff 1:1",
    deviceIds: staffIds, aliases: ["roosevelt staff", "staff laptops", "teacher laptops"],
  });

  // ---- Beat seeds ----

  // Beat 1: 23 stragglers since spring break — 19 in LN-C3 (powered-off cart) + 4 staff loaners.
  const lnc3 = groups.get("LN-C3")!;
  lnc3.deviceIds.slice(0, 19).forEach((id) => {
    const d = devices.get(id)!;
    d.status = "offline";
    d.lastCheckIn = springBreakStart + rand() * 2 * DAY; // last seen just before/at start of break
  });
  ["RH-ST-041", "RH-ST-087", "RH-ST-122", "RH-ST-166"].forEach((id) => {
    const d = devices.get(id)!;
    d.status = "offline";
    d.lastCheckIn = springBreakStart - rand() * 3 * DAY; // loaners, out even earlier
  });

  // Beat 2: Chrome must be missing on the G6 carts so the push is meaningful.
  for (const g of ["G6-C1", "G6-C2"]) {
    for (const id of groups.get(g)!.deviceIds) {
      const d = devices.get(id)!;
      d.apps = d.apps.filter((a) => a !== "Google Chrome");
    }
  }

  // Beat 4: 3 fan-out-phase devices in Room 114 (G6-C2), never the canary set
  // (canary = first 5 online devices of the plan; these are positions 10-12).
  ["G6-C2-10", "G6-C2-11", "G6-C2-12"].forEach((id) => {
    devices.get(id)!.failInstallThenOffline = true;
  });

  return { devices, groups };
}
