const HOMOGLYPHS = {
  // Greek capital
  Α: "a",
  Β: "b",
  Ε: "e",
  Ζ: "z",
  Η: "h",
  Ι: "i",
  Κ: "k",
  Μ: "m",
  Ν: "n",
  Ο: "o",
  Ρ: "p",
  Τ: "t",
  Υ: "y",
  Χ: "x",
  // Greek small
  α: "a",
  β: "b",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  // Cyrillic capital
  А: "a",
  В: "b",
  Е: "e",
  К: "k",
  М: "m",
  Н: "h",
  О: "o",
  Р: "p",
  С: "c",
  Т: "t",
  У: "y",
  Х: "x",
  // Cyrillic small
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
} as const;

const ARTIST_CUT_REGEX = /\s*(?:\/|\b(?:feat|ft|with|vs)\b\.?).*/i;

export async function sha256Hex16(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));

  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function stripControlCharacters(raw: string): string {
  let result = "";

  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);

    if (code > 0x1f && code !== 0x7f) {
      result += raw[i];
    }
  }

  return result;
}

const HOMOGLYPH_MAP = new Map<string, string>(Object.entries(HOMOGLYPHS));

function replaceHomoglyph(char: string): string {
  return HOMOGLYPH_MAP.get(char) ?? char;
}

export function normalizeText(raw: string): string {
  const stripped = stripControlCharacters(raw).trim().replaceAll(/\s+/g, " ");
  const nfkd = stripped.normalize("NFKD").replaceAll(/[\u0300-\u036F]/g, "");
  const lowered = nfkd.toLowerCase();

  const unhomoglyphed = lowered.replaceAll(/[\u0400-\u04FF\u0370-\u03FF]/g, replaceHomoglyph);

  return unhomoglyphed
    .replaceAll("&", " and ")
    .replaceAll(/['’]/g, "")
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeArtist(artist: string): string {
  const cut = artist.replace(ARTIST_CUT_REGEX, "");

  return normalizeText(cut);
}

export type NormalizedKeys = {
  readonly normArtist: string;
  readonly normTitle: string;
  readonly normArtistKey: string;
  readonly normTrackKey: string;
};

export async function computeNormKeys(artist: string, title: string): Promise<NormalizedKeys> {
  const normArtist = normalizeArtist(artist);
  const normTitle = normalizeText(title);
  const normArtistKey = await sha256Hex16(normArtist);
  const normTrackKey = await sha256Hex16(`${normArtistKey}:${normTitle}`);

  return { normArtist, normTitle, normArtistKey, normTrackKey };
}

export async function computeImportScrobbleId(
  userId: string,
  playedAtISO: string,
  normTrackKey: string,
): Promise<string> {
  return await sha256Hex16(`${userId}:${playedAtISO}:${normTrackKey}`);
}
