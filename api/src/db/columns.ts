import { Schema, SchemaGetter } from "effect";

export const DateFromEpochMillis = Schema.DateFromMillis;

export const DateFromEpochSeconds = Schema.Int.pipe(
  Schema.decodeTo(Schema.Date, {
    decode: SchemaGetter.transform((seconds) => new Date(seconds * 1000)),
    encode: SchemaGetter.transform((date) => Math.floor(date.getTime() / 1000)),
  }),
);

export const BooleanFromInt = Schema.BooleanFromBit;
