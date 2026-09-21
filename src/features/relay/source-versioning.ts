export type SourceVersionCandidate = {
  id: string;
  title: string;
  normalizedFilename: string | null;
  contentHash: string | null;
  mimeType: string | null;
  isCurrent: boolean;
};

export type SourceVersionMatch =
  | { kind: 'duplicate'; source: SourceVersionCandidate }
  | { kind: 'new_version'; source: SourceVersionCandidate; basis: 'filename_and_type' }
  | { kind: 'confirmation_required'; source: SourceVersionCandidate }
  | { kind: 'separate' };

export function normalizeSourceFilename(name: string) {
  return name.normalize('NFKD').toLocaleLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'document';
}

export function sourceDocumentIdentity(filename: string) {
  return normalizeSourceFilename(filename)
    .replace(/(?:-copy|-final|-revised|-updated)+$/g, '')
    .replace(/(?:-v(?:ersion)?-?\d+|-\d{4}(?:-\d{1,2}){0,2}|-\d+)$/g, '')
    .replace(/-+$/g, '');
}

export function classifySourceVersion(
  filename: string,
  mimeType: string,
  contentHash: string,
  candidates: SourceVersionCandidate[],
): SourceVersionMatch {
  const duplicate = candidates.find((source) => source.contentHash === contentHash);
  if (duplicate) return { kind: 'duplicate', source: duplicate };

  const normalized = normalizeSourceFilename(filename);
  const strong = candidates.find((source) => source.isCurrent
    && source.normalizedFilename === normalized
    && source.mimeType === mimeType);
  if (strong) return { kind: 'new_version', source: strong, basis: 'filename_and_type' };

  const identity = sourceDocumentIdentity(filename);
  const ambiguous = candidates.find((source) => source.isCurrent
    && source.mimeType === mimeType
    && sourceDocumentIdentity(source.normalizedFilename ?? source.title) === identity);
  if (ambiguous) return { kind: 'confirmation_required', source: ambiguous };
  return { kind: 'separate' };
}
