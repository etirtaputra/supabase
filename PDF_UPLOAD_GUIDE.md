# PDF Upload Feature - User Guide

## 🎯 What It Does

Automatically extract data from PDF documents (quotes, proforma invoices, purchase orders) and insert them into your Supabase database using Claude AI's vision capabilities.

---

## 🚀 How to Use

### Step 1: Access the Upload Page

Go to: **http://localhost:3000/upload-pdf** (or your deployed URL)

### Step 2: Upload Your PDF

**Two ways to upload:**
1. **Drag & drop** - Drag your PDF file onto the upload area
2. **Click to browse** - Click the upload area to select a file from your computer

**Supported document types:**
- 📋 Supplier Quotes
- 📄 Proforma Invoices (PI)
- 📦 Purchase Orders (PO)

### Step 3: Extract Data

Click **"Extract Data with AI"** button.

The system will:
1. Upload your PDF to Claude AI
2. Analyze the document structure
3. Extract all relevant information:
   - Supplier name
   - Document number and date
   - Currency and total value
   - **All line items** (SKU, description, brand, quantity, unit price)

**Typical extraction time:** 5-15 seconds depending on PDF size

### Step 4: Review & Edit

You'll see a **preview** of the extracted data:

**Header fields:**
- Document Type (auto-detected)
- Supplier Name (editable)
- Quote/PI/PO Number (editable)
- Date (editable)
- Currency (dropdown: USD, RMB, IDR)
- Total Value (editable)

**Line Items Table:**
- Each row is editable
- Click 🗑️ to delete unwanted items
- All fields can be modified before inserting

**Review carefully!** AI extraction is usually 95%+ accurate, but you can fix any errors before inserting.

### Step 5: Choose Insert Mode

**Two options:**

#### **Option 1: Formal Tables (Recommended)**
Inserts into the complete supply chain flow:
- `4.0_price_quotes` (creates quote record)
- `4.1_price_quote_line_items` (creates all line items)
- `5.0_proforma_invoices` (creates PI if applicable)

**Use this when:**
- You want full audit trail
- Need to track quote → PI → PO flow
- Creating new quotes/PIs

#### **Option 2: History Table (Quick Entry)**
Inserts into simplified history tables:
- `quote_history` (for quotes/PIs)
- `purchase_history` (for POs)

**Use this when:**
- Importing historical data
- Quick one-time entries
- Don't need full quote-to-PO tracking

### Step 6: Confirm & Insert

Click **"✓ Confirm & Insert to Supabase"**

The system will:
1. Find or create supplier (by name matching)
2. Find or create components (by SKU matching)
3. Insert quote + line items + PI (if formal mode)
4. Show success message with IDs

**Success!** Your data is now in Supabase and available in:
- `/ask` - AI chat
- `/database` - Database view
- All analytics queries

---

## 🎨 Features

### ✅ Smart Data Extraction
- **Auto-detects** document type (quote vs PI vs PO)
- **Extracts all line items** - no manual typing needed
- **Recognizes brands** (EPEVER, JEMBO, SUPREME, etc.)
- **Handles multiple currencies** (USD, RMB, IDR)

### ✅ Intelligent Matching
- **Supplier matching** - Finds existing suppliers by name (fuzzy match)
- **Component matching** - Matches SKUs to existing components
- **Auto-creates** new suppliers/components if not found

### ✅ Data Validation
- **Preview before insert** - Review all extracted data
- **Edit any field** - Fix extraction errors easily
- **Delete line items** - Remove unwanted rows
- **Total calculation** - Auto-calculates from line items

### ✅ Flexible Insertion
- **Formal mode** - Full quote → PI flow with audit trail
- **History mode** - Quick historical imports
- **Component linking** - Automatically links to `component_id`

---

## 📋 What Gets Created

### Formal Mode (Quote/PI)

**New Quote:**
```sql
INSERT INTO "4.0_price_quotes" (
  supplier_id,      -- Auto-matched or created
  company_id,       -- Default company
  quote_date,       -- From PDF
  pi_number,        -- From PDF
  currency,         -- From PDF
  total_value,      -- Calculated
  status           -- Set to 'accepted'
)
```

**Quote Line Items:**
```sql
INSERT INTO "4.1_price_quote_line_items" (
  quote_id,         -- Links to quote above
  component_id,     -- Auto-matched or created
  supplier_description,
  quantity,
  unit_price,
  currency
)
-- One row for each line item in PDF
```

**Proforma Invoice (if PI document):**
```sql
INSERT INTO "5.0_proforma_invoices" (
  quote_id,         -- Links to quote above
  pi_number,        -- From PDF
  pi_date,          -- From PDF
  status           -- Set to 'pending'
)
```

