-- Description libraries v2 — EPC (10.4) and Sales (22.2) — owner, 2026-11-04.
--
-- "One of the most important features for ICAPROC ... free-text libraries
-- with autocomplete ... separated ... logs and the right indexing ...
-- autocomplete and duplicate merge to make data entries consistent."
-- Decisions (owner, same day): sent/accepted documents keep their wording;
-- engineers and sales may add entries, the owner approves or merges; seed
-- the EPC library from the wordings already used (data migration, separate).
--
-- Before this: 10.4 had 0 rows and 22.2 had 1, so "the library" was whatever
-- someone had typed in an earlier document; the EPC library page renamed,
-- merged and deleted by rewriting line text across EVERY proposal (sent ones
-- included) with no log; 22.2 had no uniqueness at all.
--
-- What this adds:
--   * lib_norm(): one normaliser (case, punctuation, spacing) for both.
--   * Library rows gain status (proposed | approved), aliases (spellings
--     merged into them), merged_into, archived_at and who/when columns, and
--     a UNIQUE normalised key among live rows.
--   * library_entry_id on every free-text line, set by a trigger on the
--     line tables — every writer (editors, duplicate, MIRA's mirror) gets it.
--     An unknown wording becomes a PROPOSED entry (an owner's is approved).
--   * 10.5_library_log: every library change, before and after, with the
--     lines it touched; undo reads it.
--   * library_* functions, the ONLY write path (direct writes are revoked):
--     create, edit (rename rewrites DRAFT lines only), merge (re-points links,
--     rewrites DRAFT lines only), archive, approve, undo. Owner-only, except
--     create, which any role that writes that document may use (proposed).

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lib_norm(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT btrim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g')) $$;

CREATE OR REPLACE FUNCTION public.lib_norm_all(t text[]) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT coalesce(array_agg(DISTINCT public.lib_norm(x)) FILTER (WHERE public.lib_norm(x) <> ''), '{}')
     FROM unnest(coalesce(t, '{}')) x $$;

CREATE OR REPLACE FUNCTION public.lib_actor() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT coalesce((SELECT email FROM user_profiles WHERE id = auth.uid()), 'system') $$;

CREATE OR REPLACE FUNCTION public.lib_is_owner() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'owner') $$;

-- Who may ADD to a library: the roles that write that document type.
CREATE OR REPLACE FUNCTION public.lib_can_add(p_library text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = ANY (
     CASE p_library WHEN 'epc' THEN ARRAY['owner','engineer','data_entry','finance']
                    ELSE ARRAY['owner','sales','sell_admin','engineer'] END)) $$;

-- ── Library tables ───────────────────────────────────────────────────────────
ALTER TABLE public."10.4_description_library"
  ADD COLUMN IF NOT EXISTS norm_key text GENERATED ALWAYS AS (public.lib_norm(description)) STORED,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved' CHECK (status IN ('proposed','approved')),
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS alias_keys text[] GENERATED ALWAYS AS (public.lib_norm_all(aliases)) STORED,
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public."10.4_description_library"(entry_id),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_email text,
  ADD COLUMN IF NOT EXISTS created_by_email text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by_email text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by_email text;
DROP INDEX IF EXISTS public.description_library_unique;
CREATE UNIQUE INDEX IF NOT EXISTS epc_library_norm_key_live
  ON public."10.4_description_library" (norm_key) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS epc_library_alias_keys ON public."10.4_description_library" USING gin (alias_keys);

ALTER TABLE public."22.2_sales_description_library"
  ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS norm_key text GENERATED ALWAYS AS (public.lib_norm(description)) STORED,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved' CHECK (status IN ('proposed','approved')),
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS alias_keys text[] GENERATED ALWAYS AS (public.lib_norm_all(aliases)) STORED,
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public."22.2_sales_description_library"(entry_id),
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by_email text,
  ADD COLUMN IF NOT EXISTS updated_by_email text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by_email text;
UPDATE public."22.2_sales_description_library" SET section = 'sales' WHERE section IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_library_norm_key_live
  ON public."22.2_sales_description_library" (coalesce(section, 'sales'), norm_key) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS sales_library_alias_keys ON public."22.2_sales_description_library" USING gin (alias_keys);

-- Writes go through the library_* functions only, so every change is logged.
DROP POLICY IF EXISTS "library write" ON public."10.4_description_library";
DROP POLICY IF EXISTS "sales lib write" ON public."22.2_sales_description_library";

-- ── The log ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public."10.5_library_log" (
  log_id      bigserial PRIMARY KEY,
  library     text NOT NULL CHECK (library IN ('epc','sales')),
  action      text NOT NULL,           -- create | propose | edit | merge | archive | approve | undo
  entry_ids   uuid[] NOT NULL DEFAULT '{}',
  summary     text NOT NULL DEFAULT '',
  detail      jsonb NOT NULL DEFAULT '{}',  -- before/after rows, lines touched
  actor_email text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  undone_at   timestamptz,
  undone_by_email text,
  undo_of     bigint REFERENCES public."10.5_library_log"(log_id)
);
CREATE INDEX IF NOT EXISTS library_log_at ON public."10.5_library_log" (library, at DESC);
CREATE INDEX IF NOT EXISTS library_log_entries ON public."10.5_library_log" USING gin (entry_ids);
ALTER TABLE public."10.5_library_log" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "library log read" ON public."10.5_library_log";
CREATE POLICY "library log read" ON public."10.5_library_log" FOR SELECT TO authenticated
  USING (public.lib_is_owner());
GRANT SELECT ON public."10.5_library_log" TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."10.5_library_log" TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public."10.5_library_log_log_id_seq" TO service_role;

CREATE OR REPLACE FUNCTION public.lib_log(p_library text, p_action text, p_ids uuid[], p_summary text, p_detail jsonb)
  RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ INSERT INTO "10.5_library_log"(library, action, entry_ids, summary, detail, actor_email)
   VALUES (p_library, p_action, coalesce(p_ids, '{}'), coalesce(p_summary, ''), coalesce(p_detail, '{}'), public.lib_actor())
   RETURNING log_id $$;

-- ── Lines link to their entry ────────────────────────────────────────────────
ALTER TABLE public."10.2_quote_items"
  ADD COLUMN IF NOT EXISTS library_entry_id uuid REFERENCES public."10.4_description_library"(entry_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS quote_items_library_entry ON public."10.2_quote_items" (library_entry_id) WHERE library_entry_id IS NOT NULL;
ALTER TABLE public."22.1_sales_quote_items"
  ADD COLUMN IF NOT EXISTS library_entry_id uuid REFERENCES public."22.2_sales_description_library"(entry_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sales_quote_items_library_entry ON public."22.1_sales_quote_items" (library_entry_id) WHERE library_entry_id IS NOT NULL;

-- Find the live entry for a wording (its own spelling first, then a merged alias).
CREATE OR REPLACE FUNCTION public.lib_find(p_library text, p_key text, p_section text DEFAULT NULL)
  RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS
$$
DECLARE e uuid;
BEGIN
  IF coalesce(p_key, '') = '' THEN RETURN NULL; END IF;
  IF p_library = 'epc' THEN
    SELECT entry_id INTO e FROM "10.4_description_library"
     WHERE archived_at IS NULL AND (norm_key = p_key OR alias_keys @> ARRAY[p_key])
     ORDER BY (norm_key = p_key) DESC, (status = 'approved') DESC, created_at LIMIT 1;
  ELSE
    SELECT entry_id INTO e FROM "22.2_sales_description_library"
     WHERE archived_at IS NULL AND (norm_key = p_key OR alias_keys @> ARRAY[p_key])
     ORDER BY (coalesce(section, 'sales') = coalesce(p_section, 'sales')) DESC, (norm_key = p_key) DESC,
              (status = 'approved') DESC, created_at LIMIT 1;
  END IF;
  RETURN e;
END $$;

CREATE OR REPLACE FUNCTION public.lib_link_epc_line() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE k text; e uuid; sec record; st text;
BEGIN
  IF NEW.component_id IS NOT NULL THEN NEW.library_entry_id := NULL; RETURN NEW; END IF;
  k := public.lib_norm(NEW.description);
  IF length(k) < 3 THEN NEW.library_entry_id := NULL; RETURN NEW; END IF;
  IF NEW.library_entry_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM "10.4_description_library" l
        WHERE l.entry_id = NEW.library_entry_id AND (l.norm_key = k OR l.alias_keys @> ARRAY[k])) THEN
    RETURN NEW;
  END IF;
  e := public.lib_find('epc', k);
  IF e IS NULL THEN
    SELECT s.group_key, s.title INTO sec FROM "10.1_quote_sections" s WHERE s.section_id = NEW.section_id;
    st := CASE WHEN public.lib_is_owner() THEN 'approved' ELSE 'proposed' END;
    INSERT INTO "10.4_description_library"(description, brand, unit, group_key, section_title, status,
                                           created_by_email, updated_by_email)
    VALUES (btrim(NEW.description), coalesce(btrim(NEW.brand), ''), coalesce(btrim(NEW.unit), ''),
            sec.group_key, coalesce(sec.title, ''), st, public.lib_actor(), public.lib_actor())
    ON CONFLICT DO NOTHING RETURNING entry_id INTO e;
    IF e IS NULL THEN e := public.lib_find('epc', k); ELSE
      PERFORM public.lib_log('epc', CASE st WHEN 'approved' THEN 'create' ELSE 'propose' END, ARRAY[e],
        btrim(NEW.description), jsonb_build_object('from_line', NEW.item_id, 'quote_id', NEW.quote_id));
    END IF;
  END IF;
  NEW.library_entry_id := e;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.lib_link_sales_line() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE k text; e uuid; sect text; st text;
BEGIN
  IF NEW.component_id IS NOT NULL OR coalesce(NEW.is_section, false) THEN NEW.library_entry_id := NULL; RETURN NEW; END IF;
  k := public.lib_norm(NEW.description);
  IF length(k) < 3 THEN NEW.library_entry_id := NULL; RETURN NEW; END IF;
  IF NEW.library_entry_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM "22.2_sales_description_library" l
        WHERE l.entry_id = NEW.library_entry_id AND (l.norm_key = k OR l.alias_keys @> ARRAY[k])) THEN
    RETURN NEW;
  END IF;
  SELECT CASE WHEN q.case_id IS NOT NULL THEN 'aftersales' ELSE 'sales' END INTO sect
    FROM "22.0_sales_quotes" q WHERE q.quote_id = NEW.quote_id;
  e := public.lib_find('sales', k, sect);
  IF e IS NULL THEN
    st := CASE WHEN public.lib_is_owner() THEN 'approved' ELSE 'proposed' END;
    INSERT INTO "22.2_sales_description_library"(description, unit, brand, default_price, section, status,
                                                 created_by_email, updated_by_email)
    VALUES (btrim(NEW.description), coalesce(btrim(NEW.unit), ''), coalesce(btrim(NEW.brand), ''),
            NULLIF(NEW.unit_price, 0), coalesce(sect, 'sales'), st, public.lib_actor(), public.lib_actor())
    ON CONFLICT DO NOTHING RETURNING entry_id INTO e;
    IF e IS NULL THEN e := public.lib_find('sales', k, sect); ELSE
      PERFORM public.lib_log('sales', CASE st WHEN 'approved' THEN 'create' ELSE 'propose' END, ARRAY[e],
        btrim(NEW.description), jsonb_build_object('from_line', NEW.item_id, 'quote_id', NEW.quote_id));
    END IF;
  END IF;
  NEW.library_entry_id := e;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lib_link ON public."10.2_quote_items";
CREATE TRIGGER lib_link BEFORE INSERT OR UPDATE OF description, component_id ON public."10.2_quote_items"
  FOR EACH ROW EXECUTE FUNCTION public.lib_link_epc_line();
DROP TRIGGER IF EXISTS lib_link ON public."22.1_sales_quote_items";
CREATE TRIGGER lib_link BEFORE INSERT OR UPDATE OF description, component_id, is_section ON public."22.1_sales_quote_items"
  FOR EACH ROW EXECUTE FUNCTION public.lib_link_sales_line();

-- ── Snapshots, so every change can be undone ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.lib_snapshot(p_library text, p_ids uuid[]) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS
$$
DECLARE r jsonb;
BEGIN
  IF p_library = 'epc' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(l) - 'norm_key' - 'alias_keys'), '[]') INTO r
      FROM "10.4_description_library" l WHERE l.entry_id = ANY (p_ids);
  ELSE
    SELECT coalesce(jsonb_agg(to_jsonb(l) - 'norm_key' - 'alias_keys'), '[]') INTO r
      FROM "22.2_sales_description_library" l WHERE l.entry_id = ANY (p_ids);
  END IF;
  RETURN r;
