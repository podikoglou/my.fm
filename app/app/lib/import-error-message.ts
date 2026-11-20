import { DetailedError } from "hono/client";
import { z } from "zod";

const errorResponseSchema = z.object({
  data: z.object({ error: z.string().optional() }).optional(),
});

export function importErrorMessage(error: Error): string {
  if (error instanceof DetailedError) {
    const parsed = errorResponseSchema.safeParse(error.detail);

    return (
      (parsed.success ? parsed.data.data?.error : undefined) ?? "Import failed. Please try again."
    );
  }

  return "Network error during upload.";
}
