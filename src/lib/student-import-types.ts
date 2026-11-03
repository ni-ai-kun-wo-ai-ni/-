export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_BYTES = 1024 * 1024;
export type StudentImportRow = {
  rowNumber: number;
  name: string;
  studentNumber: string;
  errors: string[];
};
export type StudentImportPreview = {
  rows: StudentImportRow[];
  canImport: boolean;
  className: string;
  gradeName: string;
};
