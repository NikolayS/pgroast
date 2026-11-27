/**
 * Single source of truth for the Personal Backoffice AI-Agent installation prompt
 * (shown as the default installation path across Setup Backoffice, Docs, Space Switcher,
 * and Patch Detail).
 */

export function buildBackofficeInstallPrompt(origin = "https://pgroast.postgres.ai"): string {
  const cleanOrigin = (origin || "https://pgroast.postgres.ai").replace(/\/$/, "");
  return [
    "Install and configure the pgroast Personal Backoffice on this machine:",
    "",
    "1. Check prerequisites: git, bun (>= 1.3.5), Postgres 18 or 19 (local or Docker), and at least one signed-in AI CLI (claude, codex, or agy).",
    "2. Clone https://github.com/NikolayS/pgroast.git (or git pull if already cloned) and run `bun install`.",
    "3. Configure Postgres:",
    "   - If local Postgres 18/19 is already running, reuse it and write `.env` with matching `PGROAST_DSN` and `PGROAST_DATABASE_URL`.",
    "   - Otherwise start the bundled Postgres 19 container (`docker compose -f apps/local/docker-compose.yml up -d`) and copy `.env.example` to `.env`.",
    `4. Set \`PGROAST_PUBLIC_HUB_URL=${cleanOrigin}\` in \`.env\`.`,
    "5. Run `bun run src/cli.ts init-db` to load the 2,547-row precedent index, and `bun run src/cli.ts doctor` to verify my AI CLI login.",
    "6. Start the local Backoffice with `bun run app:local`, verify http://127.0.0.1:3432 responds, and show me the link plus optional settings (CommitFest login, publish token, local Postgres git clone) I can configure next.",
  ].join("\n");
}

export const BACKOFFICE_MANUAL_COMMANDS = [
  "git clone https://github.com/NikolayS/pgroast.git && cd pgroast",
  "bun install",
  "docker compose -f apps/local/docker-compose.yml up -d",
  "cp .env.example .env",
  "bun run src/cli.ts init-db",
  "bun run app:local",
].join("\n");
