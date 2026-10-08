'use strict';

(async () => {
  const ticket = location.hash.slice(1);
  history.replaceState(null, '', '/operator/unlock');
  try {
    const response = await fetch('/operator/session', { method: 'POST', credentials: 'same-origin', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) });
    if (!response.ok) throw new Error('Access expired.');
    location.replace('/operator/');
  } catch { document.querySelector('#status').textContent = 'Operator access expired. Open a new session from your private terminal.'; }
})();
