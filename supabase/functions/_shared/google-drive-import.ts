export const MAX_DRIVE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DRIVE_PICKED_FILES = 20;

export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const GOOGLE_NATIVE_EXPORTS: Readonly<Record<string, { extension: string; mimeType: string }>> = Object.freeze({
  'application/vnd.google-apps.document': {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  'application/vnd.google-apps.spreadsheet': {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  'application/vnd.google-apps.presentation': {
    extension: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
});

export const SUPPORTED_DRIVE_MIME_TYPES = Object.freeze([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/bmp',
  'image/heic',
  'image/jpeg',
  'image/png',
]);

const MIME_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/jpeg': 'jpg',
  'image/png': 'png',
});

const EXTENSION_MIME = new Map(Object.entries(MIME_EXTENSION).map(([mimeType, extension]) => [extension, mimeType]));
EXTENSION_MIME.set('jpeg', 'image/jpeg');

export type DriveFileMetadata = {
  id: string;
  name: string;
  mimeType: string;
  size?: string | null;
  trashed?: boolean;
  capabilities?: { canDownload?: boolean } | null;
};

export type DriveImportSpec = {
  fileName: string;
  mimeType: string;
  mode: 'download' | 'export';
};

function extensionFor(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return extension && extension !== name.toLowerCase() ? extension : '';
}

function withExtension(name: string, extension: string) {
  const trimmed = name.trim() || 'Google Drive document';
  return extensionFor(trimmed) === extension ? trimmed : `${trimmed}.${extension}`;
}

export function driveImportSpec(metadata: DriveFileMetadata): DriveImportSpec | null {
  const nativeExport = GOOGLE_NATIVE_EXPORTS[metadata.mimeType];
  if (nativeExport) {
    return {
      fileName: withExtension(metadata.name, nativeExport.extension),
      mimeType: nativeExport.mimeType,
      mode: 'export',
    };
  }

  const reportedMime = SUPPORTED_DRIVE_MIME_TYPES.includes(metadata.mimeType)
    ? metadata.mimeType
    : null;
  const inferredMime = EXTENSION_MIME.get(extensionFor(metadata.name)) ?? null;
  const mimeType = reportedMime ?? inferredMime;
  if (!mimeType) return null;
  return {
    fileName: withExtension(metadata.name, MIME_EXTENSION[mimeType]),
    mimeType,
    mode: 'download',
  };
}

export function parsePickedFileIds(value: string | null) {
  if (!value) return [];
  return [...new Set(value.split(',').map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_-]{10,200}$/.test(id)))]
    .slice(0, MAX_DRIVE_PICKED_FILES);
}

export function safeDriveFileName(name: string) {
  const normalized = name.normalize('NFKC').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim();
  return (normalized || 'drive-document').slice(-120);
}

export function driveSourceTitle(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
    || 'Handoff document';
}
