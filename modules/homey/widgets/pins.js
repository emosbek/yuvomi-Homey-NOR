import { t } from '/i18n.js';
import { ensureStyle } from '/utils/component-style.js';
import { mountEmptyState } from '/utils/empty-state.js';
import { showToast } from '/utils/toast-show.js';
import { homeyApi, pinIcon, valueLabel } from '../browser.js';

const STYLE = '/api/v1/modules/assets/homey/style.css';
const HOMEY_PATH = '/m/homey';
const ACCENT = '#0B6E99';

function paintIcons(root) {
  if (window.lucide) window.lucide.createIcons({ el: root });
}

function header(title, count) {
  const head = document.createElement('div');
  head.className = 'widget__header';
  const h3 = document.createElement('h3');
  h3.className = 'widget__title';
  const seal = document.createElement('span');
  seal.className = 'module-seal module-seal--sm';
  seal.style.setProperty('--seal-accent', ACCENT);
  seal.setAttribute('aria-hidden', 'true');
  const sealIcon = document.createElement('i');
  sealIcon.dataset.lucide = 'house';
  seal.append(sealIcon);
  const text = document.createElement('span');
  text.className = 'widget__title-text';
  text.textContent = title;
  h3.append(seal, text);
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'widget__badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = String(count);
    h3.append(badge);
  }
  head.append(h3);
  if (count > 0) {
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = t('dashboard.badgeCount', { count });
    head.append(sr);
  }
  const link = document.createElement('a');
  link.href = HOMEY_PATH;
  link.dataset.route = HOMEY_PATH;
  link.className = 'widget__link';
  link.setAttribute('aria-label', t('dashboard.allLinkFor', { module: title }));
  link.textContent = t('dashboard.allLink');
  head.append(link);
  return head;
}

function pinButton(pin, { access, onActivate }) {
  const press = document.createElement('button');
  press.type = 'button';
  press.className = `card card--interactive card--padded homey-pin homey-widget__pin${pin.value === true ? ' homey-pin--on' : ''}`;
  press.dataset.pinId = pin.id;
  if (pin.mode === 'toggle') press.setAttribute('aria-pressed', pin.value === true ? 'true' : 'false');
  press.disabled = access !== 'write' || pin.unavailable;

  const titleRow = document.createElement('span');
  titleRow.className = 'homey-pin__title';
  const iconName = pinIcon(pin);
  if (iconName) {
    const icon = document.createElement('i');
    icon.dataset.lucide = iconName;
    icon.setAttribute('aria-hidden', 'true');
    titleRow.append(icon);
  }
  const label = document.createElement('span');
  label.className = 'homey-pin__label';
  label.textContent = pin.label;
  titleRow.append(label);

  const detail = document.createElement('span');
  detail.className = 'homey-pin__detail';
  detail.textContent = pin.detail || '';
  const value = document.createElement('span');
  value.className = 'homey-pin__value';
  value.textContent = valueLabel(pin);
  press.append(titleRow, detail, value);
  press.addEventListener('click', () => onActivate(pin, press));
  return press;
}

/**
 * Overview tile for pinned Homey buttons.
 * Pins come from the Homey module page / household connection; this widget only shows and runs them.
 */
export async function renderWidget(container) {
  await ensureStyle(STYLE);
  container.replaceChildren();

  const root = document.createElement('div');
  root.className = 'widget widget--homey';
  root.style.setProperty('--widget-accent', ACCENT);
  container.append(root);

  const title = t('extensions.homey.widgets.pins');
  let csrf = '';
  let access = 'read';
  let gone = false;

  async function activate(pin, press) {
    press.disabled = true;
    try {
      const data = await homeyApi(`/pins/${encodeURIComponent(pin.id)}/activate`, {
        method: 'POST',
        csrf,
        body: {},
      });
      csrf = data.csrfToken || csrf;
      showToast(t('extensions.homey.page.sent'), 'success');
      await refresh();
    } catch (err) {
      if (err?.csrfToken) csrf = err.csrfToken;
      showToast(err?.message || t('extensions.homey.reason.invalid'), 'danger');
      if (press.isConnected) press.disabled = access !== 'write' || pin.unavailable;
    }
  }

  async function refresh() {
    if (gone) return;
    const [status, pinsPayload] = await Promise.all([
      homeyApi('/status', { csrf }),
      homeyApi('/pins', { csrf }),
    ]);
    if (gone) return;
    csrf = pinsPayload.csrfToken || status.csrfToken || csrf;
    access = status.access || 'read';
    const pins = Array.isArray(pinsPayload.pins) ? pinsPayload.pins : [];

    root.replaceChildren();
    root.append(header(title, pins.length));

    if (!status.configured) {
      const empty = document.createElement('div');
      empty.className = 'widget__empty';
      mountEmptyState(empty, {
        icon: 'house',
        title: t('extensions.homey.page.notConfigured'),
        description: t('extensions.homey.page.askAdmin'),
      });
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'widget__empty-cta';
      cta.dataset.route = HOMEY_PATH;
      const ctaIcon = document.createElement('i');
      ctaIcon.dataset.lucide = 'plug';
      ctaIcon.setAttribute('aria-hidden', 'true');
      const ctaLabel = document.createElement('span');
      ctaLabel.textContent = t('extensions.homey.page.openSettings');
      cta.append(ctaIcon, ctaLabel);
      empty.append(cta);
      root.append(empty);
      paintIcons(root);
      return;
    }

    if (!pins.length) {
      const empty = document.createElement('div');
      empty.className = 'widget__empty';
      mountEmptyState(empty, {
        icon: 'pin',
        title: t('extensions.homey.widgets.emptyTitle'),
        description: t('extensions.homey.widgets.emptyBody'),
      });
      const cta = document.createElement('button');
      cta.type = 'button';
      cta.className = 'widget__empty-cta';
      cta.dataset.route = HOMEY_PATH;
      const ctaIcon = document.createElement('i');
      ctaIcon.dataset.lucide = 'plus';
      ctaIcon.setAttribute('aria-hidden', 'true');
      const ctaLabel = document.createElement('span');
      ctaLabel.textContent = t('extensions.homey.widgets.emptyCta');
      cta.append(ctaIcon, ctaLabel);
      empty.append(cta);
      root.append(empty);
      paintIcons(root);
      return;
    }

    if (access === 'read') {
      const note = document.createElement('p');
      note.className = 'form-hint homey-widget__hint';
      note.textContent = t('extensions.homey.page.readOnly');
      root.append(note);
    }

    const grid = document.createElement('div');
    grid.className = 'homey-widget__grid';
    for (const pin of pins) {
      grid.append(pinButton(pin, { access, onActivate: activate }));
    }
    root.append(grid);
    paintIcons(root);
  }

  try {
    await refresh();
  } catch (err) {
    if (gone) return;
    root.replaceChildren();
    root.append(header(title, 0));
    const empty = document.createElement('div');
    empty.className = 'widget__empty';
    empty.setAttribute('role', 'alert');
    const icon = document.createElement('i');
    icon.dataset.lucide = 'cloud-off';
    icon.className = 'empty-state__icon';
    icon.setAttribute('aria-hidden', 'true');
    const msg = document.createElement('div');
    msg.textContent = err?.message || t('extensions.homey.reason.invalid');
    empty.append(icon, msg);
    root.append(empty);
    paintIcons(root);
  }

  return () => { gone = true; };
}
