#!/usr/bin/env node
/**
 * An MCP server over Tacticus Tools.
 *
 * Everything the web app knows, for a caller that is not a browser: the game
 * database, the player's roster, and the calculations the two are put through
 * — the same functions the app's screens are built on, so an answer here and
 * the figure on the matching page are the same arithmetic.
 *
 * It keeps its own store rather than reading the app's, because the app keeps
 * everything in `localStorage` and no process outside that browser can see it.
 * The files use the app's shapes, so what is written here would load there.
 *
 * Configuration, all through the environment:
 *   TACTICUS_API_KEY     required by refresh_roster; read per call, never stored
 *   TACTICUS_RELAY_URL   optional; the API is called directly when unset
 *   TACTICUS_TOOLS_DATA  where to keep player.json, plans.json, teams.json
 *   TACTICUS_GAMEDATA    a gamedata.json to use instead of the bundled snapshot
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registrarFor } from './register.js';
import { registerCalcTools } from './tools/calc.js';
import { registerGameTools } from './tools/game.js';
import { registerPlayerTools } from './tools/player.js';
import { registerWriteTools } from './tools/write.js';

const server = new McpServer(
  { name: 'tacticus-tools', version: '0.1.0' },
  {
    instructions:
      'Tools for Warhammer 40,000: Tacticus. Read the game database, the stored roster, and every ' +
      'calculation the Tacticus Tools app is built on; write plans and teams; refresh the roster ' +
      'from the API. Start with player_summary to see whose roster is loaded, list_roster for the ' +
      'units, and energy_candidates for what is worth doing next. Energy figures count only what ' +
      'the player is missing and account for the game\'s Mercy counter, so they read lower than ' +
      'run cost divided by drop rate.',
  },
);

const tool = registrarFor(server);
registerGameTools(tool);
registerPlayerTools(tool);
registerCalcTools(tool);
registerWriteTools(tool);

await server.connect(new StdioServerTransport());
