import { parseCsvHeaders, parseScrobbleRow, splitCsvLines, type CsvHeaderIndices } from "./csv.ts";

/** How many lines, the header included, the upload reads before it accepts a file. */
const SAMPLED_LINES = 50;

export type ImportFile = {
  /** Every line of the file, the header line first. */
  readonly lines: string[];
  readonly headers: CsvHeaderIndices;
};

export type ImportFileResult =
  | { readonly ok: true; readonly file: ImportFile }
  | { readonly ok: false; readonly error: string };

/**
 * Read an export into its lines and its columns.
 *
 * The upload route and the cron both read a file through here, so a file the
 * route accepts is one the cron can process.
 */
export function readImportFile(text: string): ImportFileResult {
  const lines = splitCsvLines(text);
  const [headerLine] = lines;

  if (lines.length < 2 || !headerLine) {
    return { ok: false, error: "CSV file contains no data rows" };
  }

  const headers = parseCsvHeaders(headerLine);

  if (!headers) {
    return { ok: false, error: "Invalid CSV headers: missing required columns" };
  }

  return { ok: true, file: { lines, headers } };
}

/** Whether any of the first rows is a play, which tells an export from another CSV. */
export function hasValidRow({ lines, headers }: ImportFile): boolean {
  return lines.slice(1, SAMPLED_LINES).some((line) => parseScrobbleRow(line, headers) !== null);
}
