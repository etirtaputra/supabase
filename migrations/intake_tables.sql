-- ============================================================
-- Intake Tracker Tables
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Items (supplements, medicines, caffeine sources, etc.)
CREATE TABLE IF NOT EXISTS intake_items (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'supplement',   -- supplement | medicine | caffeine | other
  default_unit   TEXT NOT NULL DEFAULT 'mg',
  default_amount NUMERIC NOT NULL DEFAULT 1,
  color          TEXT NOT NULL DEFAULT '#8b5cf6',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

ALTER TABLE intake_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own items"
  ON intake_items FOR ALL
  USING (auth.uid() = user_id);

-- Daily intake log entries
CREATE TABLE IF NOT EXISTS intake_logs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  item_id     UUID REFERENCES intake_items(id) ON DELETE CASCADE NOT NULL,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  amount      NUMERIC NOT NULL,
  unit        TEXT NOT NULL,
  notes       TEXT DEFAULT '',
  time_of_day TEXT DEFAULT '',   -- morning | afternoon | evening | night | ''
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE intake_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own logs"
  ON intake_logs FOR ALL
  USING (auth.uid() = user_id);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS intake_logs_date_idx ON intake_logs(user_id, date);
CREATE INDEX IF NOT EXISTS intake_logs_item_idx ON intake_logs(item_id);
