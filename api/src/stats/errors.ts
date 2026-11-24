import { Schema } from "effect";

export class TimelineTooLongError extends Schema.TaggedError<TimelineTooLongError>()(
  "TimelineTooLongError",
  { message: Schema.String },
) {}
