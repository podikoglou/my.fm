import { Schema } from "effect";
import { TopKindSchema } from "../api/stats.ts";

const TopEntity = Schema.Struct({
  kind: TopKindSchema,
  name: Schema.String,
  artist: Schema.NullOr(Schema.String),
  spotifyUri: Schema.NullOr(Schema.String),
  plays: Schema.Int,
  firstPlayed: Schema.Int,
  lastPlayed: Schema.Int,
  distinct: Schema.Int,
});

export type TopKind = typeof TopKindSchema.Type;

export type TopEntityRow = typeof TopEntity.Type;

export const RankedEntitiesSchema = Schema.Struct({
  total: Schema.Int,
  earliest: Schema.NullOr(Schema.Int),
  latest: Schema.NullOr(Schema.Int),
  rows: Schema.Array(TopEntity),
});

export type RankedEntities = typeof RankedEntitiesSchema.Type;
