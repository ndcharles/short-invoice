/**
 * The "contains this text" test behind the list searches (links, UTM campaigns, invoices).
 *
 * Not `LIKE '%text%'`, for two reasons. D1 refuses a LIKE pattern longer than 50 bytes ("LIKE or GLOB pattern
 * too complex"), so pasting a destination address into a search box ended in a server error. And LIKE reads the
 * person's own `%` and `_` as wildcards, so searching for "50%" or "a_b" matched things it should not.
 * `instr()` has neither problem. Capital and small A-Z letters are treated alike, as with LIKE.
 *
 * `column` is always a name written in the code, never anything from the request; the text itself goes in as a
 * bound parameter (`placeholder` is its `?` or `?3`).
 */
export const containsText = (column: string, placeholder: string) => `instr(lower(coalesce(${column}, '')), lower(${placeholder})) > 0`;
