import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Agent SDK spawns the local Claude Code CLI; keep it out of the bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
