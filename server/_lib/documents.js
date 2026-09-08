export function mapDocumentRow(row) {
  return {
    id: row.id,
    docType: row.doc_type,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
  }
}
