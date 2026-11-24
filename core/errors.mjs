/** An error a person can act on: what went wrong, and (optionally) how to fix it. */
export class StudioError extends Error {
  constructor(message, fix) {
    super(message);
    this.fix = fix;
  }
}
