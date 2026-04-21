-- Fix inverted component links
-- Ensures component 066ce835-45b4-4643-8a67-9d708e1728bf (ICAL 4.8kWh) is always component_id_a

-- Swap components where ICAL is component_b instead of component_a
WITH to_fix AS (
  SELECT
    link_id,
    component_id_a,
    component_id_b,
    norm_value_a,
    norm_value_b
  FROM "8.0_component_links"
  WHERE (component_id_a = '066ce835-45b4-4643-8a67-9d708e1728bf' OR component_id_b = '066ce835-45b4-4643-8a67-9d708e1728bf')
    AND component_id_a != '066ce835-45b4-4643-8a67-9d708e1728bf'
)
UPDATE "8.0_component_links" lcl
SET
  component_id_a = tf.component_id_b,
  component_id_b = tf.component_id_a,
  norm_value_a = tf.norm_value_b,
  norm_value_b = tf.norm_value_a,
  updated_at = now()
FROM to_fix tf
WHERE lcl.link_id = tf.link_id;
