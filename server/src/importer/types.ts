// Type definitions for CSV import parsing results — shared across staff and shift parsers.

export type ImportAction = "accepted" | "auto_corrected" | "merged" | "rejected";

export interface ImportEntry<T> {
  rowNumber: number;
  originalData: Record<string, string>;
  action: ImportAction;
  problems: string[];
  details: string;
  correctedData?: T;
  parsedData?: T;
}

export interface StaffRow {
  staffId: string;
  fullName: string;
  profession: "doctor" | "nurse" | "receptionist";
  email: string;
}

export interface ShiftRow {
  shiftId: string;
  date: string;        // ISO date string YYYY-MM-DD
  startTime: string;   // HH:MM
  endTime: string;     // HH:MM
  isOvernight: boolean;
  reqDoctors: number;
  reqNurses: number;
  reqReceptionists: number;
}

export interface ParseResult<T> {
  accepted: Array<ImportEntry<T>>;
  rejected: Array<ImportEntry<T>>;
  merged: Array<ImportEntry<T>>;
  autoCorrected: Array<ImportEntry<T>>;
}
