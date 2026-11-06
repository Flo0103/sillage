// Maps an error thrown by a request handler to an HTTP answer.
//
// Convention kept from the existing code: a plain Error without `code` carries a
// message written for the user (validation) and is answered with its `status`
// or 400. Everything else is classified so that internal details are never sent
// to the browser and unexpected failures are logged.

const networkCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']);
const programmingErrors = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'EvalError', 'URIError']);

const isPostgres = e => typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) && typeof e.severity === 'string';
const isNetwork = e => (e?.name === 'TypeError' && e.message === 'fetch failed') || networkCodes.has(e?.code) || (typeof e?.code === 'string' && e.code.startsWith('UND_ERR_'));

export function errorResponse(e) {
  const unavailable = { status: 503, message: 'Service temporairement indisponible.' };
  const internal = { status: 500, message: 'Erreur interne. Réessayez ; si le problème persiste, signalez-le.', log: true };
  if (!e || typeof e !== 'object') return internal;
  // An explicit status means the thrower chose the answer (validation, quotas,
  // routing 422 / 503, Strava 409…). Its message is written for the user.
  if (Number.isInteger(e.status) && e.status >= 400 && e.status <= 599) return { status: e.status, message: e.message || 'Requête invalide.' };
  if (isNetwork(e)) return { ...unavailable, log: 'network' };
  // node-postgres: pool exhausted past connectionTimeoutMillis, or connection timeout.
  if (e.code === undefined && /^(timeout exceeded when trying to connect|Connection terminated due to connection timeout)$/.test(e.message)) return { ...unavailable, log: 'database' };
  if (isPostgres(e)) {
    if (e.code === '23505') return { status: 409, message: 'Cette ressource existe déjà ou vient d’être modifiée. Rechargez la page.' };
    if (e.code === '40001' || e.code === '40P01') return { status: 409, message: 'Modification simultanée. Réessayez.' };
    if (e.code === '57014') return { status: 503, message: 'La base de données a mis trop de temps à répondre. Réessayez.', log: 'database' };
    if (/^(08|53|57)/.test(e.code)) return { ...unavailable, log: 'database' };
    if (e.code.startsWith('22')) return { status: 400, message: 'Requête invalide.' };
    return internal;
  }
  // AbortSignal.timeout() rejects with a DOMException whose numeric `code` is 23.
  if (e.name === 'TimeoutError') return { status: 504, message: 'OSM est trop lent. Réessayez ou utilisez le mode manuel.' };
  if (programmingErrors.has(e.name)) return internal;
  // Custom codes without a status (system or library failures) stay generic.
  if (e.code !== undefined) return { ...unavailable, log: 'code' };
  return { status: 400, message: e.message || 'Requête invalide.' };
}

export function logError(e, kind, { method, path } = {}) {
  if (kind === true) console.error(JSON.stringify({ event: 'request_error', method, path, name: e?.name, code: e?.code, message: e?.message, stack: e?.stack }));
  else console.error(JSON.stringify({ event: 'request_unavailable', kind, method, path, name: e?.name, code: e?.code }));
}
