import { z } from 'zod';

const invalidNumber = (name: string) => (issue: { input?: unknown }): string =>
  `invalid number for ${name}: ${String(issue.input)}`;

export function parseValue<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  // The legacy key loops ran before the value checks; surface an unknown-key
  // issue first so multi-error input keeps reporting in that order.
  const issue =
    result.error.issues.find((i) => i.code === 'unrecognized_keys') ??
    result.error.issues[0];
  throw new Error(issue.message, { cause: result.error });
}

interface ShapeWording {
  invalid: string;
  unknownKey: (key: string) => string;
}

export function strictShape<T extends z.ZodRawShape>(
  shape: T,
  wording: ShapeWording,
) {
  return z.strictObject(shape, {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? wording.unknownKey(issue.keys[0])
        : wording.invalid,
  });
}

export function numberValue(name: string): z.ZodType<number> {
  return z.number({ error: invalidNumber(name) });
}
