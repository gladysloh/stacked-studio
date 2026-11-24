import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readJson } from './fsutil.mjs';
import { OPS, runOp } from './ops.mjs';
import { repoRoot } from './paths.mjs';

// The studio's only MCP server: every operation in ops.mjs, nothing more. stdout belongs to the
// protocol, so nothing here prints.

const version = readJson(`${repoRoot}/package.json`, {}).version ?? '0.0.0';

export const INSTRUCTIONS =
  'stacked-studio: creative production tools. Call studio_capabilities to see skills (research, concepts, images, edits, product shots, video, campaign, QA) and read the one that fits. ' +
  'Work without a client unless one is named. Before making work for a client, call client_context. Make and change images only with image_generate / image_edit, so history is kept. ' +
  'Approvals are the person\'s decision.';

export function createServer() {
  const server = new McpServer({ name: 'stacked-studio', version }, { instructions: INSTRUCTIONS });
  for (const [name, op] of Object.entries(OPS)) {
    server.registerTool(name, { title: op.title, description: op.description, inputSchema: op.input }, async (args) => {
      try {
        const result = await runOp(name, args ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.fix ? `${err.message}\nFix: ${err.fix}` : err.message }] };
      }
    });
  }
  return server;
}

export async function startMcp() {
  await createServer().connect(new StdioServerTransport());
}
