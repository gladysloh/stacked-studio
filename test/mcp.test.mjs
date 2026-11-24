import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { repo, tempStudio } from './helpers.mjs';

let t;
beforeEach(() => (t = tempStudio()));
afterEach(() => t.cleanup());

async function connect() {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(repo, 'bin/studio.mjs'), 'mcp'], env: t.env, cwd: repo }));
  return client;
}
const body = (r) => JSON.parse(r.content[0].text);

test('one MCP server exposes the core operations; generate → edit → history → review', async () => {
  const c = await connect();
  try {
    const names = (await c.listTools()).tools.map((x) => x.name);
    for (const n of ['studio_capabilities', 'client_context', 'search', 'image_generate', 'image_edit', 'image_compare', 'history', 'review']) assert.ok(names.includes(n), n);
    const caps = body(await c.callTool({ name: 'studio_capabilities', arguments: {} }));
    assert.ok(caps.capabilities.some((s) => s.name === 'image-edit'));
    const skill = body(await c.callTool({ name: 'studio_capabilities', arguments: { name: 'product-shot' } }));
    assert.match(skill.instructions, /Product shots/);
    const a = body(await c.callTool({ name: 'image_generate', arguments: { prompt: 'jar', instruction: 'make a jar', n: 2 } }));
    assert.equal(a.outputs.length, 2);
    const b = body(await c.callTool({ name: 'image_edit', arguments: { id: a.id, output: 1, prompt: 'softer' } }));
    assert.equal(b.version, 2);
    const h = body(await c.callTool({ name: 'history', arguments: { id: b.id } }));
    assert.equal(h.versions.length, 2);
    const r = body(await c.callTool({ name: 'review', arguments: { id: b.id, action: 'approve' } }));
    assert.equal(r.outputs[0].status, 'approved');
    const bad = await c.callTool({ name: 'image_edit', arguments: { id: 'nope', prompt: 'x' } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /no image/);
  } finally {
    await c.close();
  }
});
