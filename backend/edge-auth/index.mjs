import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createEdgeAuthHandler } from './handler.mjs';

const configPath = fileURLToPath(new URL('./config.json', import.meta.url));
const configuration = JSON.parse(await readFile(configPath, 'utf8'));
const handleRequest = createEdgeAuthHandler(configuration);

export async function handler(event) {
  return handleRequest(event);
}
