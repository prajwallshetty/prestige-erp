import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/lib/session";

/** Thrown when an operation needs a tax context the session cannot provide. */
export class AccessModeError extends Error {
  constructor(message = "This operation requires GST access") {
    super(message);
    this.name = "AccessModeError";
  }
}

export type FieldErrors = Record<string, string[]>;

export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: FieldErrors): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Domain errors that are safe to show verbatim to the user. */
export class BusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "The requested record could not be found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Wraps a server action so that thrown errors become structured results
 * instead of unhandled exceptions, without leaking internals to the client.
 */
export async function runAction<T>(
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (error) {
    return toActionResult(error);
  }
}

export function toActionResult(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    return fail("Please correct the highlighted fields", flattenZodError(error));
  }
  if (
    error instanceof BusinessRuleError ||
    error instanceof NotFoundError ||
    error instanceof AuthorizationError ||
    error instanceof AuthenticationError ||
    error instanceof AccessModeError
  ) {
    return fail(error.message);
  }
  if (isPrismaUniqueViolation(error)) {
    return fail("A record with these details already exists");
  }
  if (isPrismaForeignKeyViolation(error)) {
    return fail("This record is referenced elsewhere and cannot be changed");
  }

  console.error("[action] unexpected error", error);
  return fail("Something went wrong. Please try again.");
}

export function flattenZodError(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export const isPrismaUniqueViolation = (error: unknown) =>
  hasPrismaCode(error, "P2002");
export const isPrismaForeignKeyViolation = (error: unknown) =>
  hasPrismaCode(error, "P2003");
export const isPrismaNotFound = (error: unknown) => hasPrismaCode(error, "P2025");

/** Maps an error to an HTTP status for route handlers. */
export function errorStatus(error: unknown): number {
  if (error instanceof AuthenticationError) return 401;
  if (error instanceof AuthorizationError || error instanceof AccessModeError) return 403;
  if (error instanceof NotFoundError || isPrismaNotFound(error)) return 404;
  if (error instanceof BusinessRuleError) return 409;
  if (error instanceof z.ZodError) return 422;
  return 500;
}
