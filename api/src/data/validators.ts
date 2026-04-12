import z from "zod";

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be at most 20 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores");

export const nameSchema = z
  .string()
  .min(1, "Name must be at least 1 character")
  .max(32, "name must be at most 32 characters")
  .trim()
  .regex(/^[\p{L}\p{N} '_\-.]+$/u);
