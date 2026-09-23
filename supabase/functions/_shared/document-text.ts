export class DocumentTextLimitError extends Error {}

export function completeDocumentText(
  parts: Array<string | null | undefined>,
  maxCharacters: number,
) {
  const text = parts
    .map((part) => typeof part === 'string' ? part.trim() : '')
    .filter(Boolean)
    .join('\n\n');
  if (text.length > maxCharacters) {
    throw new DocumentTextLimitError(`Document text exceeds the ${maxCharacters}-character Organize limit.`);
  }
  return text;
}
