/**
 * Hides Node's one-line "SQLite is an experimental feature" notice, which would
 * otherwise greet every administrator at start-up. Imported first by bin.ts so it runs
 * before node:sqlite loads; every other warning is still printed.
 */
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (/SQLite is an experimental feature/.test(text)) return;
  (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
