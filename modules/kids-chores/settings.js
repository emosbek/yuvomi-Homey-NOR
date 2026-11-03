import { t } from '/i18n.js';
import { ensureStyle } from '/utils/component-style.js';
import { showToast } from '/utils/toast-show.js';
import { WEEKDAYS, choresApi } from './browser.js';

const STYLE = '/api/v1/modules/assets/kids-chores/style.css';

let fieldSeq = 0;
function nextId(prefix) {
  fieldSeq += 1;
  return `kc-${prefix}-${fieldSeq}`;
}

function formField(labelText, control, { hint } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'form-field';
  const id = control.id || nextId('field');
  control.id = id;
  if (!control.className) control.className = 'form-input';
  else if (!/\bform-input\b/.test(control.className)) control.className += ' form-input';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.htmlFor = id;
  label.textContent = labelText;
  wrap.append(label, control);
  if (hint) {
    const p = document.createElement('p');
    p.className = 'form-hint';
    p.textContent = hint;
    wrap.append(p);
  }
  return wrap;
}

function daysPicker(selected) {
  const wrap = document.createElement('div');
  wrap.className = 'kc-days';
  wrap.setAttribute('role', 'group');
  const set = new Set(selected || [1, 2, 3, 4, 5]);
  for (const { day, key } of WEEKDAYS) {
    const lab = document.createElement('label');
    lab.className = 'kc-days__day';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(day);
    box.checked = set.has(day);
    const text = document.createElement('span');
    text.textContent = t(`extensions.kids-chores.${key}`);
    lab.append(box, text);
    wrap.append(lab);
  }
  return wrap;
}

function readDays(wrap) {
  return [...wrap.querySelectorAll('input:checked')].map((el) => Number(el.value));
}

function actionsRow(...buttons) {
  const row = document.createElement('div');
  row.className = 'settings-form-actions kc-settings-actions';
  for (const btn of buttons) row.append(btn);
  return row;
}

