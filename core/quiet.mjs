// node:sqlite prints an "experimental feature" warning on load. It is noise for people using the
// studio (and would end up in agent transcripts), so this drops that one warning and nothing else.
// Import this module before anything that loads node:sqlite.
const emit = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const text = typeof warning === 'string' ? warning : warning?.message ?? '';
  if (/SQLite is an experimental feature/i.test(text)) return;
  return emit.call(process, warning, ...rest);
};
