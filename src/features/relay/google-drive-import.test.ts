import { describe, expect, it } from 'vitest';

import {
  DRIVE_FILE_SCOPE,
  driveImportSpec,
  driveSourceTitle,
  MAX_DRIVE_PICKED_FILES,
  parsePickedFileIds,
  safeDriveFileName,
} from '../../../supabase/functions/_shared/google-drive-import';

describe('Google Drive attachment import', () => {
  it('uses only the per-file Drive OAuth scope', () => {
    expect(DRIVE_FILE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
  });

  it.each([
    ['application/vnd.google-apps.document', 'Meeting notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['application/vnd.google-apps.spreadsheet', 'Budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['application/vnd.google-apps.presentation', 'Orientation.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ])('exports Google-native %s files to a supported Office format', (mimeType, fileName, exportedMime) => {
    expect(driveImportSpec({ id: 'drive-file-123', name: fileName.replace(/\.[^.]+$/, ''), mimeType })).toEqual({
      fileName,
      mimeType: exportedMime,
      mode: 'export',
    });
  });

  it('downloads a supported normal Drive file as its original bytes', () => {
    expect(driveImportSpec({ id: 'drive-file-123', name: 'Policy.pdf', mimeType: 'application/pdf' })).toEqual({
      fileName: 'Policy.pdf',
      mimeType: 'application/pdf',
      mode: 'download',
    });
  });

  it('accepts a supported extension when Drive reports a generic MIME type', () => {
    expect(driveImportSpec({ id: 'drive-file-123', name: 'contacts.CSV', mimeType: 'application/octet-stream' })).toEqual({
      fileName: 'contacts.CSV',
      mimeType: 'text/csv',
      mode: 'download',
    });
  });

  it('rejects unsupported Google and binary formats', () => {
    expect(driveImportSpec({ id: 'drive-file-123', name: 'drawing', mimeType: 'application/vnd.google-apps.drawing' })).toBeNull();
    expect(driveImportSpec({ id: 'drive-file-456', name: 'archive.zip', mimeType: 'application/zip' })).toBeNull();
  });

  it('deduplicates and validates selected IDs with a bounded selection', () => {
    const ids = Array.from({ length: MAX_DRIVE_PICKED_FILES + 3 }, (_, index) => `valid-file-id-${index + 100}`);
    const parsed = parsePickedFileIds([...ids, ids[0], 'bad id!'].join(','));
    expect(parsed).toHaveLength(MAX_DRIVE_PICKED_FILES);
    expect(parsed[0]).toBe(ids[0]);
    expect(new Set(parsed).size).toBe(parsed.length);
  });

  it('sanitizes file names and derives the same attachment title shape as local uploads', () => {
    expect(safeDriveFileName('../Finance / policy 2027.pdf')).toBe('.._Finance _ policy 2027.pdf');
    expect(driveSourceTitle('Finance_policy-2027.pdf')).toBe('Finance policy 2027');
  });

});
