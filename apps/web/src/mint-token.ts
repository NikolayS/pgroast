import { loadWebConfig } from "./config.ts";
import { WebDatabase } from "./db.ts";

function parseArg(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return "";
  return (process.argv[idx + 1] || "").trim();
}

const handle = parseArg("--handle");
const name = parseArg("--name") || handle;
const providerRaw = parseArg("--provider") || "github";
const provider = providerRaw === "google" ? "google" : "github";
const label = parseArg("--label") || "team-invite";
const avatarUrl = parseArg("--avatar") || "";

if (!handle) {
  console.error(
    "Usage: bun run web:mint-token --handle <handle> [--name \"Full Name\"] [--provider github|google] [--label team-invite]",
  );
  process.exit(1);
}

const cfg = loadWebConfig();
const db = await WebDatabase.create({ databaseUrl: cfg.databaseUrl });
try {
  const contributor = await db.upsertContributor({ provider, handle, name, avatarUrl });
  const minted = await db.mintPublishToken(contributor.id, label);
  console.log(
    JSON.stringify(
      {
        contributor: {
          id: contributor.id,
          provider: contributor.provider,
          handle: contributor.handle,
          name: contributor.name,
        },
        label,
        prefix: minted.prefix,
        token: minted.token,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
