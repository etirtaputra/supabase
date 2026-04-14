-- Migration: Create component_history table
-- Records field-level audit trail for all component edits.
-- Each save that changes a field inserts one row per changed field.

CREATE TABLE IF NOT EXISTS component_history (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  component_id uuid        NOT NULL REFERENCES "3.0_components"(component_id) ON DELETE CASCADE,
  field_name   text        NOT NULL,
  old_value    text,
  new_value    text,
  changed_at   timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS component_history_component_id_idx ON component_history (component_id);
CREATE INDEX IF NOT EXISTS component_history_changed_at_idx   ON component_history (changed_at DESC);

COMMENT ON TABLE  component_history             IS 'Field-level audit log for component edits';
COMMENT ON COLUMN component_history.field_name  IS 'Column name that was changed (supplier_model, brand, category, …)';
COMMENT ON COLUMN component_history.old_value   IS 'Value before the edit (NULL if previously unset)';
COMMENT ON COLUMN component_history.new_value   IS 'Value after the edit (NULL if field was cleared)';