export async function render(container, { section, signal }) {
  if (section !== 'household') {
    container.replaceChildren();
    return;
  }

  ensureStyle(STYLE);
  container.replaceChildren();

  const root = document.createElement('div');
  root.className = 'kc-settings';
  container.append(root);

  let csrf = '';
  let gone = false;
  signal?.addEventListener('abort', () => { gone = true; }, { once: true });

  const title = document.createElement('h3');
  title.textContent = t('extensions.kids-chores.settings.householdTitle');
  root.append(title);

  const hint = document.createElement('p');
  hint.className = 'form-hint';
  hint.textContent = t('extensions.kids-chores.settings.householdHint');
  root.append(hint);

  const settingsForm = document.createElement('div');
  settingsForm.className = 'settings-form settings-form--compact kc-settings-form';
  const choresBox = document.createElement('div');
  choresBox.className = 'kc-settings-chores';
  root.append(settingsForm, choresBox);

  async function reload() {
    const data = await choresApi('/chores', { signal, csrf });
    if (gone) return;
    csrf = data.csrfToken || csrf;
    paintSettings(data.settings);
    paintChores(data.chores || []);
  }

  function paintSettings(settings) {
    settingsForm.replaceChildren();

    const goal = document.createElement('input');
    goal.type = 'number';
    goal.min = '1';
    goal.max = '100000';
    goal.value = String(settings.pointGoal ?? 10);
    goal.inputMode = 'numeric';

    const congrats = document.createElement('textarea');
    congrats.rows = 3;
    congrats.value = settings.congratsMessage || '';

    const webhook = document.createElement('input');
    webhook.type = 'url';
    webhook.placeholder = 'https://…';
    webhook.value = '';
    webhook.autocomplete = 'off';
    webhook.dataset.keep = settings.webhookSet ? '1' : '';

    const tz = document.createElement('input');
    tz.type = 'text';
    tz.value = settings.timezone || 'Europe/Oslo';
    tz.autocomplete = 'off';

    const icon = document.createElement('select');
    for (const value of ['sun', 'star']) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = t(`extensions.kids-chores.settings.icon.${value}`);
      if ((settings.progressIcon || 'sun') === value) opt.selected = true;
      icon.append(opt);
    }

    settingsForm.append(
      formField(t('extensions.kids-chores.settings.pointGoal'), goal),
      formField(t('extensions.kids-chores.settings.congrats'), congrats),
      formField(
        t('extensions.kids-chores.settings.webhook'),
        webhook,
        settings.webhookSet
          ? { hint: t('extensions.kids-chores.settings.webhookSet') }
          : undefined,
      ),
      formField(t('extensions.kids-chores.settings.timezone'), tz),
      formField(t('extensions.kids-chores.settings.progressIcon'), icon),
    );

    const notifyWrap = document.createElement('label');
    notifyWrap.className = 'kc-check-row';
    const notify = document.createElement('input');
    notify.type = 'checkbox';
    notify.checked = settings.notifyAdmin !== false;
    const notifyText = document.createElement('span');
    notifyText.textContent = t('extensions.kids-chores.settings.notifyAdmin');
    notifyWrap.append(notify, notifyText);
    settingsForm.append(notifyWrap);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary';
    save.textContent = t('extensions.kids-chores.settings.save');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const body = {
          pointGoal: Number(goal.value),
          congratsMessage: congrats.value,
          timezone: tz.value,
          progressIcon: icon.value,
          notifyAdmin: notify.checked,
        };
        const url = webhook.value.trim();
        if (url) body.webhookUrl = url;
        else if (!webhook.dataset.keep) body.webhookUrl = '';
        const next = await choresApi('/settings', { method: 'PUT', body, csrf, signal });
        if (gone) return;
        csrf = next.csrfToken || csrf;
        showToast({ message: t('extensions.kids-chores.settings.saved'), variant: 'success' });
        paintSettings(next.settings);
      } catch (err) {
        if (err.csrfToken) csrf = err.csrfToken;
        showToast({ message: err.message, variant: 'danger' });
        save.disabled = false;
      }
    }, { signal });

    const test = document.createElement('button');
    test.type = 'button';
    test.className = 'btn';
    test.textContent = t('extensions.kids-chores.settings.testWebhook');
    test.disabled = !settings.webhookSet;
    test.addEventListener('click', async () => {
      test.disabled = true;
      try {
        const next = await choresApi('/test-webhook', { method: 'POST', body: {}, csrf, signal });
        if (gone) return;
        csrf = next.csrfToken || csrf;
        showToast({ message: t('extensions.kids-chores.settings.webhookOk'), variant: 'success' });
      } catch (err) {
        if (err.csrfToken) csrf = err.csrfToken;
        showToast({ message: err.message, variant: 'danger' });
      } finally {
        if (!gone) test.disabled = !settings.webhookSet;
      }
    }, { signal });

    settingsForm.append(actionsRow(save, test));
  }

  function paintChores(chores) {
    choresBox.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = t('extensions.kids-chores.settings.choresTitle');
    choresBox.append(heading);

    if (!chores.length) {
      const empty = document.createElement('p');
      empty.className = 'form-hint';
      empty.textContent = t('extensions.kids-chores.settings.noChoresYet');
      choresBox.append(empty);
    }

    for (const chore of chores) {
      const row = document.createElement('div');
      row.className = 'kc-chore-row';
      const left = document.createElement('div');
      left.className = 'kc-chore-row__text';
      const name = document.createElement('strong');
      name.textContent = chore.title;
      const meta = document.createElement('div');
      meta.className = 'kc-chore-row__meta';
      const dayLabels = (chore.days || [])
        .map((d) => WEEKDAYS.find((w) => w.day === d))
        .filter(Boolean)
        .map((w) => t(`extensions.kids-chores.${w.key}`))
        .join(', ');
      meta.textContent = `${t('extensions.kids-chores.page.points', { count: chore.points })} · ${dayLabels}`;
      left.append(name, meta);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--danger';
      del.textContent = t('extensions.kids-chores.settings.delete');
      del.addEventListener('click', async () => {
        del.disabled = true;
        try {
          const next = await choresApi(`/chores/${chore.id}`, { method: 'DELETE', csrf, signal });
          if (gone) return;
          csrf = next.csrfToken || csrf;
          paintChores(next.chores || []);
        } catch (err) {
          if (err.csrfToken) csrf = err.csrfToken;
          showToast({ message: err.message, variant: 'danger' });
          del.disabled = false;
        }
      }, { signal });
      row.append(left, del);
      choresBox.append(row);
    }

    const form = document.createElement('div');
    form.className = 'settings-form settings-form--compact kc-settings-form';
    const addTitle = document.createElement('h3');
    addTitle.textContent = t('extensions.kids-chores.settings.addChore');

    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 80;
    name.autocomplete = 'off';

    const points = document.createElement('input');
    points.type = 'number';
    points.min = '0';
    points.max = '1000';
    points.value = '1';
    points.inputMode = 'numeric';

    const days = daysPicker([1, 2, 3, 4, 5]);
    const daysField = document.createElement('div');
    daysField.className = 'form-field';
    const daysLabel = document.createElement('span');
    daysLabel.className = 'form-label';
    daysLabel.textContent = t('extensions.kids-chores.settings.choreDays');
    daysField.append(daysLabel, days);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn--primary';
    add.textContent = t('extensions.kids-chores.settings.add');
    add.addEventListener('click', async () => {
      add.disabled = true;
      try {
        const next = await choresApi('/chores', {
          method: 'POST',
          body: {
            title: name.value,
            points: Number(points.value),
            days: readDays(days),
          },
          csrf,
          signal,
        });
        if (gone) return;
        csrf = next.csrfToken || csrf;
        name.value = '';
        paintChores(next.chores || []);
        showToast({ message: t('extensions.kids-chores.settings.added'), variant: 'success' });
      } catch (err) {
        if (err.csrfToken) csrf = err.csrfToken;
        showToast({ message: err.message, variant: 'danger' });
        add.disabled = false;
      }
    }, { signal });

    form.append(
      addTitle,
      formField(t('extensions.kids-chores.settings.choreTitle'), name),
      formField(t('extensions.kids-chores.settings.chorePoints'), points),
      daysField,
      actionsRow(add),
    );
    choresBox.append(form);
  }

  try {
    await reload();
  } catch (err) {
    if (gone) return;
    const p = document.createElement('p');
    p.className = 'form-hint form-hint--danger';
    p.textContent = err.message || t('extensions.kids-chores.reason.invalid');
    root.append(p);
  }
}
