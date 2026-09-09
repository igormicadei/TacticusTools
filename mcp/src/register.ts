/**
 * One shape for every tool, so the handlers can return plain data.
 *
 * The protocol wants content blocks and signals failure with a flag rather than
 * an exception; every handler here would otherwise repeat the same wrapping and
 * the same try/catch. So they return a value or throw, and this turns either
 * into what the protocol expects — with the error's message preserved, since
 * "no unit called Tigirius, try list_roster" is the useful half of a failure.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShape } from 'zod';

export type Registrar = <Shape extends ZodRawShape>(
  name: string,
  description: string,
  schema: Shape,
  handler: (args: { [K in keyof Shape]: import('zod').infer<Shape[K]> }) => Promise<unknown>,
) => void;

export function registrarFor(server: McpServer): Registrar {
  return (name, description, schema, handler) => {
    server.registerTool(
      name,
      { description, inputSchema: schema },
      (async (args: Parameters<typeof handler>[0]) => {
        let text: string;
        let isError = false;
        try {
          text = JSON.stringify(await handler(args), null, 2) ?? 'null';
        } catch (error) {
          text = error instanceof Error ? error.message : String(error);
          isError = true;
        }
        return { isError, content: [{ type: 'text' as const, text }] };
      }) as Parameters<McpServer['registerTool']>[2],
    );
  };
}
