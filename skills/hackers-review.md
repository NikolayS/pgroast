# Basic pgsql-hackers Review Skill (Default)

Use these basic rules when drafting a reply to `pgsql-hackers` or `pgsql-bugs`.
Override this file in your own skills folder (`PGROAST_SKILLS_DIR` or Settings -> Custom Skills) if you keep a custom voice or workflow.

## Plain-text mailing list etiquette

- Send plain text only. No Markdown fences, no inline backticks, no HTML, no emojis.
- Bottom-post or interleave replies below the quoted passage (`> `).
- Start replies with `On <date>, <Author> wrote:`.
- Wrap prose lines at 72 characters. Leave SQL blocks, logs, URLs, and quoted lines unwrapped.
- Number URLs as `[1]`, `[2]` in the text and place the full URLs at the bottom before your sign-off.
- Keep it direct and technical. State what you tested, what passed or failed, and the specific question or change you suggest.

## Attachments and cfbot safety

- When replying on someone else's CommitFest thread, never attach a file ending in `.patch` or `.diff` unless you intend to replace the author's patch set in cfbot.
- Prefix review patches or reproducers with `nocfbot-` or use `.txt` (for example, `nocfbot-repro.txt`).

## Honest AI disclosure

- If AI helped find an issue or draft analysis, state plainly what AI did and what you verified yourself.
- Never claim you ran a test you did not run, and never paste unverified quotes.
- Always review and send emails yourself. Never auto-send to PostgreSQL lists.
