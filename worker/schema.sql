-- The shared draft table.
--
-- One row per draft in progress. `body` is the Creator's own draft record as
-- JSON — the same shape it keeps in localStorage — so the server never has to
-- understand a character, only store one. That matters: the wizard's schema
-- changes often, and a store that parsed it would need migrating every time.
--
-- `rev` is what makes concurrent editing safe. Every save says which revision
-- it was based on, and the UPDATE only lands if that is still the current one
-- (see PUT in src/index.js). Two people editing the same character no longer
-- means one of them silently loses their work.

CREATE TABLE IF NOT EXISTS drafts (
  id      TEXT    PRIMARY KEY,
  rev     INTEGER NOT NULL,
  name    TEXT    NOT NULL DEFAULT '',
  updated INTEGER NOT NULL,
  editor  TEXT    NOT NULL DEFAULT '',
  body    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS drafts_updated ON drafts(updated DESC);
