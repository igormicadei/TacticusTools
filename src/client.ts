/**
 * A minimal, dependency-free client for the read-only Tacticus API.
 */

import { TacticusApiError, isApiErrorBody } from './types/errors.js';
import type { GuildRaidResponse, GuildResponse, PlayerResponse } from './types/index.js';

/**
 * Default API host.
 *
 * The OpenAPI document declares `servers: [{ url: "/" }]`, so it carries no
 * host of its own; this is the public Tacticus API host. Override it via
 * {@link TacticusClientOptions.baseUrl} if your key is issued against another
 * environment.
 */
export const DEFAULT_BASE_URL = 'https://api.tacticusgame.com';

/** Minimal structural type of `fetch`, so any compatible impl can be injected. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface TacticusClientOptions {
  /** API key, sent as the `X-API-KEY` header. */
  apiKey: string;
  /** Defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: FetchLike;
}

export class TacticusClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(options: TacticusClientOptions) {
    if (!options.apiKey) {
      throw new Error('TacticusClient requires an apiKey.');
    }

    const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new Error(
        'No fetch implementation available. Use Node 18+ or pass options.fetch.',
      );
    }

    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#fetch = fetchImpl;
  }

  /** `GET /api/v1/player` — requires a key with the `Player` scope. */
  getPlayer(): Promise<PlayerResponse> {
    return this.#get<PlayerResponse>('/api/v1/player');
  }

  /** `GET /api/v1/guild` — requires a key with the `Guild` scope. */
  getGuild(): Promise<GuildResponse> {
    return this.#get<GuildResponse>('/api/v1/guild');
  }

  /**
   * `GET /api/v1/guildRaid[/{season}]` — requires a key with the
   * `Guild Raid` scope. Omit `season` for the current one.
   */
  getGuildRaid(season?: number): Promise<GuildRaidResponse> {
    if (season === undefined) {
      return this.#get<GuildRaidResponse>('/api/v1/guildRaid');
    }
    if (!Number.isInteger(season) || season < 0) {
      throw new TypeError(`season must be a non-negative integer, received: ${season}`);
    }
    return this.#get<GuildRaidResponse>(`/api/v1/guildRaid/${season}`);
  }

  async #get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    let status: number;
    let raw: string;
    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method: 'GET',
        headers: {
          'X-API-KEY': this.#apiKey,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      status = response.status;
      raw = await response.text();
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = raw === '' ? undefined : JSON.parse(raw);
    } catch {
      throw new TacticusApiError({
        status,
        path,
        body: raw,
        message: `Tacticus API request to ${path} returned HTTP ${status} with a non-JSON body.`,
      });
    }

    if (status < 200 || status >= 300) {
      throw new TacticusApiError({
        status,
        path,
        body,
        ...(isApiErrorBody(body) ? { type: body.type } : {}),
      });
    }

    return body as T;
  }
}
