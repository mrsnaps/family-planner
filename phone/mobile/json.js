// Models sometimes wrap JSON in prose or code fences; pull out the first JSON value.
export function extractJson(text) {
  const s = String(text || '');
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : s;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('The AI didn’t return a usable answer. Try again.');
  const close = body[start] === '[' ? ']' : '}';
  for (let end = body.lastIndexOf(close); end > start; end = body.lastIndexOf(close, end - 1)) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      /* try a shorter slice */
    }
  }
  throw new Error('The AI didn’t return a usable answer. Try again.');
}
