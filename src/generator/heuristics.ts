import type { Rng } from './prng.js';

export const FIRST_NAMES = ['Ava', 'Liam', 'Mia', 'Noah', 'Emma', 'Lucas', 'Sofia', 'Ethan', 'Zoe', 'Mason', 'Ela', 'Mert'] as const;
export const LAST_NAMES = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Miller', 'Davis', 'Wilson', 'Clark', 'Yilmaz', 'Kaya', 'Demir', 'Lopez'] as const;
const CITIES = ['Berlin', 'Istanbul', 'London', 'Madrid', 'Paris', 'Rome', 'Vienna', 'Warsaw'] as const;
const STREETS = ['Main Street', 'Oak Avenue', 'Maple Road', 'Park Lane', 'Cedar Court'] as const;
const WORDS = ['alpha', 'bravo', 'sample', 'orbit', 'delta', 'market', 'green', 'swift', 'north', 'river', 'signal', 'paper'] as const;
const STATUSES = ['active', 'pending', 'completed'] as const;
const COUNTRIES = ['US', 'DE', 'TR', 'GB', 'FR', 'ES'] as const;

export function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function has(words: string[], ...candidates: string[]): boolean {
  return candidates.some((c) => words.includes(c));
}

function endsWithWord(words: string[], ...candidates: string[]): boolean {
  return candidates.includes(words[words.length - 1] ?? '');
}

