import { Schema } from "effect";

export class NotificationNotFoundError extends Schema.TaggedError<NotificationNotFoundError>()(
  "NotificationNotFoundError",
  {
    message: Schema.String,
  },
) {}
