import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = process.env.HSP_MCP_URL ?? 'https://mcp-qa.hashkeymerchant.com/';
const root = process.cwd();
const outputDirectory = path.join(root, 'docs');
const outputPath = path.join(outputDirectory, 'live-schemas.json');

async function main(): Promise<void> {
  const client = new Client({
    name: 'hsp-a2a-firewall',
    version: '0.1.0',
  });
  const transport = new StreamableHTTPClientTransport(new URL(url));

  try {
    await client.connect(transport);
    const listed = await client.listTools();

    const dump = {
      fetchedAt: new Date().toISOString(),
      url,
      tools: listed.tools,
    };

    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(dump, null, 2)}\n`, 'utf8');

    console.log(
      `Dumped ${listed.tools.length} tool schema(s) -> ${path.relative(root, outputPath)}`,
    );
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Failed to dump HSP MCP schemas:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