END $$;

-- Put library rows back exactly as snapshotted.
CREATE OR REPLACE FUNCTION public.lib_put_back(p_library text, p_rows jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
BEGIN
  IF p_library = 'epc' THEN
    UPDATE "10.4_description_library" l SET
      description = r.description, brand = r.brand, unit = r.unit, group_key = r.group_key,
      section_title = r.section_title, default_cost = r.default_cost, status = r.status, aliases = r.aliases,
      merged_into = r.merged_into, archived_at = r.archived_at, archived_by_email = r.archived_by_email,
      reviewed_at = r.reviewed_at, reviewed_by_email = r.reviewed_by_email,
      updated_at = now(), updated_by_email = public.lib_actor()
    FROM jsonb_populate_recordset(NULL::"10.4_description_library", p_rows) r WHERE l.entry_id = r.entry_id;
  ELSE
    UPDATE "22.2_sales_description_library" l SET
      description = r.description, brand = r.brand, unit = r.unit, default_price = r.default_price,
      notes = r.notes, section = r.section, status = r.status, aliases = r.aliases,
      merged_into = r.merged_into, archived_at = r.archived_at, archived_by_email = r.archived_by_email,
      reviewed_at = r.reviewed_at, reviewed_by_email = r.reviewed_by_email,
      updated_at = now(), updated_by_email = public.lib_actor()
    FROM jsonb_populate_recordset(NULL::"22.2_sales_description_library", p_rows) r WHERE l.entry_id = r.entry_id;
  END IF;
END $$;

-- Lines linked to entries, with the document's status (only drafts are reworded).
CREATE OR REPLACE FUNCTION public.lib_lines(p_library text, p_ids uuid[]) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS
$$
DECLARE r jsonb;
BEGIN
  IF p_library = 'epc' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('item_id', i.item_id, 'entry_id', i.library_entry_id,
             'description', i.description, 'draft', q.status = 'draft')), '[]') INTO r
      FROM "10.2_quote_items" i JOIN "10.0_project_quotes" q ON q.quote_id = i.quote_id
     WHERE i.library_entry_id = ANY (p_ids);
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('item_id', i.item_id, 'entry_id', i.library_entry_id,
             'description', i.description, 'draft', q.status = 'draft')), '[]') INTO r
      FROM "22.1_sales_quote_items" i JOIN "22.0_sales_quotes" q ON q.quote_id = i.quote_id
     WHERE i.library_entry_id = ANY (p_ids);
  END IF;
  RETURN r;
