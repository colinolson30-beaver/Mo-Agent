import { getSimulator } from "@/lib/sim/simulator";

export const dynamic = "force-dynamic";

// SSE stream: full snapshot on connect, then deltas from the simulator.
export async function GET() {
  const sim = getSimulator();
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          unsubscribe();
          if (ping) clearInterval(ping);
        }
      };
      send({ type: "snapshot", ...sim.snapshot() });
      unsubscribe = sim.subscribe((ev) => send({ type: "delta", ...ev }));
      ping = setInterval(() => send({ type: "ping" }), 15000);
    },
    cancel() {
      unsubscribe();
      if (ping) clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
