-- Check actual column names in 4.1_price_quote_line_items table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = '4.1_price_quote_line_items'
ORDER BY ordinal_position;
