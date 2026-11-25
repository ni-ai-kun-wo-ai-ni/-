export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_BYTES = 1024 * 1024;
export type StudentImportEdit = {
  rowNumber: number;
  name?: string;
  studentNumber?: string;
  remove?: boolean;
  isClassOfficer?: boolean;
  isStudentOfficer?: boolean;
};
export type StudentImportRow = {
  rowNumber: number;
  name: string;
  studentNumber: string;
  isClassOfficer: boolean;
  isStudentOfficer: boolean;
  errors: string[];
};
export type StudentImportPreview = {
  rows: StudentImportRow[];
  canImport: boolean;
  className: string | null;
  gradeName: string | null;
};
