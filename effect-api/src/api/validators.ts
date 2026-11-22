import { Schema } from "effect";

export const UsernameSchema = Schema.String.check(
  Schema.isMinLength(3, { message: "Username must be at least 3 characters" }),
  Schema.isMaxLength(20, { message: "Username must be at most 20 characters" }),
  Schema.isPattern(/^[a-zA-Z0-9_]+$/, {
    message: "Username can only contain letters, numbers, and underscores",
  }),
);

export const NameSchema = Schema.Trim.check(
  Schema.isMinLength(1, { message: "Name must be at least 1 character" }),
  Schema.isMaxLength(32, { message: "Name must be at most 32 characters" }),
  Schema.isPattern(/^[\p{L}\p{N} '_\-.]+$/u, {
    message: "Name can only contain letters, numbers, spaces, and '_-.",
  }),
);

export const NanoidSchema = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{21}$/));
