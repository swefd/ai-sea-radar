import type { NextConfig } from 'next';

// agentRules: false stops `next dev` from appending a managed
// "nextjs-agent-rules" block to this repository's hand-written CLAUDE.md.
// `next build` never does this, and AGENTS.md is only scaffolded when
// neither file exists.
const nextConfig: NextConfig = {
  agentRules: false,
};

export default nextConfig;
