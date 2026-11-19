export type CsvHeaderIndices = {
  artistIdx: number;
  albumIdx: number;
  trackIdx: number;
  dateIdx: number;
};

export type ParsedScrobbleRow = {
  artist: string;
  album: string | null;
  track: string;
  playedAt: Date;
};

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const MAX_LINE_CHARS = 4096;

export const MAX_FIELD_CHARS = 512;

export function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }

  return text;
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }

        inQuotes = false;
        i++;
        continue;
      }

      current += char;
      i++;
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      }

      if (char === ";") {
        fields.push(current);
        current = "";
        i++;
        continue;
      }

      current += char;
      i++;
    }
  }

  fields.push(current);

  return fields;
}

export function parseCsvHeaders(headerLine: string): CsvHeaderIndices | null {
  const clean = stripBom(headerLine).trim();
  const fields = parseCsvLine(clean).map((field) => field.trim());

  let artistIdx = -1;
  let albumIdx = -1;
  let trackIdx = -1;
  let dateIdx = -1;

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];

    if (!field) {
      continue;
    }

    if (field === "Artist") {
      artistIdx = i;
    } else if (field === "Album") {
      albumIdx = i;
    } else if (field === "Track") {
      trackIdx = i;
    } else if (field.startsWith("Date#") || field === "Date") {
      dateIdx = i;
    }
  }

  if (artistIdx === -1 || trackIdx === -1 || dateIdx === -1) {
    return null;
  }

  return { artistIdx, albumIdx, trackIdx, dateIdx };
}

export function parseScrobbleRow(
  line: string,
  indices: CsvHeaderIndices,
): ParsedScrobbleRow | null {
  if (line.length === 0 || line.length > MAX_LINE_CHARS) {
    return null;
  }

  const fields = parseCsvLine(line);
  const minRequiredLength = Math.max(indices.artistIdx, indices.trackIdx, indices.dateIdx) + 1;

  if (fields.length < minRequiredLength) {
    return null;
  }

  const rawArtist = fields[indices.artistIdx]?.trim() ?? "";
  const rawTrack = fields[indices.trackIdx]?.trim() ?? "";
  const rawDate = fields[indices.dateIdx]?.trim() ?? "";

  if (rawArtist.length === 0 || rawArtist.length > MAX_FIELD_CHARS) {
    return null;
  }

  if (rawTrack.length === 0 || rawTrack.length > MAX_FIELD_CHARS) {
    return null;
  }

  if (rawDate.length === 0) {
    return null;
  }

  const timestampNum = Number(rawDate);

  if (!Number.isFinite(timestampNum) || timestampNum <= 0) {
    return null;
  }

  // Exports use epoch ms (> 1e11) or epoch seconds.
  const playedAt = timestampNum > 1e11 ? new Date(timestampNum) : new Date(timestampNum * 1000);

  if (Number.isNaN(playedAt.getTime())) {
    return null;
  }

  let album: string | null = null;

  if (indices.albumIdx >= 0 && indices.albumIdx < fields.length) {
    const rawAlbum = fields[indices.albumIdx]?.trim() ?? "";

    if (rawAlbum.length > 0 && rawAlbum.length <= MAX_FIELD_CHARS) {
      album = rawAlbum;
    }
  }

  return {
    artist: rawArtist,
    album,
    track: rawTrack,
    playedAt,
  };
}

export function splitCsvLines(content: string): string[] {
  const clean = stripBom(content);

  const lines: string[] = [];
  let lineStart = 0;
  let inQuotes = false;
  let i = 0;

  while (i < clean.length) {
    if (inQuotes) {
      if (clean[i] === '"') {
        if (clean[i + 1] === '"') {
          i += 2;
          continue;
        }

        inQuotes = false;
      }

      i++;
      continue;
    }

    if (clean[i] === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (clean[i] === "\n") {
      // A lone \r is field data, not a terminator; only \r directly before \n is stripped.
      const end = clean[i - 1] === "\r" ? i - 1 : i;
      lines.push(clean.slice(lineStart, end));
      lineStart = i + 1;
    }

    i++;
  }

  lines.push(clean.slice(lineStart));

  return lines;
}

export function getImportR2Key(id: string): string {
  return `imports/${id}.csv`;
}
