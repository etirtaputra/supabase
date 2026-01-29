'use client';

import { useState } from 'react';

type DocumentType = 'quote' | 'proforma_invoice' | 'purchase_order';
type InsertMode = 'formal' | 'history';

interface LineItem {
  model_sku: string;
  description: string;
  quantity: number;
  unit_price: number;
  brand?: string;
}

interface ExtractedData {
  document_type: DocumentType;
  supplier_name: string;
  supplier_id?: number;
  company_name?: string;
  company_id?: number;

  // Quote/PI specific
  quote_number?: string;
  quote_date?: string;
  pi_number?: string;
  pi_date?: string;

  // PO specific
  po_number?: string;
  po_date?: string;

  // Common fields
  currency: string;
  total_value: number;
  payment_terms?: string;
  lead_time_days?: number;

  line_items: LineItem[];
}

export default function UploadPDFPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [error, setError] = useState<string>('');
  const [insertMode, setInsertMode] = useState<InsertMode>('formal');
  const [inserting, setInserting] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError('');
      setExtractedData(null);
    } else {
      setError('Please select a PDF file');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'application/pdf') {
      setFile(droppedFile);
      setError('');
      setExtractedData(null);
    } else {
      setError('Please drop a PDF file');
    }
  };

  const handleExtract = async () => {
    if (!file) return;

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      const response = await fetch('/api/extract-pdf', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to extract PDF data');
      }

      const data = await response.json();
      setExtractedData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract PDF');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmInsert = async () => {
    if (!extractedData) return;

    setInserting(true);
    setError('');

    try {
      const response = await fetch('/api/insert-from-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: extractedData,
          mode: insertMode,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to insert data');
      }

      const result = await response.json();
      alert(`Successfully inserted! Quote ID: ${result.quote_id}, ${result.line_items_count} line items`);

      // Reset form
      setFile(null);
      setExtractedData(null);
      setInsertMode('formal');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to insert data');
    } finally {
      setInserting(false);
    }
  };

  const handleEdit = (field: string, value: any) => {
    if (!extractedData) return;
    setExtractedData({ ...extractedData, [field]: value });
  };

  const handleEditLineItem = (index: number, field: string, value: any) => {
    if (!extractedData) return;
    const newLineItems = [...extractedData.line_items];
    newLineItems[index] = { ...newLineItems[index], [field]: value };
    setExtractedData({ ...extractedData, line_items: newLineItems });
  };

  const handleDeleteLineItem = (index: number) => {
    if (!extractedData) return;
    const newLineItems = extractedData.line_items.filter((_, i) => i !== index);
    setExtractedData({ ...extractedData, line_items: newLineItems });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Upload PDF (Quote/Proforma Invoice/PO)</h1>

        {/* Upload Section */}
        {!extractedData && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-500 transition"
            >
              <input
                type="file"
                accept="application/pdf"
                onChange={handleFileSelect}
                className="hidden"
                id="pdf-upload"
              />
              <label htmlFor="pdf-upload" className="cursor-pointer">
                <div className="text-6xl mb-4">📄</div>
                <p className="text-lg font-medium mb-2">
                  {file ? file.name : 'Drop PDF here or click to upload'}
                </p>
                <p className="text-sm text-gray-500">
                  Supports: Quotes, Proforma Invoices, Purchase Orders
                </p>
              </label>
            </div>

            {file && (
              <button
                onClick={handleExtract}
                disabled={loading}
                className="mt-4 w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium"
              >
                {loading ? 'Extracting data from PDF...' : 'Extract Data with AI'}
              </button>
            )}

            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Preview Section */}
        {extractedData && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Preview Extracted Data</h2>
              <button
                onClick={() => setExtractedData(null)}
                className="text-gray-600 hover:text-gray-800"
              >
                ← Upload Different PDF
              </button>
            </div>

            {/* Document Info */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-1">Document Type</label>
                <input
                  type="text"
                  value={extractedData.document_type}
                  disabled
                  className="w-full p-2 border rounded bg-gray-50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Supplier Name</label>
                <input
                  type="text"
                  value={extractedData.supplier_name}
                  onChange={(e) => handleEdit('supplier_name', e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  {extractedData.document_type === 'proforma_invoice' ? 'PI Number' : 'Quote Number'}
                </label>
                <input
                  type="text"
                  value={extractedData.pi_number || extractedData.quote_number || ''}
                  onChange={(e) => handleEdit(
                    extractedData.document_type === 'proforma_invoice' ? 'pi_number' : 'quote_number',
                    e.target.value
                  )}
                  className="w-full p-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Date</label>
                <input
                  type="date"
                  value={extractedData.pi_date || extractedData.quote_date || extractedData.po_date || ''}
                  onChange={(e) => handleEdit(
                    extractedData.document_type === 'proforma_invoice' ? 'pi_date' : 'quote_date',
                    e.target.value
                  )}
                  className="w-full p-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Currency</label>
                <select
                  value={extractedData.currency}
                  onChange={(e) => handleEdit('currency', e.target.value)}
                  className="w-full p-2 border rounded"
                >
                  <option value="USD">USD</option>
                  <option value="RMB">RMB</option>
                  <option value="IDR">IDR</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Total Value</label>
                <input
                  type="number"
                  value={extractedData.total_value}
                  onChange={(e) => handleEdit('total_value', parseFloat(e.target.value))}
                  className="w-full p-2 border rounded"
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-4">Line Items ({extractedData.line_items.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-2 text-left">SKU/Model</th>
                      <th className="border p-2 text-left">Description</th>
                      <th className="border p-2 text-left">Brand</th>
                      <th className="border p-2 text-right">Qty</th>
                      <th className="border p-2 text-right">Unit Price</th>
                      <th className="border p-2 text-right">Total</th>
                      <th className="border p-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extractedData.line_items.map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="border p-2">
                          <input
                            type="text"
                            value={item.model_sku}
                            onChange={(e) => handleEditLineItem(index, 'model_sku', e.target.value)}
                            className="w-full p-1 border rounded"
                          />
                        </td>
                        <td className="border p-2">
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => handleEditLineItem(index, 'description', e.target.value)}
                            className="w-full p-1 border rounded"
                          />
                        </td>
                        <td className="border p-2">
                          <input
                            type="text"
                            value={item.brand || ''}
                            onChange={(e) => handleEditLineItem(index, 'brand', e.target.value)}
                            className="w-full p-1 border rounded"
                          />
                        </td>
                        <td className="border p-2">
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => handleEditLineItem(index, 'quantity', parseFloat(e.target.value))}
                            className="w-full p-1 border rounded text-right"
                          />
                        </td>
                        <td className="border p-2">
                          <input
                            type="number"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(e) => handleEditLineItem(index, 'unit_price', parseFloat(e.target.value))}
                            className="w-full p-1 border rounded text-right"
                          />
                        </td>
                        <td className="border p-2 text-right font-medium">
                          {(item.quantity * item.unit_price).toFixed(2)}
                        </td>
                        <td className="border p-2 text-center">
                          <button
                            onClick={() => handleDeleteLineItem(index)}
                            className="text-red-600 hover:text-red-800"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-100 font-bold">
                      <td colSpan={5} className="border p-2 text-right">TOTAL:</td>
                      <td className="border p-2 text-right">
                        {extractedData.line_items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toFixed(2)}
                      </td>
                      <td className="border p-2"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Insert Mode Selection */}
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <label className="block text-sm font-medium mb-2">Insert Mode:</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="formal"
                    checked={insertMode === 'formal'}
                    onChange={(e) => setInsertMode(e.target.value as InsertMode)}
                  />
                  <span>Formal Tables (Quote → Quote Line Items → PI)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value="history"
                    checked={insertMode === 'history'}
                    onChange={(e) => setInsertMode(e.target.value as InsertMode)}
                  />
                  <span>History Table (Quick Entry)</span>
                </label>
              </div>
            </div>

            {/* Confirmation Buttons */}
            <div className="flex gap-4">
              <button
                onClick={handleConfirmInsert}
                disabled={inserting}
                className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 font-medium"
              >
                {inserting ? 'Inserting to Supabase...' : '✓ Confirm & Insert to Supabase'}
              </button>
              <button
                onClick={() => setExtractedData(null)}
                className="px-6 bg-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-400 font-medium"
              >
                Cancel
              </button>
            </div>

            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
