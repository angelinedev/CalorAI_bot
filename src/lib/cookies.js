export function parseCookies(header = '') {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const index = pair.indexOf('=');
      if (index === -1) {
        return acc;
      }
      acc[decodeURIComponent(pair.slice(0, index))] = decodeURIComponent(pair.slice(index + 1));
      return acc;
    }, {});
}

export function createSessionCookie(token, maxAgeSeconds = 60 * 60 * 24 * 7) {
  return `calor_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return 'calor_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