END $$;

-- Point lines at an entry; reword the DRAFT ones to p_text (NULL = keep text).
CREATE OR REPLACE FUNCTION public.lib_repoint(p_library text, p_items uuid[], p_entry uuid, p_text text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
BEGIN
  IF p_library = 'epc' THEN
    UPDATE "10.2_quote_items" i SET library_entry_id = p_entry
     WHERE i.item_id = ANY (p_items);
    IF p_text IS NOT NULL THEN
      UPDATE "10.2_quote_items" i SET description = p_text
        FROM "10.0_project_quotes" q
       WHERE i.item_id = ANY (p_items) AND q.quote_id = i.quote_id AND q.status = 'draft' AND i.description IS DISTINCT FROM p_text;
    END IF;
  ELSE
    UPDATE "22.1_sales_quote_items" i SET library_entry_id = p_entry
     WHERE i.item_id = ANY (p_items);
    IF p_text IS NOT NULL THEN
      UPDATE "22.1_sales_quote_items" i SET description = p_text
        FROM "22.0_sales_quotes" q
       WHERE i.item_id = ANY (p_items) AND q.quote_id = i.quote_id AND q.status = 'draft' AND i.description IS DISTINCT FROM p_text;
    END IF;
  END IF;
END $$;

-- ── The write path ───────────────────────────────────────────────────────────
-- p_fields: description, brand, unit, and per library group_key / section_title /
-- default_cost (epc) or default_price / notes / section (sales).
CREATE OR REPLACE FUNCTION public.library_create(p_library text, p_fields jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE e uuid; d text := btrim(coalesce(p_fields->>'description', '')); st text;
BEGIN
  IF p_library NOT IN ('epc','sales') THEN RAISE EXCEPTION 'Unknown library %', p_library; END IF;
  IF NOT public.lib_can_add(p_library) THEN RAISE EXCEPTION 'Your role may not add to this library'; END IF;
  IF length(public.lib_norm(d)) < 3 THEN RAISE EXCEPTION 'Description too short'; END IF;
  e := public.lib_find(p_library, public.lib_norm(d), p_fields->>'section');
  IF e IS NOT NULL THEN RAISE EXCEPTION 'Already in the library' USING DETAIL = e::text; END IF;
  st := CASE WHEN public.lib_is_owner() THEN 'approved' ELSE 'proposed' END;
  IF p_library = 'epc' THEN
    INSERT INTO "10.4_description_library"(description, brand, unit, group_key, section_title, default_cost,
                                           status, created_by_email, updated_by_email,
                                           reviewed_at, reviewed_by_email)
    VALUES (d, coalesce(btrim(p_fields->>'brand'), ''), coalesce(btrim(p_fields->>'unit'), ''),
            NULLIF(p_fields->>'group_key', ''), coalesce(btrim(p_fields->>'section_title'), ''),
            NULLIF(p_fields->>'default_cost', '')::numeric, st, public.lib_actor(), public.lib_actor(),
            CASE st WHEN 'approved' THEN now() END, CASE st WHEN 'approved' THEN public.lib_actor() END)
    RETURNING entry_id INTO e;
  ELSE
    INSERT INTO "22.2_sales_description_library"(description, brand, unit, default_price, notes, section,
                                                 status, created_by_email, updated_by_email,
                                                 reviewed_at, reviewed_by_email)
    VALUES (d, coalesce(btrim(p_fields->>'brand'), ''), coalesce(btrim(p_fields->>'unit'), ''),
            NULLIF(p_fields->>'default_price', '')::numeric, coalesce(p_fields->>'notes', ''),
            coalesce(NULLIF(p_fields->>'section', ''), 'sales'), st, public.lib_actor(), public.lib_actor(),
            CASE st WHEN 'approved' THEN now() END, CASE st WHEN 'approved' THEN public.lib_actor() END)
    RETURNING entry_id INTO e;
  END IF;
  PERFORM public.lib_log(p_library, CASE st WHEN 'approved' THEN 'create' ELSE 'propose' END, ARRAY[e], d,
                         jsonb_build_object('after', public.lib_snapshot(p_library, ARRAY[e])));
  RETURN e;
END $$;

-- Edit an entry. A new description renames it: the old spelling becomes an
-- alias and DRAFT lines take the new wording; sent/accepted documents keep theirs.
CREATE OR REPLACE FUNCTION public.library_edit(p_library text, p_entry uuid, p_fields jsonb) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE before jsonb; lines jsonb; old_desc text; new_desc text; clash uuid; items uuid[];
BEGIN
  IF NOT public.lib_is_owner() THEN RAISE EXCEPTION 'Only the owner edits library entries'; END IF;
  before := public.lib_snapshot(p_library, ARRAY[p_entry]);
  IF jsonb_array_length(before) = 0 THEN RAISE EXCEPTION 'Entry not found'; END IF;
  old_desc := before->0->>'description';
  new_desc := NULLIF(btrim(coalesce(p_fields->>'description', '')), '');
  IF new_desc IS NOT NULL AND length(public.lib_norm(new_desc)) < 3 THEN RAISE EXCEPTION 'Description too short'; END IF;
  IF new_desc IS NOT NULL AND public.lib_norm(new_desc) <> public.lib_norm(old_desc) THEN
    clash := public.lib_find(p_library, public.lib_norm(new_desc), before->0->>'section');
    IF clash IS NOT NULL AND clash <> p_entry THEN
      RAISE EXCEPTION 'Another entry already has that wording — merge them instead' USING DETAIL = clash::text;
    END IF;
  END IF;
  lines := public.lib_lines(p_library, ARRAY[p_entry]);

  IF p_library = 'epc' THEN
    UPDATE "10.4_description_library" SET
      description = coalesce(new_desc, description),
      aliases = CASE WHEN new_desc IS NOT NULL AND public.lib_norm(new_desc) <> norm_key
                     THEN array(SELECT DISTINCT x FROM unnest(aliases || old_desc) x) ELSE aliases END,
      brand = coalesce(btrim(p_fields->>'brand'), brand), unit = coalesce(btrim(p_fields->>'unit'), unit),
      group_key = CASE WHEN p_fields ? 'group_key' THEN NULLIF(p_fields->>'group_key', '') ELSE group_key END,
      section_title = coalesce(btrim(p_fields->>'section_title'), section_title),
      default_cost = CASE WHEN p_fields ? 'default_cost' THEN NULLIF(p_fields->>'default_cost', '')::numeric ELSE default_cost END,
      updated_at = now(), updated_by_email = public.lib_actor()
    WHERE entry_id = p_entry;
  ELSE
    UPDATE "22.2_sales_description_library" SET
      description = coalesce(new_desc, description),
      aliases = CASE WHEN new_desc IS NOT NULL AND public.lib_norm(new_desc) <> norm_key
                     THEN array(SELECT DISTINCT x FROM unnest(aliases || old_desc) x) ELSE aliases END,
      brand = coalesce(btrim(p_fields->>'brand'), brand), unit = coalesce(btrim(p_fields->>'unit'), unit),
      default_price = CASE WHEN p_fields ? 'default_price' THEN NULLIF(p_fields->>'default_price', '')::numeric ELSE default_price END,
      notes = coalesce(p_fields->>'notes', notes), section = coalesce(NULLIF(p_fields->>'section', ''), section),
      updated_at = now(), updated_by_email = public.lib_actor()
    WHERE entry_id = p_entry;
  END IF;

  IF new_desc IS NOT NULL AND new_desc IS DISTINCT FROM old_desc THEN
    SELECT array_agg((x->>'item_id')::uuid) INTO items FROM jsonb_array_elements(lines) x;
    PERFORM public.lib_repoint(p_library, coalesce(items, '{}'), p_entry, new_desc);
  END IF;

  RETURN public.lib_log(p_library, 'edit', ARRAY[p_entry],
    CASE WHEN new_desc IS NOT NULL AND new_desc IS DISTINCT FROM old_desc
         THEN format('%s → %s', old_desc, new_desc) ELSE coalesce(new_desc, old_desc) END,
    jsonb_build_object('before', before, 'after', public.lib_snapshot(p_library, ARRAY[p_entry]),
                       'lines', CASE WHEN new_desc IS DISTINCT FROM old_desc THEN lines ELSE '[]'::jsonb END));
END $$;

-- Merge sources into a target: every line follows to the target (drafts take
-- its wording, sent/accepted keep theirs), the sources' spellings become the
-- target's aliases, and the sources are archived (merged_into = target).
CREATE OR REPLACE FUNCTION public.library_merge(p_library text, p_target uuid, p_sources uuid[]) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE srcs uuid[]; before jsonb; tgt jsonb; lines jsonb; items uuid[]; spellings text[];
BEGIN
  IF NOT public.lib_is_owner() THEN RAISE EXCEPTION 'Only the owner merges library entries'; END IF;
  srcs := array(SELECT DISTINCT s FROM unnest(p_sources) s WHERE s <> p_target);
  IF coalesce(array_length(srcs, 1), 0) = 0 THEN RAISE EXCEPTION 'Nothing to merge'; END IF;
  before := public.lib_snapshot(p_library, srcs || p_target);
  SELECT x INTO tgt FROM jsonb_array_elements(before) x WHERE (x->>'entry_id')::uuid = p_target;
  IF tgt IS NULL OR tgt->>'archived_at' IS NOT NULL THEN RAISE EXCEPTION 'Merge target not found or archived'; END IF;
  lines := public.lib_lines(p_library, srcs);
  SELECT array_agg((x->>'item_id')::uuid) INTO items FROM jsonb_array_elements(lines) x;
  SELECT array_agg(DISTINCT s) INTO spellings FROM (
    SELECT x->>'description' s FROM jsonb_array_elements(before) x WHERE (x->>'entry_id')::uuid = ANY (srcs)
    UNION SELECT jsonb_array_elements_text(x->'aliases') FROM jsonb_array_elements(before) x WHERE (x->>'entry_id')::uuid = ANY (srcs)
  ) z;

  -- Archive the sources first: the target then owns their spellings without a clash.
  IF p_library = 'epc' THEN
    UPDATE "10.4_description_library" SET archived_at = now(), archived_by_email = public.lib_actor(),
      merged_into = p_target, updated_at = now(), updated_by_email = public.lib_actor() WHERE entry_id = ANY (srcs);
    UPDATE "10.4_description_library" SET aliases = array(SELECT DISTINCT x FROM unnest(aliases || coalesce(spellings, '{}')) x
                                                          WHERE public.lib_norm(x) <> norm_key),
      status = 'approved', reviewed_at = coalesce(reviewed_at, now()), reviewed_by_email = coalesce(reviewed_by_email, public.lib_actor()),
      updated_at = now(), updated_by_email = public.lib_actor() WHERE entry_id = p_target;
  ELSE
    UPDATE "22.2_sales_description_library" SET archived_at = now(), archived_by_email = public.lib_actor(),
      merged_into = p_target, updated_at = now(), updated_by_email = public.lib_actor() WHERE entry_id = ANY (srcs);
    UPDATE "22.2_sales_description_library" SET aliases = array(SELECT DISTINCT x FROM unnest(aliases || coalesce(spellings, '{}')) x
                                                                WHERE public.lib_norm(x) <> norm_key),
      status = 'approved', reviewed_at = coalesce(reviewed_at, now()), reviewed_by_email = coalesce(reviewed_by_email, public.lib_actor()),
      updated_at = now(), updated_by_email = public.lib_actor() WHERE entry_id = p_target;
  END IF;
  PERFORM public.lib_repoint(p_library, coalesce(items, '{}'), p_target, tgt->>'description');

  RETURN public.lib_log(p_library, 'merge', srcs || p_target,
    format('%s ← %s', tgt->>'description', array_to_string(spellings, ' · ')),
    jsonb_build_object('target', p_target, 'before', before,
                       'after', public.lib_snapshot(p_library, srcs || p_target), 'lines', lines));
END $$;

CREATE OR REPLACE FUNCTION public.library_archive(p_library text, p_entries uuid[]) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE before jsonb;
BEGIN
  IF NOT public.lib_is_owner() THEN RAISE EXCEPTION 'Only the owner archives library entries'; END IF;
  before := public.lib_snapshot(p_library, p_entries);
  IF p_library = 'epc' THEN
    UPDATE "10.4_description_library" SET archived_at = now(), archived_by_email = public.lib_actor(),
      updated_at = now(), updated_by_email = public.lib_actor() WHERE entry_id = ANY (p_entries) AND archived_at IS NULL;
  ELSE
    UPDATE "22.2_sales_description_library" SET archived_at = now(), archived_by_email = public.lib_actor(),
      updated_at = now(), updated_by_email = public.lib_actor() WHERE entry_id = ANY (p_entries) AND archived_at IS NULL;
  END IF;
  RETURN public.lib_log(p_library, 'archive', p_entries,
    (SELECT string_agg(x->>'description', ' · ') FROM jsonb_array_elements(before) x),
    jsonb_build_object('before', before, 'after', public.lib_snapshot(p_library, p_entries)));
END $$;

CREATE OR REPLACE FUNCTION public.library_approve(p_library text, p_entries uuid[]) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE before jsonb;
BEGIN
  IF NOT public.lib_is_owner() THEN RAISE EXCEPTION 'Only the owner approves library entries'; END IF;
  before := public.lib_snapshot(p_library, p_entries);
  IF p_library = 'epc' THEN
    UPDATE "10.4_description_library" SET status = 'approved', reviewed_at = now(), reviewed_by_email = public.lib_actor(),
      updated_at = now(), updated_by_email = public.lib_actor() WHERE entry_id = ANY (p_entries) AND status = 'proposed';
  ELSE
    UPDATE "22.2_sales_description_library" SET status = 'approved', reviewed_at = now(), reviewed_by_email = public.lib_actor(),
      updated_at = now(), updated_by_email = public.lib_actor() WHERE entry_id = ANY (p_entries) AND status = 'proposed';
  END IF;
  RETURN public.lib_log(p_library, 'approve', p_entries,
    (SELECT string_agg(x->>'description', ' · ') FROM jsonb_array_elements(before) x),
    jsonb_build_object('before', before, 'after', public.lib_snapshot(p_library, p_entries)));
END $$;

-- Undo one logged change. Refused when a LATER change touched the same entries
-- (undo those first), so an undo never silently overwrites newer work.
CREATE OR REPLACE FUNCTION public.library_undo(p_log_id bigint) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE g "10.5_library_log"; ln jsonb; newer bigint;
BEGIN
  IF NOT public.lib_is_owner() THEN RAISE EXCEPTION 'Only the owner undoes library changes'; END IF;
  SELECT * INTO g FROM "10.5_library_log" WHERE log_id = p_log_id FOR UPDATE;
  IF g.log_id IS NULL THEN RAISE EXCEPTION 'Log entry not found'; END IF;
  IF g.undone_at IS NOT NULL THEN RAISE EXCEPTION 'Already undone'; END IF;
  IF g.action = 'undo' THEN RAISE EXCEPTION 'An undo cannot be undone — make the change again'; END IF;
  SELECT log_id INTO newer FROM "10.5_library_log"
   WHERE library = g.library AND log_id > g.log_id AND undone_at IS NULL AND action <> 'undo'
     AND entry_ids && g.entry_ids ORDER BY log_id DESC LIMIT 1;
  IF newer IS NOT NULL THEN
    RAISE EXCEPTION 'A later change (#%) touched the same entries — undo that first', newer;
  END IF;

  IF g.action IN ('create', 'propose') THEN
    IF g.library = 'epc' THEN
      UPDATE "10.4_description_library" SET archived_at = now(), archived_by_email = public.lib_actor() WHERE entry_id = ANY (g.entry_ids);
    ELSE
      UPDATE "22.2_sales_description_library" SET archived_at = now(), archived_by_email = public.lib_actor() WHERE entry_id = ANY (g.entry_ids);
    END IF;
  ELSE
    PERFORM public.lib_put_back(g.library, g.detail->'before');
    -- Lines go back to where they pointed and what they said — drafts only for the text.
    FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(g.detail->'lines', '[]')) LOOP
      PERFORM public.lib_repoint(g.library, ARRAY[(ln->>'item_id')::uuid], (ln->>'entry_id')::uuid,
                                 CASE WHEN (ln->>'draft')::boolean THEN ln->>'description' END);
    END LOOP;
  END IF;

  UPDATE "10.5_library_log" SET undone_at = now(), undone_by_email = public.lib_actor() WHERE log_id = g.log_id;
  RETURN (SELECT public.lib_log(g.library, 'undo', g.entry_ids, format('Undo #%s: %s', g.log_id, g.summary),
                                jsonb_build_object('undo_of', g.log_id)));
END $$;

-- ── Usage, for the library screens and the autocomplete ──────────────────────
CREATE OR REPLACE VIEW public.v_epc_library_usage WITH (security_invoker = true) AS
SELECT i.library_entry_id AS entry_id, count(*) AS uses, count(DISTINCT i.quote_id) AS documents,
       max(q.quote_date) AS last_used,
       (array_agg(i.cost_price ORDER BY q.quote_date DESC NULLS LAST, i.created_at DESC) FILTER (WHERE i.cost_price > 0))[1] AS last_cost,
       (array_agg(i.sell_price ORDER BY q.quote_date DESC NULLS LAST, i.created_at DESC) FILTER (WHERE i.sell_price > 0))[1] AS last_sell
  FROM "10.2_quote_items" i JOIN "10.0_project_quotes" q ON q.quote_id = i.quote_id
 WHERE i.library_entry_id IS NOT NULL
 GROUP BY i.library_entry_id;

CREATE OR REPLACE VIEW public.v_sales_library_usage WITH (security_invoker = true) AS
SELECT i.library_entry_id AS entry_id, count(*) AS uses, count(DISTINCT i.quote_id) AS documents,
       max(q.quote_date) AS last_used,
       (array_agg(i.unit_price ORDER BY q.quote_date DESC NULLS LAST, i.created_at DESC) FILTER (WHERE i.unit_price > 0))[1] AS last_price
  FROM "22.1_sales_quote_items" i JOIN "22.0_sales_quotes" q ON q.quote_id = i.quote_id
 WHERE i.library_entry_id IS NOT NULL
 GROUP BY i.library_entry_id;

GRANT SELECT ON public.v_epc_library_usage TO authenticated;
GRANT SELECT ON public.v_epc_library_usage TO service_role;
GRANT SELECT ON public.v_sales_library_usage TO authenticated;
GRANT SELECT ON public.v_sales_library_usage TO service_role;

-- The functions are the API: callable by signed-in users, each checks the role itself.
REVOKE ALL ON FUNCTION public.library_create(text, jsonb), public.library_edit(text, uuid, jsonb),
  public.library_merge(text, uuid, uuid[]), public.library_archive(text, uuid[]),
  public.library_approve(text, uuid[]), public.library_undo(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.library_create(text, jsonb), public.library_edit(text, uuid, jsonb),
  public.library_merge(text, uuid, uuid[]), public.library_archive(text, uuid[]),
  public.library_approve(text, uuid[]), public.library_undo(bigint) TO authenticated, service_role;
-- Internals are not an API.
REVOKE ALL ON FUNCTION public.lib_put_back(text, jsonb), public.lib_repoint(text, uuid[], uuid, text),
  public.lib_log(text, text, uuid[], text, jsonb) FROM PUBLIC, anon, authenticated;
