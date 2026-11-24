export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SUBMISSION_BYTES = 30 * 1024 * 1024;
export const MAX_FIELD_FILES = 5;
export const FILE_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.jpg,.jpeg,.png,.gif,.webp';
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';
export type AttachmentInfo = {
  id: string;
  fieldId: string;
  name: string;
  size: number;
  mime: string;
};
export const attachmentSelect = {
  id: true,
  fieldId: true,
  name: true,
  size: true,
  mime: true,
} as const;
export const attachmentUrl = (id: string, preview = false) =>
  `/api/attachments/${encodeURIComponent(id)}${preview ? '?preview=1' : ''}`;
