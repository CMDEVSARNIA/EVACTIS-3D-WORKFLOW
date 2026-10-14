import { CURRENT_SCHEMA_VERSION } from './environment.ts';

/** A step that upgrades a raw document from version `from` to `from + 1`. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registered upgrades keyed by the version they upgrade *from*. Version 1 is the
 * first public schema, so the table is empty. Add `1: (doc) => ({ ...doc, ... })`
 * when version 2 ships, never edit a released migration.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export class SchemaVersionError extends Error {
  constructor(
    message: string,
    readonly found: unknown,
  ) {
    super(message);
    this.name = 'SchemaVersionError';
  }
}

/**
 * Upgrades a raw (unvalidated) document to the current schema version.
 * Documents from a newer version are refused rather than silently downgraded.
 */
export function migrateEnvironment(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new SchemaVersionError('Environment document must be a JSON object', raw);
  let doc = raw as Record<string, unknown>;
  const version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new SchemaVersionError('Missing or invalid schemaVersion', version);
  if (version > target)
    throw new SchemaVersionError(
      `This environment was created by a newer version of EVACTIS 3DWORKFLOW (schema ${version}; this build reads up to ${target}).`,
      version,
    );
  for (let v = version; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new SchemaVersionError(`No migration from schema ${v} to ${v + 1}`, v);
    doc = { ...step(doc), schemaVersion: v + 1 };
  }
  return doc;
}
