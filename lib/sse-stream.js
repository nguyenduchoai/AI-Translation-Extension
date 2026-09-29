// SSE events can span network chunks, lines and split UTF-8 code points.
export async function* readSseEvents(body) {
  if (!body) throw new Error('API không trả về luồng dữ liệu.');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let data = [];
  const consume = (line) => {
    if (line === '') {
      const event = data.length ? data.join('\n') : null;
      data = [];
      return event;
    }
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    return null;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Preserve a trailing CR until the next chunk in case it is CRLF.
      let match;
      while ((match = /\r\n|\n|\r(?!$)/.exec(buffer))) {
        const event = consume(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (event !== null) yield event;
      }
      if (done) break;
    }
    if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1);
    if (buffer) {
      const event = consume(buffer);
      if (event !== null) yield event;
    }
    const tail = consume('');
    if (tail !== null) yield tail;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
