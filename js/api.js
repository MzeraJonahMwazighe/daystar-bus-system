// Shared API helper for every page.
// The pages are served by the same Express server as the API (locally and on Render),
// so plain relative URLs like "/api/buses" work everywhere. A page opened straight
// from disk (file://) falls back to a locally running server.
(function () {
  const base = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return { ok: response.ok, status: response.status, data };
  }

  window.DaystarApi = { base, request };
})();
