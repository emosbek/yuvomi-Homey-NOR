import { t } from '/i18n.js';
import { showToast } from '/utils/toast-show.js';
import { WEEKDAYS, choresApi } from './browser.js';

function field(labelText, control) {
  const label = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function daysPicker(selected) {
  const wrap = document.createElement('div');
  wrap.className = 'kc-days';
  const set = new Set(selected || [1, 2, 3, 4, 5]);
  for (const { day, key } of WEEKDAYS) {
    const lab = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(day);
    box.checked = set.has(day);
    lab.append(box, document.createTextNode(t(`extensions.kids-chores.${key}`)));
    wrap.append(lab);
  }
  return wrap;
}

function readDays(wrap) {
  return [...wrap.querySelectorAll('input:checked')].map((el) => Number(el.value));
}

export async function render(container, { section, signal }) {
  if (section !== 'household') {
    container.replaceChildren();
    return;
  }

  container.replaceChildren();
  const root = document.createElement('div');
  root.className = 'kc-admin-form';
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

  const settingsBox = document.createElement('div');
  settingsBox.className = 'kc-admin-form';
  const choresBox = document.createElement('div');
  root.append(settingsBox, choresBox);

  async function reload() {
    const data = await choresApi('/chores', { signal, csrf });
    if (gone) return;
    csrf = data.csrfToken || csrf;
    paintSettings(data.settings);
    paintChores(data.chores || []);
  }

  function paintSettings(settings) {
    settingsBox.replaceChildren();
    const goal = document.createElement('input');
    goal.type = 'number';
    goal.min = '1';
    goal.max = '100000';
    goal.value = String(settings.pointGoal ?? 10);

    const congrats = document.createElement('textarea');
    congrats.rows = 2;
    congrats.value = settings.congratsMessage || '';

    const webhook = document.createElement('input');
    webhook.type = 'url';
    webhook.placeholder = 'https://…';
    webhook.value = '';
    webhook.dataset.keep = settings.webhookSet ? '1' : '';

    const tz = document.createElement('input');
    tz.type = 'text';
    tz.value = settings.timezone || 'Europe/Oslo';

    const icon = document.createElement('select');
    for (const value of ['sun', 'star']) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = t(`extensions.kids-chores.settings.icon.${value}`);
      if ((settings.progressIcon || 'sun') === value) opt.selected = true;
      icon.append(opt);
    }

    const notify = document.createElement('input');
    notify.type = 'checkbox';
    notify.checked = settings.notifyAdmin !== false;

    settingsBox.append(
      field(t('extensions.kids-chores.settings.pointGoal'), goal),
      field(t('extensions.kids-chores.settings.congrats'), congrats),
      field(t('extensions.kids-chores.settings.webhook'), webhook),
      field(t('extensions.kids-chores.settings.timezone'), tz),
      field(t('extensions.kids-chores.settings.progressIcon'), icon),
    );

    const notifyLab = document.createElement('label');
    notifyLab.append(notify, document.createTextNode(` ${t('extensions.kids-chores.settings.notifyAdmin')}`));
    settingsBox.append(notifyLab);

    if (settings.webhookSet) {
      const note = document.createElement('p');
      note.className = 'form-hint';
      note.textContent = t('extensions.kids-chores.settings.webhookSet');
      settingsBox.append(note);
    }

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary';
    save.textContent = t('extensions.kids-chores.settings.save');
    save.addEventListener('click', async () => {
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
      }
    }, { signal });
    settingsBox.append(save);

    const test = document.createElement('button');
    test.type = 'button';
    test.className = 'btn';
    test.textContent = t('extensions.kids-chores.settings.testWebhook');
    test.disabled = !settings.webhookSet;
    test.addEventListener('click', async () => {
      try {
        const next = await choresApi('/test-webhook', { method: 'POST', body: {}, csrf, signal });
        if (gone) return;
        csrf = next.csrfToken || csrf;
        showToast({ message: t('extensions.kids-chores.settings.webhookOk'), variant: 'success' });
      } catch (err) {
        if (err.csrfToken) csrf = err.csrfToken;
        showToast({ message: err.message, variant: 'danger' });
      }
    }, { signal });
    settingsBox.append(test);
  }

  function paintChores(chores) {
    choresBox.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = t('extensions.kids-chores.settings.choresTitle');
    choresBox.append(heading);

    for (const chore of chores) {
      const row = document.createElement('div');
      row.className = 'kc-chore-row';
      const left = document.createElement('div');
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
        try {
          const next = await choresApi(`/chores/${chore.id}`, { method: 'DELETE', csrf, signal });
          if (gone) return;
          csrf = next.csrfToken || csrf;
          paintChores(next.chores || []);
        } catch (err) {
          if (err.csrfToken) csrf = err.csrfToken;
          showToast({ message: err.message, variant: 'danger' });
        }
      }, { signal });
      row.append(left, del);
      choresBox.append(row);
    }

    const form = document.createElement('div');
    form.className = 'kc-admin-form';
    const addTitle = document.createElement('h3');
    addTitle.textContent = t('extensions.kids-chores.settings.addChore');
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 80;
    const points = document.createElement('input');
    points.type = 'number';
    points.min = '0';
    points.max = '1000';
    points.value = '1';
    const days = daysPicker([1, 2, 3, 4, 5]);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn--primary';
    add.textContent = t('extensions.kids-chores.settings.add');
    add.addEventListener('click', async () => {
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
      }
    }, { signal });

    form.append(
      addTitle,
      field(t('extensions.kids-chores.settings.choreTitle'), name),
      field(t('extensions.kids-chores.settings.chorePoints'), points),
      field(t('extensions.kids-chores.settings.choreDays'), days),
      add,
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
