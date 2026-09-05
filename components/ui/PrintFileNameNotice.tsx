'use client';
/**
 * The iOS-only card above a print button: the filename this document should
 * be saved under, shown AND copyable.
 *
 * Shown as well as copied on purpose — a browser that refuses the clipboard
 * still leaves the name on screen to be read, and someone renaming the file in
 * the iOS save sheet can see what they are aiming for.
 *
 * Renders nothing anywhere else, which is every browser that honours the
 * document title.
 */
import React from 'react';

export default function PrintFileNameNotice({ show, fileName, copied, onCopy }: {
  show: boolean;
  fileName: string;
  copied: boolean;
  onCopy: () => void;
}) {
  if (!show || !fileName) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '10px 12px', boxShadow: '0 6px 20px rgba(15,23,42,0.15)', fontSize: '11px', lineHeight: 1.45, color: '#64748b' }}>
      <p style={{ marginBottom: '6px' }}>iOS names the PDF after the browser. Paste this in the save sheet:</p>
      <p style={{ fontWeight: 700, color: '#1f5aa8', wordBreak: 'break-all', marginBottom: '6px' }}>{fileName}</p>
      <button onClick={onCopy}
        style={{ width: '100%', padding: '6px 8px', borderRadius: '8px', border: '1px solid #cbd5e1', background: copied ? '#dcfce7' : '#f8fafc', color: copied ? '#166534' : '#334155', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>
        {copied ? '✓ Name copied' : 'Copy file name'}
      </button>
    </div>
  );
}
