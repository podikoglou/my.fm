import type {
  FeedItemSchema,
  NotificationSchema,
  OAuthAppSchema,
  OAuthAuthorizeDetailsResponse,
  ProjectedScrobbleSchema,
  PublicUserSchema,
  SessionUserSchema,
} from "@my.fm/api";

export const now = "2026-04-16T12:00:00.000Z";
const playedAt = "2026-04-16T10:00:00.000Z";

export const listener = {
  id: "listener-id",
  username: "river",
  name: "River Stone",
  avatarUrl: null,
} satisfies typeof PublicUserSchema.Encoded;

export const account = {
  ...listener,
  email: "river@example.test",
  onboarded: true,
  isPrivate: false,
} satisfies typeof SessionUserSchema.Encoded;

const imageUrl = "https://fixtures.example.test/cover.svg";

export const cover =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="#18304b"/><circle cx="60" cy="42" r="24" fill="#e6aa69"/><path d="M0 85 35 35 78 96H0Z" fill="#478e89"/></svg>';

const artists = [{ name: "North Pier", spotifyUri: "spotify:artist:northpier" }];

const album = { name: "Coastlines", imageUrl, spotifyUri: "spotify:album:coastlines", artists };

export function play(index: number, name: string): typeof ProjectedScrobbleSchema.Encoded {
  return {
    id: `play-${index}`,
    scrobbleDate: playedAt,
    track: { name, imageUrl, artists, spotifyUri: `spotify:track:track${index}` },
    album,
  };
}

export function feedItem(index: number, name: string): typeof FeedItemSchema.Encoded {
  return { ...play(index, name), scrobbleDate: playedAt, user: listener };
}

export const notification = {
  id: "notice-1",
  title: "Listening history imported",
  type: "parity-fixture",
  body: "Your listening history is ready.",
  createdAt: playedAt,
} satisfies typeof NotificationSchema.Encoded;

export const app = {
  id: "app-1",
  clientId: "wave-reader",
  name: "Wave Reader",
  clientUri: "https://reader.example.test",
  scope: ["read"],
  createdAt: Date.parse(playedAt) / 1000,
} satisfies typeof OAuthAppSchema.Encoded;

export const consent = {
  client: { clientId: app.clientId, clientName: app.name, clientUri: app.clientUri },
  scope: app.scope,
  redirectUri: "https://reader.example.test/callback",
} satisfies typeof OAuthAuthorizeDetailsResponse.Encoded;

export const spotifyLogin = "https://accounts.spotify.com/authorize";
