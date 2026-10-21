import { t } from '/i18n.js';

const API = '/api/extensions/homey';

export function reasonMessage(reason, detail) {
  if (detail && (reason === 'address' || reason === 'homey_unreachable')) {
    const specific = `extensions.homey.reason.${reason}.${detail}`;
    const specificText = t(specific);
    if (specificText !== specific) return specificText;
  }
  if (reason) {
    const key = `extensions.homey.reason.${reason}`;
    const text = t(key);
    if (text !== key) return text;
  }
  return t('extensions.homey.reason.invalid');
}

export async function homeyApi(path, { method = 'GET', body, signal, csrf } = {}) {
  const send = async (token) => {
    const response = await fetch(`${API}${path}`, {
      method,
      credentials: 'same-origin',
      signal,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { 'X-Homey-CSRF': token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  };

  let { response, data } = await send(csrf);
  if (response.status === 403 && data?.reason === 'csrf' && data.csrfToken && data.csrfToken !== csrf) {
    ({ response, data } = await send(data.csrfToken));
  }
  if (!response.ok) {
    const error = new Error(reasonMessage(data?.reason, data?.detail));
    error.status = response.status;
    error.reason = data?.reason;
    error.detail = data?.detail;
    error.csrfToken = data?.csrfToken;
    throw error;
  }
  return data;
}

export function field(label, { id, type = 'text', hint, value = '', placeholder = '', autocomplete = 'off' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'form-group';
  const labelEl = document.createElement('label');
  labelEl.className = 'form-label';
  labelEl.htmlFor = id;
  labelEl.textContent = label;
  const input = document.createElement('input');
  input.className = 'form-input';
  input.id = id;
  input.type = type;
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = autocomplete;
  input.spellcheck = false;
  wrap.append(labelEl, input);
  if (hint) {
    const hintEl = document.createElement('p');
    hintEl.className = 'form-hint';
    hintEl.textContent = hint;
    wrap.append(hintEl);
  }
  return { wrap, input };
}

export function button(label, className) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
}

export function heading(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Household connection form. Callers pass the status payload from GET /status.
 * The API key field is always empty: a stored key is never sent back.
 */
export function mountConnectionForm(container, { status, signal, onSaved, headingLevel = 'h3' }) {
  container.replaceChildren();
  container.append(heading(headingLevel, 'homey-heading', t('extensions.homey.settings.heading')));
  const intro = document.createElement('p');
  intro.className = 'form-hint';
  intro.textContent = t('extensions.homey.settings.intro');
  container.append(intro);

  if (!status?.admin) {
    const note = document.createElement('p');
    note.textContent = t('extensions.homey.page.askAdmin');
    container.append(note);
    return;
  }

  const address = field(t('extensions.homey.settings.address'), {
    id: 'homey-address',
    hint: t('extensions.homey.settings.addressHint'),
    value: status.address || '',
    placeholder: 'http://192.168.1.50',
    autocomplete: 'url',
  });
  const token = field(t('extensions.homey.settings.token'), {
    id: 'homey-token',
    type: 'password',
    hint: status.tokenSet
      ? t('extensions.homey.settings.tokenHint')
      : t('extensions.homey.settings.where'),
    placeholder: status.tokenSet ? t('extensions.homey.settings.tokenSet') : '',
    autocomplete: 'off',
  });
  const actions = document.createElement('div');
  actions.className = 'homey-actions';
  const save = button(t('extensions.homey.settings.save'), 'btn btn--primary');
  save.id = 'homey-save';
  const test = button(t('extensions.homey.settings.test'), 'btn btn--secondary');
  test.id = 'homey-test';
  test.disabled = !status.configured;
  const disconnect = button(t('extensions.homey.settings.disconnect'), 'btn btn--danger-outline');
  disconnect.id = 'homey-disconnect';
  disconnect.disabled = !status.configured;
  actions.append(save, test, disconnect);
  const result = document.createElement('p');
  result.id = 'homey-connection-status';
  result.className = 'form-hint';
  result.setAttribute('role', 'status');
  container.append(address.wrap, token.wrap, actions, result);

  let csrf = status.csrfToken || '';
  const listen = (el, type, fn) => el.addEventListener(type, fn, { signal });

  function note(message, ok) {
    result.textContent = message;
    result.classList.toggle('form-hint--success', ok === true);
    result.classList.toggle('form-hint--danger', ok === false);
  }

  async function run(fn) {
    save.disabled = true;
    test.disabled = true;
    disconnect.disabled = true;
    try {
      await fn();
    } catch (err) {
      if (signal?.aborted) return;
      if (err?.csrfToken) csrf = err.csrfToken;
      note(err.message || reasonMessage(err.reason, err.detail), false);
    } finally {
      if (!signal?.aborted) {
        save.disabled = false;
        test.disabled = false;
        disconnect.disabled = false;
      }
    }
  }

  listen(save, 'click', () => run(async () => {
    const data = await homeyApi('/connection', {
      method: 'PUT',
      csrf,
      signal,
      body: { address: address.input.value.trim(), token: token.input.value },
    });
    csrf = data.csrfToken || csrf;
    token.input.value = '';
    note(
      data.reachable
        ? t('extensions.homey.settings.saved')
        : reasonMessage('homey_unreachable', data.detail),
      data.reachable,
    );
    if (onSaved) await onSaved(data);
  }));

  listen(test, 'click', () => run(async () => {
    const data = await homeyApi('/connection/test', { method: 'POST', csrf, signal, body: {} });
    csrf = data.csrfToken || csrf;
    note(t('extensions.homey.settings.tested'), true);
  }));

  listen(disconnect, 'click', () => run(async () => {
    const data = await homeyApi('/connection', { method: 'DELETE', csrf, signal });
    csrf = data.csrfToken || csrf;
    address.input.value = '';
    token.input.value = '';
    note(t('extensions.homey.settings.disconnected'), true);
    if (onSaved) await onSaved(data);
  }));

  if (status?.admin) mountRing(container, { status, signal, csrf: () => csrf, setCsrf: (value) => { csrf = value; } });
}

function mountRing(container, { status, signal, csrf, setCsrf }) {
  const block = document.createElement('section');
  block.className = 'homey-ring';
  container.append(block);

  function paint({ ringSet, url }) {
    block.replaceChildren();
    block.append(heading('h3', 'homey-heading', t('extensions.homey.settings.ringHeading')));
    const intro = document.createElement('p');
    intro.className = 'form-hint';
    intro.textContent = t('extensions.homey.settings.ringIntro');
    block.append(intro);
    if (url) {
      const input = document.createElement('input');
      input.className = 'form-input';
      input.readOnly = true;
      input.value = url;
      input.setAttribute('aria-label', t('extensions.homey.settings.ringUrl'));
      const copy = button(t('extensions.homey.settings.ringCopy'), 'btn btn--secondary');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          input.select();
        }
      }, { signal });
      const row = document.createElement('div');
      row.className = 'homey-actions';
      row.append(input, copy);
      block.append(row);
    } else if (ringSet) {
      const stored = document.createElement('p');
      stored.className = 'form-hint';
      stored.textContent = t('extensions.homey.settings.ringReady');
      block.append(stored);
    }
    const actions = document.createElement('div');
    actions.className = 'homey-actions';
    const create = button(
      ringSet || url ? t('extensions.homey.settings.ringNew') : t('extensions.homey.settings.ringCreate'),
      'btn btn--secondary',
    );
    create.addEventListener('click', async () => {
      create.disabled = true;
      try {
        const data = await homeyApi('/ring-token', { method: 'POST', csrf: csrf(), signal, body: {} });
        setCsrf(data.csrfToken || csrf());
        const next = `${location.origin}/api/extensions/homey/ring?token=${encodeURIComponent(data.token)}`;
        paint({ ringSet: true, url: next });
      } catch (err) {
        if (err?.csrfToken) setCsrf(err.csrfToken);
        create.disabled = false;
      }
    }, { signal });
    actions.append(create);
    if (ringSet || url) {
      const remove = button(t('extensions.homey.settings.ringClear'), 'btn btn--danger-outline');
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          const data = await homeyApi('/ring-token', { method: 'DELETE', csrf: csrf(), signal });
          setCsrf(data.csrfToken || csrf());
          paint({ ringSet: false, url: '' });
        } catch (err) {
          if (err?.csrfToken) setCsrf(err.csrfToken);
          remove.disabled = false;
        }
      }, { signal });
      actions.append(remove);
    }
    block.append(actions);
  }

  paint({ ringSet: status.ringSet === true, url: '' });
}
