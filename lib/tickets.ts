export interface Ticket {
  id: number;
  title: string;
  submitter: string;
  priority: "high" | "medium" | "low";
  prompt: string;
}

export type TicketStatus = "open" | "in-progress" | "resolved" | "blocked";

export const TICKETS: Ticket[] = [
  {
    id: 1,
    title: "Devices offline since spring break",
    submitter: "Lincoln Middle · IT",
    priority: "high",
    prompt: "Which devices haven't checked in since spring break?",
  },
  {
    id: 2,
    title: "Chrome missing on 6th grade MacBooks",
    submitter: "Maplewood Elementary · Mrs. Torres",
    priority: "high",
    prompt: "Push Google Chrome to the 6th grade carts",
  },
  {
    id: 3,
    title: "Lost MacBook — Room 110",
    submitter: "Maplewood Elementary · Ms. Park",
    priority: "medium",
    prompt: "Lock device G5-C1-07, it's been reported lost",
  },
  {
    id: 4,
    title: "Push new district WiFi profile to Lincoln",
    submitter: "District IT · Admin",
    priority: "medium",
    prompt: "Push the district WiFi profile to all Lincoln Middle devices",
  },
  {
    id: 5,
    title: "EOY: Factory reset entire district fleet",
    submitter: "Superintendent · Dr. Nguyen",
    priority: "low",
    prompt: "Wipe every device in the district for end of year",
  },
];
