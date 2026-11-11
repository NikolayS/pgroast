-- PG Roast precedent corpus. Applied (idempotently) by `corpus build`.

create table if not exists precedent (
  id           text primary key,             -- cf:<patch id> | revert:<sha> | wiki:<anchor>:<n>
  kind         text not null check (kind in ('cf', 'revert', 'do_not_want')),
  raw_ref      text not null,                -- stable source key: patch/<id> | <sha> | Not_Worth_Doing#<anchor>:<n>
  title        text not null,
  status       text not null,                -- Rejected | Returned with feedback | Withdrawn | Reverted | Partially reverted | Not wanted | Not worth doing
  date         date,                         -- decision date (CF close / revert commit, UTC)
  first_date   date,                         -- thread start / earliest reverted commit
  url          text not null,                -- CF patch page | gitweb commit | wiki anchor
  thread_urls  text[] not null default '{}', -- https://www.postgresql.org/message-id/flat/<msgid>
  authors      text[] not null default '{}',
  reviewers    text[] not null default '{}',
  objectors    text[] not null default '{}',
  tags         text not null default '',     -- CF tags | wiki section
  summary      text not null default '',
  objection    text not null default '',
  touch_points text[] not null default '{}',
  other_links  text[] not null default '{}', -- other real URLs found in the source
  provenance   jsonb not null default '{}',  -- source details, exact timestamps, CF history, reverted commits
  built_at     timestamptz not null default now(),
  tsv          tsvector generated always as (
                 setweight(to_tsvector('english'::regconfig, title), 'A') ||
                 setweight(to_tsvector('english'::regconfig, summary || ' ' || tags), 'B') ||
                 setweight(to_tsvector('english'::regconfig, objection), 'C')
               ) stored,
  constraint precedent_kind_raw_ref_key unique (kind, raw_ref)
);

create index if not exists precedent_tsv_idx on precedent using gin (tsv);

-- Title in the 'simple' config: keeps SQL keywords that 'english' drops as
-- stop words (WHERE, HAVING, ONLY, ...). Used by the search's OR fallback.
alter table precedent add column if not exists tsv_kw tsvector
  generated always as (to_tsvector('simple'::regconfig, title)) stored;
create index if not exists precedent_tsv_kw_idx on precedent using gin (tsv_kw);
create index if not exists precedent_kind_idx on precedent (kind);
create index if not exists precedent_dates_idx on precedent (first_date, date);

create table if not exists build_log (
  kind      text primary key,
  built_at  timestamptz not null default now(),
  coverage  jsonb not null
);
