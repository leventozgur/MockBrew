import type { FrameworkAdapter } from './annotations.js';

/** kotlinx.serialization: @SerialName, @Transient, @Serializable(with = ...). */
export const kotlinxAdapter: FrameworkAdapter = {
  id: 'kotlinx',
  apply(annotation, reader, out) {
    switch (annotation.name) {
      case 'SerialName': {
        const value = reader.string('value');
        if (value !== undefined) out.jsonName = value;
        else out.unresolved = 'SerialName';
        break;
      }
      case 'Transient':
        out.transient = true;
        break;
      case 'Serializable':
        if (reader.hasArg('with')) out.customAdapter = true;
        break;
      default:
        break;
    }
  },
};
