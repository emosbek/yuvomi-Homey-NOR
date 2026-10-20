import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { mountEmptyState } from '/utils/empty-state.js';
import { renderPageBody, renderPageHeader, renderPageSection, renderPageTitle } from '/utils/page-layout.js';
import { showToast } from '/utils/toast-show.js';
import { button, heading, homeyApi, mountConnectionForm } from './browser.js';

function paintIcons(root) {
  if (window.lucide) window.lucide.createIcons({ el: root });
}

function valueLabel(pin) {
  if (pin.unavailable) return t('extensions.homey.page.unavailable');
  if (typeof pin.value === 'boolean') {
    return pin.value ? t('extensions.homey.page.on') : t('extensions.homey.page.off');
  }
  if (pin.value == null || pin.value === '') return '';
  return String(pin.value);
}

function shell() {
  return renderPageHeader({
    title: renderPageTitle(esc(t('extensions.homey.page.title'))),
  }) + renderPageBody({
    content: renderPageSection({ id: 'homey-connection', content: '' })
      + renderPageSection({
        id: 'homey-board',
        content: `<h2 class="homey-heading">${esc(t('extensions.homey.page.pinsTitle'))}</h2>`
          + '<p id="homey-banner" class="form-hint" role="status"></p>'
          + '<div id="homey-pin-empty"></div>'
          + '<div id="homey-pin-grid" class="homey-grid"></div>',
      })
      + renderPageSection({ id: 'homey-add', content: '' }),
  });
}

