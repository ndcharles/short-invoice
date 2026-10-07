/**
 * Copies text to the clipboard. Resolves true when it worked.
 *
 * The text may be a promise (for example "the short link of the link that is
 * being created right now"). Passing the promise lets the copy start inside the
 * click, which Safari requires: it refuses to write to the clipboard once the
 * click handler has waited on the network. Chrome and Firefox accept either.
 * If the promise fails, nothing is copied and this resolves false.
 */
export function copyText(text: string | Promise<string>): Promise<boolean> {
  const source = Promise.resolve(text);
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const item = new ClipboardItem({ 'text/plain': source.then((value) => new Blob([value], { type: 'text/plain' })) });
      return navigator.clipboard.write([item]).then(
        () => true,
        // Some browsers refuse the promise form; try the plain call once the text is known.
        () => source.then(writePlain, () => false)
      );
    }
  } catch {
    /* fall through to the plain call */
  }
  return source.then(writePlain, () => false);
}

async function writePlain(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return legacyCopy(value);
  }
}

/** Last resort for older browsers and insecure pages: select a hidden field and copy. */
function legacyCopy(value: string): boolean {
  try {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  } catch {
    return false;
  }
}
