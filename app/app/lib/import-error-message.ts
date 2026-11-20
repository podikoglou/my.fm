import { DetailedError } from "hono/client";
import { z } from "zod";

const errorResponseSchema = z.object({ error: z.string().optional() });

export function importErrorMessage(error: Error): string {
  if (error instanceof DetailedError) {
    const parsed = errorResponseSchema.safeParse(error.detail?.data);

    return (parsed.success ? parsed.data.error : undefined) ?? "Import failed. Please try again.";
  }

  return "Network error during upload.";
}