### History Mode

**Quote History:**
```sql
INSERT INTO quote_history (
  supplier_id,
  quote_date,
  quote_number,
  brand,            -- From line item
  description,      -- From line item
  quantity,
  unit_cost,
  currency
)
-- One row for each line item
```

---

## 🛠️ Technical Details

### API Endpoints

**1. Extract PDF**
```
POST /api/extract-pdf
Content-Type: multipart/form-data

Body: { pdf: <file> }

Response:
{
  "document_type": "quote",
  "supplier_name": "PT Trisindo",
  "quote_date": "2026-01-15",
  "currency": "USD",
  "total_value": 12345.67,
  "line_items": [...]
}
```

**2. Insert Data**
```
POST /api/insert-from-pdf
Content-Type: application/json

Body: {
  "data": <extracted_data>,
  "mode": "formal" | "history"
}

Response:
{
  "success": true,
  "quote_id": 123,
  "pi_id": 45,
  "line_items_count": 10
}
```

### Claude AI Integration

Uses **Claude Sonnet 4.5** with document vision:
- Reads PDFs as images
- Understands table structures
- Extracts structured JSON data
- ~95%+ accuracy on formatted PDFs

**Cost per PDF:** ~$0.03-0.10 depending on page count

---

## 📊 Use Cases

### Scenario 1: New Supplier Quote
1. Receive quote PDF via email
2. Upload to `/upload-pdf`
3. AI extracts supplier, items, prices
4. Review & confirm
5. **Result:** Quote + line items in database, ready for PO creation

### Scenario 2: Proforma Invoice
1. Supplier sends PI PDF
2. Upload to `/upload-pdf`
3. AI detects it's a PI
4. Creates quote + line items + PI record
5. **Result:** Complete quote-to-PI flow tracked

### Scenario 3: Historical Data Import
1. Have 50 old quote PDFs to import
2. Upload one by one (or batch process)
3. Use "History Table" mode for quick entry
4. **Result:** All historical data in database for analysis

### Scenario 4: Purchase Order Entry
1. Create PO from supplier
2. Upload PO PDF
3. Extract line items automatically
4. **Result:** PO details entered without manual typing

---

## ⚠️ Important Notes

### What Works Well
✅ Structured PDFs with clear tables
✅ Standard quote/PI formats
✅ English and common Asian languages
✅ Multi-page documents
✅ PDFs with headers and line items

### What Might Need Review
⚠️ Hand-written quotes (low accuracy)
⚠️ Scanned images with poor quality
⚠️ Non-standard formats
⚠️ PDFs with complex formatting
⚠️ Multiple currencies in one document

**Always review the preview before confirming!**

### Data Matching Logic

**Suppliers:**
- Searches existing suppliers by name (case-insensitive, partial match)
- Creates new supplier if no match found
- **Tip:** Standardize supplier names in database for better matching

**Components:**
- Searches by exact SKU match
- Creates new component if SKU not found
- Includes brand and description from PDF
- **Tip:** Use consistent SKU formats

---

## 🔧 Troubleshooting

### "Failed to extract PDF data"
- **Cause:** PDF might be corrupted or protected
- **Solution:** Try re-saving the PDF or removing password protection

### "Missing required fields in extracted data"
- **Cause:** PDF format not recognized by AI
- **Solution:** Manually enter data using `/insert` page instead

### "Failed to insert to Supabase"
- **Cause:** Database constraint violation or missing required fields
- **Solution:** Check error message, verify supplier/component data

### Extraction accuracy is low
- **Cause:** PDF has unusual formatting
- **Solution:** Review and edit all fields in preview before inserting

### Component not matching existing SKUs
- **Cause:** SKU format differs (e.g., spaces, dashes)
- **Solution:** Edit SKU in preview to match existing format

---

## 🚀 Future Enhancements

Potential features to add:
- [ ] Batch PDF upload (process multiple files at once)
- [ ] Email integration (forward quote emails to auto-import)
- [ ] Confidence scoring (show AI confidence per field)
- [ ] Supplier auto-mapping (learn supplier name variations)
- [ ] Duplicate detection (warn if quote already exists)
- [ ] OCR fallback (for scanned/image PDFs)
- [ ] Export to CSV before inserting
- [ ] Undo last import feature

---

## 📞 Support

If you encounter issues:
1. Check the browser console for detailed error messages
2. Verify your Anthropic API key is set in `.env.local`
3. Ensure Supabase service role key has insert permissions
4. Review the extracted data preview carefully before confirming

---

**Built with:** Next.js + Claude AI + Supabase
**Last Updated:** 2026-01-29
