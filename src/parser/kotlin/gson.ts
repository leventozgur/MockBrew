import type { FrameworkAdapter } from './annotations.js';

/** com.google.gson: @SerializedName(value, alternate), @JsonAdapter, kotlin/jvm @Transient. */
export const gsonAdapter: FrameworkAdapter = {
  id: 'gson',
  apply(annotation, reader, out) {
    switch (annotation.name) {
      case 'SerializedName': {
        const value = reader.string('value');
        if (value !== undefined) out.jsonName = value;
        else if (reader.hasArg('value')) out.unresolved = 'SerializedName';
        const alternate = reader.strings('alternate', 1);
        if (alternate?.length) out.alternateNames = alternate;
        break;
      }
      case 'JsonAdapter':
        out.customAdapter = true;
        break;
      case 'Transient':
        out.transient = true;
        break;
      default:
        break;
    }
  },
};
