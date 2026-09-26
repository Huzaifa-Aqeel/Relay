-- XLSX is supported by Capture and the document-processing pipeline, but the
-- document-processing bucket update accidentally omitted its MIME type.
update storage.buckets
set allowed_mime_types = array_append(
  coalesce(allowed_mime_types, array[]::text[]),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
)
where id = 'handoff-sources'
  and not (
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    = any(coalesce(allowed_mime_types, array[]::text[]))
  );
