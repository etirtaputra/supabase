-- First, let's see the current state of the kWh normalized links
SELECT 
  link_id,
  component_id_a,
  component_id_b,
  norm_value_a,
  norm_value_b,
  normalization_unit
FROM "8.0_component_links"
WHERE normalization_unit = 'kWh'
ORDER BY created_at;
