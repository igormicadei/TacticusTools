/**
 * Redemption codes, from Tacticus Codex's public code list.
 *
 * This is not part of the Tacticus API or anything Snowprint publishes —
 * `tacticuscodex.com` is a community-run companion site with its own
 * unauthenticated `GET /api/gamecode` endpoint. The relay this project ships
 * (`relay/cloudflare-worker.js`, `relay/local-relay.mjs`) fetches it
 * server-side, best-effort, and stitches the result onto `/api/v1/player`'s
 * own response as `gameCodes` — see {@link PlayerResponse.gameCodes}. Typed
 * here rather than left as `unknown` so the rest of the app gets the same
 * shape whether the data came from a live relay or the bundled fallback
 * snapshot.
 */

export interface GameCodeReward {
  /**
   * Set when the reward names something specific — a unit (for `shards`) or
   * a material (for `upgrade`/`upgrades`). Empty for a plain currency amount.
   */
  name: string;
  /** @example "gold" | "energy" | "shards" | "upgrade" | "requisition" */
  type: string;
  /** Further qualifies `type` — a books/ability-badge rarity, mostly. Often empty. */
  subType: string;
  quantity: number;
}

export interface GameCode {
  id: string;
  code: string;
  rewards: GameCodeReward[];
  /** `YYYY-MM-DD`, the day Tacticus Codex posted it — not when the game added it. */
  postedDate: string;
  description: string;
  /**
   * Whether the game itself still accepts this code, per Tacticus Codex.
   *
   * Not about whether *you* have redeemed it — the source has no notion of
   * that. Whether a player has redeemed or dismissed a code is tracked
   * locally in the app instead (see `ui/src/data/gameCodes.ts`).
   */
  isActive: boolean;
  /** Observed always empty in practice — codes seem to be deactivated rather than dated. */
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
