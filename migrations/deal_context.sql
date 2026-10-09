-- Deal context: WHERE a supplier quote came from, and WHY each line was asked
-- for or ordered (owner, 2026-10-09).
--
-- Until now the "PI number" box did two jobs: 127 of 163 quotes hold a real
-- document number, while 31 hold hand-typed notes like
-- "WA Wendy to Eric 2026-10-07 16:55" — WhatsApp spelled "WA" or "WhatsApp",
-- dates in four formats. The note IS useful (who, where, when — the context a
-- negotiation needs), so it gets proper fields instead of free text, and
-- pi_number goes back to meaning the supplier's document number.
--
-- Header (4.0 quote, and 5.0 PO — a PO raised without a stored quote has its
-- own source): channel, when it arrived, the supplier's person, ours.
-- Lines (4.1 and 5.1): the reason, an optional link to what it was for (an EPC
-- proposal, a sales order, or the old item being replaced) and a short note.
--
-- All columns are nullable: existing rows have no recorded reason and nothing
-- here may be guessed for them.

ALTER TABLE public."4.0_price_quotes"
  ADD COLUMN IF NOT EXISTS source_channel text,
  ADD COLUMN IF NOT EXISTS source_at      timestamptz,
  ADD COLUMN IF NOT EXISTS source_contact text,
  ADD COLUMN IF NOT EXISTS received_by    text;

ALTER TABLE public."5.0_purchases"
  ADD COLUMN IF NOT EXISTS source_channel text,
  ADD COLUMN IF NOT EXISTS source_at      timestamptz,
  ADD COLUMN IF NOT EXISTS source_contact text,
  ADD COLUMN IF NOT EXISTS received_by    text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'price_quotes_source_channel_chk') THEN
    ALTER TABLE public."4.0_price_quotes" ADD CONSTRAINT price_quotes_source_channel_chk
      CHECK (source_channel IS NULL OR source_channel IN ('whatsapp','wechat','email','phone','meeting','price_list','website','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_source_channel_chk') THEN
    ALTER TABLE public."5.0_purchases" ADD CONSTRAINT purchases_source_channel_chk
      CHECK (source_channel IS NULL OR source_channel IN ('whatsapp','wechat','email','phone','meeting','price_list','website','other'));
  END IF;
END $$;

ALTER TABLE public."4.1_price_quote_line_items"
  ADD COLUMN IF NOT EXISTS reason                     text,
  ADD COLUMN IF NOT EXISTS reason_note                text,
  ADD COLUMN IF NOT EXISTS reason_project_quote_id    uuid REFERENCES public."10.0_project_quotes"(quote_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason_sales_quote_id      uuid REFERENCES public."22.0_sales_quotes"(quote_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason_replaces_component_id uuid REFERENCES public."3.0_components"(component_id) ON DELETE SET NULL;

ALTER TABLE public."5.1_purchase_line_items"
  ADD COLUMN IF NOT EXISTS reason                     text,
  ADD COLUMN IF NOT EXISTS reason_note                text,
  ADD COLUMN IF NOT EXISTS reason_project_quote_id    uuid REFERENCES public."10.0_project_quotes"(quote_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason_sales_quote_id      uuid REFERENCES public."22.0_sales_quotes"(quote_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason_replaces_component_id uuid REFERENCES public."3.0_components"(component_id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_lines_reason_chk') THEN
    ALTER TABLE public."4.1_price_quote_line_items" ADD CONSTRAINT quote_lines_reason_chk
      CHECK (reason IS NULL OR reason IN ('stock','project','customer_order','replacement','warranty','new_product','price_check','other'));
  END IF;
  -- A PO commits money: "price check only" is a reason to ASK, never to ORDER.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'po_lines_reason_chk') THEN
    ALTER TABLE public."5.1_purchase_line_items" ADD CONSTRAINT po_lines_reason_chk
      CHECK (reason IS NULL OR reason IN ('stock','project','customer_order','replacement','warranty','new_product','other'));
  END IF;
END $$;

COMMENT ON COLUMN public."4.0_price_quotes".source_channel IS
  'Where the quote arrived: whatsapp, wechat, email, phone, meeting, price_list, website, other (lib/dealContext.ts).';
COMMENT ON COLUMN public."4.0_price_quotes".source_at IS 'When the quote arrived (the chat/email timestamp), not when it was typed in.';
COMMENT ON COLUMN public."4.0_price_quotes".source_contact IS 'The supplier''s person who sent it.';
COMMENT ON COLUMN public."4.0_price_quotes".received_by IS 'Our person who received it.';
COMMENT ON COLUMN public."4.1_price_quote_line_items".reason IS
  'Why this item was asked for: stock, project, customer_order, replacement, warranty, new_product, price_check, other (lib/dealContext.ts).';
COMMENT ON COLUMN public."5.1_purchase_line_items".reason IS
  'Why this item was ordered: stock, project, customer_order, replacement, warranty, new_product, other (lib/dealContext.ts).';