export function fullName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function sentence(rng: Rng, words: number): string {
  const text = Array.from({ length: words }, () => rng.pick(WORDS)).join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export function uuidFrom(rng: Rng): string {
  const hex = (n: number) => Array.from({ length: n }, () => rng.int(0, 15).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${['8', '9', 'a', 'b'][rng.int(0, 3)]}${hex(3)}-${hex(12)}`;
}

/** Meaningful string for a field name, or undefined when no heuristic applies. */
export function stringForName(name: string, rng: Rng): string | undefined {
  const words = splitWords(name);
  const joined = words.join('');
  if (words.length === 0) return undefined;

  if (has(words, 'email', 'mail')) return `${rng.pick(FIRST_NAMES).toLowerCase()}.${rng.pick(LAST_NAMES).toLowerCase()}@example.com`;
  if (has(words, 'phone', 'mobile', 'tel', 'telephone', 'msisdn')) return `+1 555 01${rng.int(10, 99)}`;
  if (has(words, 'username', 'login', 'handle', 'nickname') || joined === 'userName') return `${rng.pick(FIRST_NAMES).toLowerCase()}_${rng.pick(LAST_NAMES).toLowerCase()}${rng.int(1, 99)}`;
  if (has(words, 'firstname') || (has(words, 'first', 'given') && endsWithWord(words, 'name'))) return rng.pick(FIRST_NAMES);
  if (has(words, 'lastname', 'surname', 'familyname') || (has(words, 'last', 'family') && endsWithWord(words, 'name'))) return rng.pick(LAST_NAMES);
  if (endsWithWord(words, 'name') && words.length === 1) return fullName(rng);
  if (has(words, 'fullname', 'displayname', 'ownername', 'authorname') || (endsWithWord(words, 'name') && has(words, 'full', 'display', 'user', 'customer', 'owner', 'author'))) return fullName(rng);
  if (has(words, 'image', 'avatar', 'photo', 'picture', 'thumbnail', 'icon', 'logo', 'cover', 'banner')) return `https://example.com/images/${rng.int(1, 999)}.png`;
  if (has(words, 'url', 'uri', 'link', 'website', 'homepage', 'href')) return `https://example.com/${rng.pick(WORDS)}/${rng.int(1, 999)}`;
  if (has(words, 'currency') || joined.endsWith('currencycode')) return 'USD';
  if (has(words, 'country') || joined.endsWith('countrycode')) return rng.pick(COUNTRIES);
  if (has(words, 'city', 'town')) return rng.pick(CITIES);
  if (has(words, 'street', 'address', 'addr') && !has(words, 'email', 'ip')) return `${rng.int(1, 200)} ${rng.pick(STREETS)}`;
  if (has(words, 'zip', 'postal', 'postcode', 'zipcode')) return `${rng.int(10000, 99999)}`;
  if (has(words, 'state', 'province', 'region') && words.length === 1) return rng.pick(CITIES);
  if (has(words, 'token', 'jwt', 'secret', 'apikey') || joined.endsWith('token')) return `mock-${words.join('-')}-${rng.int(100000, 999999)}`;
  if (has(words, 'password', 'pin')) return 'Passw0rd!';
  if (has(words, 'color', 'colour')) return '#3366FF';
  if (has(words, 'locale', 'language', 'lang')) return 'en';
  if (has(words, 'version')) return `1.${rng.int(0, 9)}.${rng.int(0, 9)}`;
  if (has(words, 'timezone', 'tz')) return 'Europe/Istanbul';
  if (has(words, 'status', 'state')) return rng.pick(STATUSES);
  if (has(words, 'type', 'kind', 'category')) return rng.pick(['standard', 'premium', 'basic'] as const);
  if (has(words, 'code', 'sku', 'reference', 'ref', 'number', 'no')) return `${rng.pick(['AB', 'XZ', 'MK'] as const)}${rng.int(1000, 9999)}`;
  if (has(words, 'title', 'subject', 'headline', 'label')) return sentence(rng, 3).replace(/\.$/, '');
  if (has(words, 'description', 'summary', 'text', 'body', 'message', 'comment', 'note', 'content', 'bio', 'detail', 'details')) return sentence(rng, 8);
  if (endsWithWord(words, 'name', 'title')) return sentence(rng, 2).replace(/\.$/, '');
  if (endsWithWord(words, 'id', 'key', 'uid', 'uuid', 'guid')) return uuidFrom(rng);
  return undefined;
}

/** Meaningful number for a field name. Integers stay integers. */
export function numberForName(name: string, rng: Rng, integer: boolean): number | undefined {
  const words = splitWords(name);
  if (has(words, 'latitude', 'lat')) return Math.round((rng.next() * 180 - 90) * 10000) / 10000;
  if (has(words, 'longitude', 'lng', 'lon', 'long') && words.length === 1) return Math.round((rng.next() * 360 - 180) * 10000) / 10000;
  if (has(words, 'age')) return rng.int(18, 80);
  if (has(words, 'rating', 'score', 'stars')) return integer ? rng.int(1, 5) : Math.round((1 + rng.next() * 4) * 10) / 10;
  if (has(words, 'year')) return rng.int(2018, 2026);
  if (has(words, 'page')) return 1;
  if (has(words, 'limit', 'size', 'perpage', 'pagesize')) return 20;
  if (has(words, 'percent', 'percentage', 'ratio', 'progress')) return integer ? rng.int(0, 100) : Math.round(rng.next() * 10000) / 10000;
  if (has(words, 'count', 'quantity', 'qty', 'stock', 'items', 'likes', 'views', 'comments')) return rng.int(1, 20);
  if (has(words, 'price', 'amount', 'total', 'cost', 'balance', 'fee', 'salary', 'subtotal', 'tax', 'discount', 'value')) {
    return integer ? rng.int(100, 99999) : Math.round((1 + rng.next() * 499) * 100) / 100;
  }
  if (endsWithWord(words, 'id', 'uid')) return rng.int(1, 9999);
  return undefined;
}

export function booleanForName(name: string): boolean {
  const words = splitWords(name);
  if (has(words, 'deleted', 'disabled', 'blocked', 'banned', 'hidden', 'archived', 'expired', 'error', 'failed', 'cancelled', 'canceled')) return false;
  return true;
}

export function sampleInstant(name: string, rng: Rng): Date {
  const words = splitWords(name);
  if (has(words, 'birth', 'birthday', 'dob', 'born')) return new Date(Date.UTC(1990, rng.int(0, 11), rng.int(1, 28), 0, 0, 0));
  const base = Date.UTC(2024, 0, 15, 10, 30, 0);
  const offsetDays = has(words, 'updated', 'modified', 'changed') ? rng.int(1, 30) : has(words, 'expires', 'expiry', 'expiration', 'due', 'end', 'until') ? rng.int(60, 365) : -rng.int(1, 90);
  return new Date(base + offsetDays * 86_400_000);
}

export function humanize(name: string): string {
  const words = splitWords(name);
  return words.length > 0 ? words.join(' ') : 'value';
}
