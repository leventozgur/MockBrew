import type { ScalarKind } from './ir.js';

const kotlinScalars: Record<string, ScalarKind> = {
  String: 'string',
  Char: 'string',
  CharSequence: 'string',
  Boolean: 'boolean',
  Int: 'int32',
  Short: 'int32',
  Byte: 'int32',
  UInt: 'int32',
  UShort: 'int32',
  UByte: 'int32',
  Long: 'int64',
  ULong: 'int64',
  Float: 'double',
  Double: 'double',
  Number: 'double',
  BigDecimal: 'decimal',
  BigInteger: 'int64',
  Date: 'instant',
  Instant: 'instant',
  LocalDateTime: 'instant',
  OffsetDateTime: 'instant',
  ZonedDateTime: 'instant',
  Timestamp: 'instant',
  LocalDate: 'localDate',
  LocalTime: 'localTime',
  UUID: 'uuid',
  Uuid: 'uuid',
  URL: 'url',
  URI: 'url',
  Url: 'url',
  Any: 'any',
  JsonElement: 'any',
  JsonObject: 'any',
  JsonArray: 'any',
};

const kotlinListNames = new Set([
  'List',
  'MutableList',
  'ArrayList',
  'Collection',
  'MutableCollection',
  'Iterable',
  'Set',
  'MutableSet',
  'HashSet',
  'LinkedHashSet',
  'SortedSet',
  'Array',
]);

const kotlinMapNames = new Set(['Map', 'MutableMap', 'HashMap', 'LinkedHashMap', 'SortedMap', 'TreeMap']);

const kotlinPrimitiveArrays: Record<string, ScalarKind> = {
  IntArray: 'int32',
  LongArray: 'int64',
  ShortArray: 'int32',
  ByteArray: 'base64',
  FloatArray: 'double',
  DoubleArray: 'double',
  BooleanArray: 'boolean',
  CharArray: 'string',
};

export function kotlinScalar(name: string): ScalarKind | undefined {
  return kotlinScalars[name];
}

export function isKotlinList(name: string): boolean {
  return kotlinListNames.has(name);
}

export function isKotlinMap(name: string): boolean {
  return kotlinMapNames.has(name);
}

export function kotlinPrimitiveArray(name: string): ScalarKind | undefined {
  return kotlinPrimitiveArrays[name];
}

const swiftScalars: Record<string, ScalarKind> = {
  String: 'string',
  Character: 'string',
  Substring: 'string',
  Bool: 'boolean',
  Int: 'int64',
  Int8: 'int32',
  Int16: 'int32',
  Int32: 'int32',
  Int64: 'int64',
  UInt: 'int64',
  UInt8: 'int32',
  UInt16: 'int32',
  UInt32: 'int64',
  UInt64: 'int64',
  Float: 'double',
  Double: 'double',
  CGFloat: 'double',
  Float32: 'double',
  Float64: 'double',
  Decimal: 'decimal',
  NSDecimalNumber: 'decimal',
  Date: 'instant',
  URL: 'url',
  UUID: 'uuid',
  Data: 'base64',
};

export function swiftScalar(name: string): ScalarKind | undefined {
  return swiftScalars[name];
}
