/**
 * Stream framing
 * Auto-generated - DO NOT EDIT
 *
 * A stream response sends each event as one frame: a server-sent event
 * (`event: <name>`, `data: <json>`, a blank line), or one JSON value per
 * line. Routes encode with encodeStream and clients decode with decodeStream.
 */

/** How a stream response frames its events */
export type StreamFormat = 'sse' | 'ndjson';

/** One event's frame: `json` is the event serialized, `name` the value naming its type. */
function encodeFrame(format: StreamFormat, json: string, name: string): string {
  if (format === 'ndjson') return `${json}\n`;
  if (/[\r\n]/.test(name)) {
    throw new Error(`An event name cannot hold a line break: ${JSON.stringify(name)}`);
  }
  return `event: ${name}\ndata: ${json}\n\n`;
}

/**
 * The frames of a stream response, one per event. `first` is what `events`
 * yielded first: a route awaits it before sending anything, so a service that
 * fails at once fails as an ordinary error response. `serialize` writes an
 * event as the contract declares it and throws for one the contract does not;
 * `discriminator` is the property naming each event's type. When the frames
 * stop — every event sent, an event refused, or the client gone — `events`
 * is closed.
 */
export async function* encodeStream<E extends object>(
  format: StreamFormat,
  first: IteratorResult<E>,
  events: AsyncIterator<E>,
  serialize: (event: Record<string, unknown>) => string,
  discriminator: string,
): AsyncGenerator<string> {
  try {
    for (let next = first; !next.done; next = await events.next()) {
      // An event is a JSON object: the serializer, and the frame's name, read its properties
      const event = next.value as Record<string, unknown>;
      yield encodeFrame(format, serialize(event), String(event[discriminator]));
    }
  } finally {
    await events.return?.();
  }
}

/**
 * The events of a stream response, from its text in order — chunks may split
 * anywhere. The `data` lines of a server-sent event join into one JSON
 * value; its other fields carry nothing the event does not.
 */
export async function* decodeStream<E>(format: StreamFormat, text: AsyncIterable<string>): AsyncGenerator<E> {
  let buffer = '';
  let data: string[] = [];
  for await (const chunk of text) {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (format === 'ndjson') {
        if (line.trim() !== '') yield JSON.parse(line) as E;
      } else if (line === '') {
        if (data.length > 0) yield JSON.parse(data.join('\n')) as E;
        data = [];
      } else if (line.startsWith('data:')) {
        data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
      }
    }
  }
  if (format === 'ndjson' && buffer.trim() !== '') yield JSON.parse(buffer) as E;
}
