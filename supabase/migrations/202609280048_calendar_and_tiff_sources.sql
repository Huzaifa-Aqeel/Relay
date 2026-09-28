-- Keep the private Capture upload bucket aligned with the client and document
-- processor. Calendar exports are decoded directly; TIFF uses Unstructured.
update storage.buckets
set allowed_mime_types = array_append(
  coalesce(allowed_mime_types, array[]::text[]),
  'text/calendar'
)
where id = 'handoff-sources'
  and not (
    'text/calendar' = any(coalesce(allowed_mime_types, array[]::text[]))
  );

update storage.buckets
set allowed_mime_types = array_append(
  coalesce(allowed_mime_types, array[]::text[]),
  'image/tiff'
)
where id = 'handoff-sources'
  and not (
    'image/tiff' = any(coalesce(allowed_mime_types, array[]::text[]))
  );
