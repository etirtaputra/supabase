import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf') as File;

    if (!file) {
      return NextResponse.json({ error: 'No PDF file provided' }, { status: 400 });
    }

    // Convert PDF to base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64PDF = buffer.toString('base64');

    // Extract data using Claude
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64PDF,
              },
            },
            {
              type: 'text',
              text: `You are a data extraction assistant for a supply chain management system. Extract ALL information from this PDF document (Quote, Proforma Invoice, or Purchase Order).

CRITICAL INSTRUCTIONS:
1. Extract EVERY line item - do not skip any rows
2. Identify the document type (quote, proforma_invoice, or purchase_order)
3. Extract supplier information
4. Extract all line items with SKU, description, brand (if mentioned), quantity, and unit price
5. Calculate total value

Return a JSON object with this EXACT structure:
{
  "document_type": "quote" | "proforma_invoice" | "purchase_order",
  "supplier_name": "exact supplier name from document",
  "quote_number": "quote/reference number if this is a quote",
  "quote_date": "YYYY-MM-DD format",
  "pi_number": "PI number if this is a proforma invoice",
  "pi_date": "YYYY-MM-DD format",
  "po_number": "PO number if this is a purchase order",
  "po_date": "YYYY-MM-DD format",
  "currency": "USD" | "RMB" | "IDR",
  "total_value": 12345.67,
  "payment_terms": "payment terms if mentioned",
  "lead_time_days": 30,
  "line_items": [
    {
      "model_sku": "product SKU or model number",
      "description": "full product description",
      "brand": "brand name if mentioned",
      "quantity": 100,
      "unit_price": 123.45
    }
  ]
}

IMPORTANT:
- Extract ALL line items, even if there are many
- If a field is not present, omit it or use null
- Ensure dates are in YYYY-MM-DD format
- Currency should be one of: USD, RMB, or IDR
- For descriptions, preserve the original text from the document
- If you see brand names like EPEVER, JEMBO, SUPREME, etc., include them in the brand field
- Calculate total_value as the sum of all line items

Return ONLY the JSON object, no other text.`,
            },
          ],
        },
      ],
    });

    // Parse Claude's response
    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response format from Claude');
    }

    // Extract JSON from response (Claude might wrap it in markdown)
    let jsonText = content.text.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    const extractedData = JSON.parse(jsonText);

    // Validate required fields
    if (!extractedData.document_type || !extractedData.supplier_name || !extractedData.line_items) {
      throw new Error('Missing required fields in extracted data');
    }

    // Return extracted data
    return NextResponse.json(extractedData);

  } catch (error) {
    console.error('PDF extraction error:', error);
    return NextResponse.json(
      {
        error: 'Failed to extract data from PDF',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
