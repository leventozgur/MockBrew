import type { FrameworkAdapter } from './annotations.js';

/** com.squareup.moshi: @Json(name, ignore), @JsonClass. */
export const moshiAdapter: FrameworkAdapter = {
  id: 'moshi',
  apply(annotation, reader, out) {
    if (annotation.name === 'Transient') out.transient = true;
    if (annotation.name !== 'Json') return;
    const name = reader.string('name');
    if (name !== undefined) out.jsonName = name;
    else if (reader.hasArg('name')) out.unresolved = 'Json';
    if (reader.boolean('ignore') === true) out.transient = true;
  },
};