export async function render(container, context) {
  const signal = context?.signal;
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', shell());
  const connection = container.querySelector('#homey-connection');
  const empty = container.querySelector('#homey-pin-empty');
  const grid = container.querySelector('#homey-pin-grid');
  const add = container.querySelector('#homey-add');
  const banner = container.querySelector('#homey-banner');
  let csrf = '';
  let access = 'read';
  let gone = false;
  signal?.addEventListener('abort', () => { gone = true; }, { once: true });

  function fail(err) {
    if (gone) return;
    banner.textContent = err?.message || t('extensions.homey.reason.invalid');
    banner.classList.add('form-hint--danger');
  }

  function showBanner(status) {
    banner.classList.remove('form-hint--danger', 'form-hint--success');
    if (status && status.configured === false) banner.textContent = t('extensions.homey.page.notConfigured');
    else if (status?.access === 'read') banner.textContent = t('extensions.homey.page.readOnly');
    else banner.textContent = '';
  }

  async function refreshPins() {
    const data = await homeyApi('/pins', { signal, csrf });
    if (gone) return;
    csrf = data.csrfToken || csrf;
    grid.replaceChildren();
    empty.replaceChildren();
    if (!data.pins?.length) {
      mountEmptyState(empty, {
        icon: 'house',
        title: t('extensions.homey.page.emptyTitle'),
        description: t('extensions.homey.page.emptyBody'),
      });
      return;
    }
    for (const pin of data.pins) grid.append(pinCard(pin));
    paintIcons(grid);
  }

  function pinCard(pin) {
    const card = document.createElement('div');
    card.className = 'homey-pin-card';
    const press = document.createElement('button');
    press.type = 'button';
    press.className = `card card--interactive card--padded homey-pin${pin.value === true ? ' homey-pin--on' : ''}`;
    press.dataset.pinId = pin.id;
    if (pin.mode === 'toggle') press.setAttribute('aria-pressed', pin.value === true ? 'true' : 'false');
    press.disabled = access !== 'write' || pin.unavailable;
    const label = document.createElement('span');
    label.className = 'homey-pin__label';
    label.textContent = pin.label;
    const detail = document.createElement('span');
    detail.className = 'homey-pin__detail';
    detail.textContent = pin.detail || '';
    const value = document.createElement('span');
    value.className = 'homey-pin__value';
    value.textContent = valueLabel(pin);
    press.append(label, detail, value);
    press.addEventListener('click', () => activate(pin, press), { signal });
    card.append(press);
    if (access === 'write') {
      const remove = button(t('extensions.homey.page.remove'), 'btn btn--secondary');
      remove.addEventListener('click', () => removePin(pin.id), { signal });
      card.append(remove);
    }
    return card;
  }

  async function activate(pin, press) {
    press.disabled = true;
    try {
      const data = await homeyApi(`/pins/${encodeURIComponent(pin.id)}/activate`, {
        method: 'POST',
        csrf,
        signal,
        body: {},
      });
      csrf = data.csrfToken || csrf;
      showToast(t('extensions.homey.page.sent'), 'success');
      await refreshPins();
    } catch (err) {
      if (err?.csrfToken) csrf = err.csrfToken;
      fail(err);
    } finally {
      if (!gone && press.isConnected) press.disabled = access !== 'write';
    }
  }

  async function removePin(id) {
    try {
      const data = await homeyApi(`/pins/${encodeURIComponent(id)}`, { method: 'DELETE', csrf, signal });
      csrf = data.csrfToken || csrf;
      showToast(t('extensions.homey.page.removed'), 'success');
      await refreshPins();
    } catch (err) {
      if (err?.csrfToken) csrf = err.csrfToken;
      fail(err);
    }
  }

  async function addPin(body) {
    const data = await homeyApi('/pins', { method: 'POST', csrf, signal, body });
    csrf = data.csrfToken || csrf;
    showToast(t('extensions.homey.page.pinned'), 'success');
    await refreshPins();
  }

  function catalogControl(cap) {
    if (cap.type === 'number') {
      const input = document.createElement('input');
      input.className = 'form-input';
      input.type = 'number';
      input.step = 'any';
      input.setAttribute('aria-label', t('extensions.homey.page.value'));
      if (typeof cap.value === 'number') input.value = String(cap.value);
      return input;
    }
    if (Array.isArray(cap.values) && cap.values.length) {
      const select = document.createElement('select');
      select.className = 'form-input';
      select.setAttribute('aria-label', t('extensions.homey.page.value'));
      for (const option of cap.values) {
        const el = document.createElement('option');
        el.value = option.id;
        el.textContent = option.title;
        select.append(el);
      }
      return select;
    }
    if (cap.type === 'string') {
      const input = document.createElement('input');
      input.className = 'form-input';
      input.type = 'text';
      input.maxLength = 200;
      input.setAttribute('aria-label', t('extensions.homey.page.value'));
      return input;
    }
    return null;
  }

  function capabilityBody(device, cap, control) {
    const detail = [device.zone, cap.title].filter(Boolean).join(' · ');
    const base = {
      kind: 'capability',
      label: device.name,
      detail,
      deviceId: device.id,
      capabilityId: cap.id,
    };
    if (cap.type === 'boolean' || cap.id === 'onoff') return { ...base, mode: 'toggle' };
    if (cap.type === 'button' || cap.id === 'button') return { ...base, mode: 'set', value: true };
    if (!control) return { ...base, mode: 'set', value: true };
    if (control.type === 'number') {
      const value = Number(control.value);
      if (!Number.isFinite(value)) return null;
      return { ...base, mode: 'set', value, detail: `${detail} · ${value}` };
    }
    const value = control.value;
    if (!value) return null;
    return { ...base, mode: 'set', value, detail: `${detail} · ${value}` };
  }

  function renderCatalog(catalog) {
    add.replaceChildren();
    add.hidden = false;
    add.append(heading('h2', 'homey-heading', t('extensions.homey.page.addTitle')));
    const tools = document.createElement('div');
    tools.className = 'homey-actions';
    const filter = document.createElement('input');
    filter.className = 'form-input';
    filter.id = 'homey-filter';
    filter.type = 'search';
    filter.placeholder = t('extensions.homey.page.filter');
    filter.setAttribute('aria-label', t('extensions.homey.page.filter'));
    const refresh = button(t('extensions.homey.page.refresh'), 'btn btn--secondary');
    refresh.id = 'homey-refresh';
    tools.append(filter, refresh);
    add.append(tools);
    if (catalog.warning === 'flows_unavailable') {
      const warning = document.createElement('p');
      warning.className = 'form-hint form-hint--warning';
      warning.textContent = t('extensions.homey.page.flowsUnavailable');
      add.append(warning);
    }
    const list = document.createElement('div');
    list.className = 'homey-catalog';
    add.append(list);

    const groups = [
      [t('extensions.homey.page.devices'), catalog.devices || [], 'device'],
      [t('extensions.homey.page.flows'), catalog.flows || [], 'flow'],
      [t('extensions.homey.page.advancedFlows'), catalog.advancedFlows || [], 'advanced'],
    ];
    for (const [title, items, kind] of groups) {
      if (!items.length) continue;
      const block = document.createElement('section');
      block.append(heading('h3', 'homey-heading', title));
      for (const item of items) block.append(kind === 'device' ? deviceCard(item) : flowCard(item, kind === 'advanced'));
      list.append(block);
    }
    list.append(webhookCard());
    paintIcons(add);

    filter.addEventListener('input', () => {
      const query = filter.value.trim().toLowerCase();
      for (const card of list.querySelectorAll('[data-homey-item]')) {
        const haystack = card.textContent.toLowerCase();
        card.hidden = Boolean(query) && !haystack.includes(query);
      }
    }, { signal });
    refresh.addEventListener('click', () => loadCatalog().catch(fail), { signal });
  }

  function deviceCard(device) {
    const card = document.createElement('article');
    card.className = 'card card--padded homey-device';
    card.dataset.homeyItem = 'device';
    card.append(heading('h3', null, device.name));
    if (device.zone) {
      const zone = document.createElement('p');
      zone.className = 'form-hint';
      zone.textContent = device.zone;
      card.append(zone);
    }
    const rows = document.createElement('ul');
    rows.className = 'homey-caps';
    for (const cap of device.capabilities || []) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = cap.title || cap.id;
      const control = catalogControl(cap);
      const addButton = button(t('extensions.homey.page.add'), 'btn btn--secondary');
      addButton.addEventListener('click', async () => {
        const body = capabilityBody(device, cap, control);
        if (!body) {
          fail(new Error(t('extensions.homey.reason.invalid')));
          return;
        }
        addButton.disabled = true;
        try {
          await addPin(body);
        } catch (err) {
          if (err?.csrfToken) csrf = err.csrfToken;
          fail(err);
        } finally {
          addButton.disabled = false;
        }
      }, { signal });
      row.append(name);
      if (control) row.append(control);
      row.append(addButton);
      rows.append(row);
    }
    card.append(rows);
    return card;
  }

  function flowCard(flow, advanced) {
    const card = document.createElement('article');
    card.className = 'card card--padded homey-device';
    card.dataset.homeyItem = 'flow';
    const row = document.createElement('div');
    row.className = 'homey-flow';
    const name = document.createElement('span');
    name.textContent = flow.name;
    const addButton = button(t('extensions.homey.page.add'), 'btn btn--secondary');
    addButton.addEventListener('click', async () => {
      addButton.disabled = true;
      try {
        await addPin({
          kind: 'flow',
          label: flow.name,
          detail: advanced
            ? t('extensions.homey.page.advancedFlows')
            : t('extensions.homey.page.flows'),
          flowId: flow.id,
          advanced,
        });
      } catch (err) {
        if (err?.csrfToken) csrf = err.csrfToken;
        fail(err);
      } finally {
        addButton.disabled = false;
      }
    }, { signal });
    row.append(name, addButton);
    card.append(row);
    return card;
  }

  function webhookCard() {
    const card = document.createElement('article');
    card.className = 'card card--padded homey-device';
    card.dataset.homeyItem = 'webhook';
    card.append(heading('h3', null, t('extensions.homey.page.webhooks')));
    const event = document.createElement('input');
    event.className = 'form-input';
    event.id = 'homey-webhook-event';
    event.placeholder = t('extensions.homey.page.webhookEvent');
    event.setAttribute('aria-label', t('extensions.homey.page.webhookEvent'));
    event.autocomplete = 'off';
    const tag = document.createElement('input');
    tag.className = 'form-input';
    tag.id = 'homey-webhook-tag';
    tag.placeholder = t('extensions.homey.page.webhookTag');
    tag.setAttribute('aria-label', t('extensions.homey.page.webhookTag'));
    tag.autocomplete = 'off';
    const label = document.createElement('input');
    label.className = 'form-input';
    label.id = 'homey-webhook-label';
    label.placeholder = t('extensions.homey.page.webhookLabel');
    label.setAttribute('aria-label', t('extensions.homey.page.webhookLabel'));
    const addButton = button(t('extensions.homey.page.add'), 'btn btn--primary');
    addButton.id = 'homey-webhook-add';
    addButton.addEventListener('click', async () => {
      addButton.disabled = true;
      try {
        await addPin({
          kind: 'webhook',
          label: label.value.trim() || event.value.trim(),
          detail: tag.value.trim() ? `${event.value.trim()} · ${tag.value.trim()}` : event.value.trim(),
          event: event.value.trim(),
          tag: tag.value.trim(),
        });
        event.value = '';
        tag.value = '';
        label.value = '';
      } catch (err) {
        if (err?.csrfToken) csrf = err.csrfToken;
        fail(err);
      } finally {
        addButton.disabled = false;
      }
    }, { signal });
    const row = document.createElement('div');
    row.className = 'homey-webhook';
    row.append(event, tag, label, addButton);
    card.append(row);
    return card;
  }

  async function loadCatalog() {
    const catalog = await homeyApi('/catalog', { signal, csrf });
    if (gone) return;
    csrf = catalog.csrfToken || csrf;
    renderCatalog(catalog);
  }

  try {
    const status = await homeyApi('/status', { signal });
    if (gone) return;
    csrf = status.csrfToken || '';
    access = status.access || 'read';
    showBanner(status);
    const reload = async () => {
      const next = await homeyApi('/status', { signal, csrf });
      if (gone) return;
      csrf = next.csrfToken || csrf;
      access = next.access || access;
      showBanner({ ...next, access });
      mountConnectionForm(connection, { status: { ...next, csrfToken: csrf }, signal, headingLevel: 'h2', onSaved: reload });
      await refreshPins();
      if (access === 'write' && next.configured) await loadCatalog();
      else {
        add.replaceChildren();
        add.hidden = true;
      }
    };
    mountConnectionForm(connection, { status, signal, headingLevel: 'h2', onSaved: reload });
    await refreshPins();
    if (access === 'write' && status.configured) await loadCatalog();
    const timer = setInterval(() => {
      if (gone || document.hidden) return;
      refreshPins().catch(() => {});
    }, 20_000);
    signal?.addEventListener('abort', () => clearInterval(timer), { once: true });
  } catch (err) {
    fail(err);
  }
}
