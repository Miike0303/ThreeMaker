import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { ProjectSession } from './project-session.js';

const worldValueSchema = z.union([z.boolean(), z.number(), z.string()]);

function textResult(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function createServer(): McpServer {
  const session = new ProjectSession();
  const server = new McpServer({ name: 'threemaker', version: '0.1.0' });

  server.registerTool(
    'open_project',
    {
      description:
        'Open a local ThreeMaker project directory and load .tmmap.json maps into memory.',
      inputSchema: z.object({
        rootPath: z
          .string()
          .min(1)
          .describe('Absolute or relative path to a directory of .tmmap.json files'),
      }),
    },
    async ({ rootPath }) => {
      try {
        return textResult(session.openProject(rootPath));
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  server.registerTool(
    'list_maps',
    {
      description: 'List maps currently loaded in the MCP project session.',
      inputSchema: z.object({}),
    },
    async () => textResult(session.listMaps()),
  );

  server.registerTool(
    'create_map',
    {
      description: 'Create a blank map document in the current MCP session.',
      inputSchema: z.object({
        relativePath: z
          .string()
          .min(1)
          .describe('Map path relative to the project root, e.g. demo/forest'),
        id: z.string().min(1),
        name: z.string().min(1),
        width: z.number().int().min(1).max(512),
        height: z.number().int().min(1).max(512),
      }),
    },
    async (input) => {
      try {
        return textResult(session.createMap(input));
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  server.registerTool(
    'get_world_state',
    {
      description: 'Read the runtime world-state snapshot for a loaded map.',
      inputSchema: z.object({
        relativePath: z.string().min(1),
      }),
    },
    async ({ relativePath }) => {
      try {
        return textResult(session.getWorldState(relativePath));
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  server.registerTool(
    'set_world_state',
    {
      description: 'Set one world-state key for a loaded map and return the updated snapshot.',
      inputSchema: z.object({
        relativePath: z.string().min(1),
        key: z.string().min(1),
        value: worldValueSchema,
      }),
    },
    async ({ relativePath, key, value }) => {
      try {
        return textResult(session.setWorldState(relativePath, key, value));
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  server.registerTool(
    'add_event',
    {
      description: 'Attach or replace an authored event script on a loaded map document.',
      inputSchema: z.object({
        relativePath: z.string().min(1),
        eventKey: z.string().min(1),
        commands: z.array(z.record(z.string(), z.unknown())).min(1),
      }),
    },
    async ({ relativePath, eventKey, commands }) => {
      try {
        return textResult(session.addEvent(relativePath, eventKey, commands));
      } catch (error) {
        return textResult({ error: error instanceof Error ? error.message : String(error) }, true);
      }
    },
  );

  return server;
}

void serveStdio(createServer);
console.error('ThreeMaker MCP server running on stdio');
