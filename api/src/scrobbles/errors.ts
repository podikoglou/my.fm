import { Schema } from "effect";

export class InvalidCursorError extends Schema.TaggedError<InvalidCursorError>()(
  "InvalidCursorError",
  {
    message: Schema.String,
  },
) {}
