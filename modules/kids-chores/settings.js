import { t } from '/i18n.js';
import { ensureStyle } from '/utils/component-style.js';
import { showToast } from '/utils/toast-show.js';
import { makeSortable } from '/utils/sortable.js';
import { WEEKDAYS, choresApi, maxDailyPoints } from './browser.js';

const STYLE = '/api/v1/modules/assets/kids-chores/style.css';

let fieldSeq = 0;
function nextId(prefix) {
  fieldSeq += 1;
  return `kc-${prefix}-${fieldSeq}`;
}

function paintIcons(root) {
  if (window.lucide) window.lucide.createIcons({ el: root });
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

function iconButton({ action, icon, label, disabled = false }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'row-action';
  btn.dataset.action = action;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.disabled = disabled;
  const i = document.createElement('i');
  i.dataset.lucide = icon;
  i.setAttribute('aria-hidden', 'true');
  btn.append(i);
  return btn;
}

function dayMeta(chore) {
  return (chore.days || [])
    .map((d) => WEEKDAYS.find((w) => w.day === d))
    .filter(Boolean)
    .map((w) => t(`extensions.kids-chores.${w.key}`))
    .join(', ');
}

function choreWebhookField({
  value = '',
  labelKey = 'extensions.kids-chores.settings.choreWebhook',
  placeholderKey = 'extensions.kids-chores.settings.choreWebhookPlaceholder',
  hintKey = 'extensions.kids-chores.settings.choreWebhookHint',
} = {}) {
  const input = document.createElement('input');
  input.type = 'url';
  input.placeholder = t(placeholderKey);
  input.value = value || '';
  input.autocomplete = 'off';
  input.spellcheck = false;
  return formField(t(labelKey), input, { hint: t(hintKey) });
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
  let sortable = null;
  let editingId = null;
  signal?.addEventListener('abort', () => {
    gone = true;
    sortable?.destroy?.();
    sortable = null;
  }, { once: true });

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

  let latestChores = [];
  let goalMaxHint = null;

  function updateGoalMaxHint() {
    if (!goalMaxHint) return;
    const max = maxDailyPoints(latestChores);
    goalMaxHint.textContent = max > 0
      ? t('extensions.kids-chores.settings.pointGoalMax', { max })
      : t('extensions.kids-chores.settings.pointGoalMaxNone');
  }

  async function reload() {
    const data = await choresApi('/chores', { signal, csrf });
    if (gone) return;
    csrf = data.csrfToken || csrf;
    paintSettings(data.settings);
    paintChores(data.chores || []);
  }

  function paintSettings(settings) {
    settingsForm.replaceChildren();

    const displayTitle = document.createElement('input');
    displayTitle.type = 'text';
    displayTitle.maxLength = 60;
    displayTitle.value = settings.displayTitle || '';
    displayTitle.autocomplete = 'off';
    displayTitle.placeholder = t('extensions.kids-chores.widgets.today');

    const goal = document.createElement('input');
    goal.type = 'number';
    goal.min = '1';
    goal.max = '100000';
    goal.value = String(settings.pointGoal ?? 10);
    goal.inputMode = 'numeric';

    goalMaxHint = document.createElement('p');
    goalMaxHint.className = 'form-hint';
    updateGoalMaxHint();

    const goalField = formField(t('extensions.kids-chores.settings.pointGoal'), goal);
    goalField.append(goalMaxHint);

    const congrats = document.createElement('textarea');
    congrats.rows = 3;
    congrats.value = settings.congratsMessage || '';

    const webhook = document.createElement('input');
    webhook.type = 'url';
    webhook.placeholder = 'https://…';
    webhook.value = settings.webhookUrl || '';
    webhook.autocomplete = 'off';
    webhook.spellcheck = false;

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
      formField(
        t('extensions.kids-chores.settings.displayTitle'),
        displayTitle,
        { hint: t('extensions.kids-chores.settings.displayTitleHint') },
      ),
      goalField,
      formField(t('extensions.kids-chores.settings.congrats'), congrats),
      formField(
        t('extensions.kids-chores.settings.webhook'),
        webhook,
        { hint: t('extensions.kids-chores.settings.webhookHint') },
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

    const wallSwitch = document.createElement('label');
    wallSwitch.className = 'toggle-row toggle-row--switch kc-wall-switch';
    const wallLabel = document.createElement('span');
    wallLabel.className = 'toggle-row__label';
    wallLabel.textContent = t('extensions.kids-chores.settings.showOnWall');
    const wallToggle = document.createElement('span');
    wallToggle.className = 'toggle';
    const wallInput = document.createElement('input');
    wallInput.type = 'checkbox';
    wallInput.setAttribute('role', 'switch');
    wallInput.checked = settings.showOnWall === true;
    const wallTrack = document.createElement('span');
    wallTrack.className = 'toggle__track';
    wallTrack.setAttribute('aria-hidden', 'true');
    wallToggle.append(wallInput, wallTrack);
    wallSwitch.append(wallLabel, wallToggle);
    const wallHint = document.createElement('p');
    wallHint.className = 'form-hint';
    wallHint.textContent = t('extensions.kids-chores.settings.showOnWallHint');
    const wallField = document.createElement('div');
    wallField.className = 'form-switch kc-wall-switch-wrap';
    wallField.append(wallSwitch, wallHint);
    settingsForm.append(wallField);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn--primary';
    save.textContent = t('extensions.kids-chores.settings.save');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const body = {
          displayTitle: displayTitle.value,
          pointGoal: Number(goal.value),
          congratsMessage: congrats.value,
          timezone: tz.value,
          progressIcon: icon.value,
          notifyAdmin: notify.checked,
          showOnWall: wallInput.checked,
          webhookUrl: webhook.value.trim(),
        };
        const next = await choresApi('/settings', { method: 'PUT', body, csrf, signal });
        if (gone) return;
        csrf = next.csrfToken || csrf;
        showToast(t('extensions.kids-chores.settings.saved'), 'success');
        paintSettings(next.settings);
        if (next.chores) paintChores(next.chores);
        else updateGoalMaxHint();
      } catch (err) {
        if (err.csrfToken) csrf = err.csrfToken;
        showToast(err.message || t('extensions.kids-chores.reason.invalid'), 'danger');
        save.disabled = false;
      }
    }, { signal });

    async function sendTestWebhook(state, button) {
      button.disabled = true;
      try {
        const next = await choresApi('/test-webhook', {
          method: 'POST',
          body: { state },
          csrf,
          signal,
        });
        if (gone) return;
        csrf = next.csrfToken || csrf;
        showToast(t('extensions.kids-chores.settings.webhookOk'), 'success');
      } catch (err) {
        if (err.csrfToken) csrf = err.csrfToken;
        showToast(err.message || t('extensions.kids-chores.reason.invalid'), 'danger');
      } finally {
        if (!gone) button.disabled = !settings.webhookSet;
      }
    }

    const testYes = document.createElement('button');
    testYes.type = 'button';
    testYes.className = 'btn';
    testYes.textContent = t('extensions.kids-chores.settings.testWebhookYes');
    testYes.title = t('extensions.kids-chores.settings.testWebhookYesTitle');
    testYes.setAttribute('aria-label', t('extensions.kids-chores.settings.testWebhookYesTitle'));
    testYes.disabled = !settings.webhookSet;
    testYes.addEventListener('click', () => sendTestWebhook('yes', testYes), { signal });

    const testNo = document.createElement('button');
    testNo.type = 'button';
    testNo.className = 'btn';
    testNo.textContent = t('extensions.kids-chores.settings.testWebhookNo');
    testNo.title = t('extensions.kids-chores.settings.testWebhookNoTitle');
    testNo.setAttribute('aria-label', t('extensions.kids-chores.settings.testWebhookNoTitle'));
    testNo.disabled = !settings.webhookSet;
    testNo.addEventListener('click', () => sendTestWebhook('no', testNo), { signal });

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn';
    reset.textContent = t('extensions.kids-chores.settings.resetToday');
    reset.title = t('extensions.kids-chores.settings.resetTodayHint');
    reset.addEventListener('click', async () => {
      if (!window.confirm(t('extensions.kids-chores.settings.resetTodayConfirm'))) return;
      reset.disabled = true;
      try {
        const next = await choresApi('/reset-today', { method: 'POST', body: {}, csrf, signal });
        if (gone) return;
        csrf = next.csrfToken || csrf;
        showToast(t('extensions.kids-chores.settings.resetTodayDone'), 'success');
        if (next.settings) paintSettings(next.settings);
        if (next.chores) paintChores(next.chores);
        else updateGoalMaxHint();
      } catch (err) {
        if (err.csrfToken) csrf = err.csrfToken;
        showToast(err.message || t('extensions.kids-chores.reason.invalid'), 'danger');
      } finally {
        if (!gone) reset.disabled = false;
      }
    }, { signal });

    settingsForm.append(actionsRow(save, testYes, testNo, reset));
  }

  async function persistOrder(listEl) {
    const ids = [...listEl.querySelectorAll('[data-chore-id]')].map((el) => el.dataset.choreId);
    try {
      const next = await choresApi('/chores/reorder', {
        method: 'PUT',
        body: { ids },
        csrf,
        signal,
      });
      if (gone) return;
      csrf = next.csrfToken || csrf;
      paintChores(next.chores || []);
    } catch (err) {
      if (err.csrfToken) csrf = err.csrfToken;
      showToast(err.message || t('extensions.kids-chores.reason.invalid'), 'danger');
      await reload();
    }
  }

  function moveChore(chores, id, delta) {
    const index = chores.findIndex((c) => c.id === id);
    if (index < 0) return chores;
    const next = index + delta;
    if (next < 0 || next >= chores.length) return chores;
    const copy = chores.slice();
    const [row] = copy.splice(index, 1);
    copy.splice(next, 0, row);
    return copy;
  }

  function paintChores(chores) {
    latestChores = Array.isArray(chores) ? chores : [];
    updateGoalMaxHint();
    sortable?.destroy?.();
    sortable = null;
    choresBox.replaceChildren();

    const heading = document.createElement('h3');
    heading.textContent = t('extensions.kids-chores.settings.choresTitle');
    choresBox.append(heading);

    if (!chores.length) {
      const empty = document.createElement('p');
      empty.className = 'form-hint';
      empty.textContent = t('extensions.kids-chores.settings.noChoresYet');
      choresBox.append(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'kc-chore-list';
      chores.forEach((chore, index) => {
        const row = document.createElement('div');
        row.className = 'kc-chore-row';
        row.dataset.choreId = chore.id;

        const order = document.createElement('div');
        order.className = 'kc-chore-row__order';
        const up = iconButton({
          action: 'up',
          icon: 'chevron-up',
          label: t('extensions.kids-chores.settings.moveUp', { name: chore.title }),
          disabled: index === 0,
        });
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'kc-chore-row__handle';
        handle.setAttribute('aria-label', t('extensions.kids-chores.settings.reorderHandle', { name: chore.title }));
        handle.title = t('extensions.kids-chores.settings.reorderHint');
        const grip = document.createElement('i');
        grip.dataset.lucide = 'grip-horizontal';
        grip.setAttribute('aria-hidden', 'true');
        handle.append(grip);
        const down = iconButton({
          action: 'down',
          icon: 'chevron-down',
          label: t('extensions.kids-chores.settings.moveDown', { name: chore.title }),
          disabled: index === chores.length - 1,
        });
        order.append(up, handle, down);

        const left = document.createElement('div');
        left.className = 'kc-chore-row__text';
        const name = document.createElement('strong');
        name.textContent = chore.title;
        const meta = document.createElement('div');
        meta.className = 'kc-chore-row__meta';
        const bits = [
          t('extensions.kids-chores.page.points', { count: chore.points }),
          dayMeta(chore),
        ];
        if (chore.webhookUrl || chore.resetWebhookUrl) {
          bits.push(t('extensions.kids-chores.settings.choreHasWebhook'));
        }
        meta.textContent = bits.filter(Boolean).join(' · ');
        left.append(name, meta);

        const actions = document.createElement('div');
        actions.className = 'kc-chore-row__actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'btn';
        edit.textContent = t('extensions.kids-chores.settings.edit');
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn--danger';
        del.textContent = t('extensions.kids-chores.settings.delete');

        up.addEventListener('click', async () => {
          const ordered = moveChore(chores, chore.id, -1);
          if (ordered === chores) return;
          const listEl = document.createElement('div');
          for (const c of ordered) {
            const fake = document.createElement('div');
            fake.dataset.choreId = c.id;
            listEl.append(fake);
          }
          await persistOrder(listEl);
        }, { signal });
        down.addEventListener('click', async () => {
          const ordered = moveChore(chores, chore.id, 1);
          if (ordered === chores) return;
          const listEl = document.createElement('div');
          for (const c of ordered) {
            const fake = document.createElement('div');
            fake.dataset.choreId = c.id;
            listEl.append(fake);
          }
          await persistOrder(listEl);
        }, { signal });

        edit.addEventListener('click', () => {
          editingId = editingId === chore.id ? null : chore.id;
          paintChores(chores);
        }, { signal });

        del.addEventListener('click', async () => {
          del.disabled = true;
          try {
            const next = await choresApi(`/chores/${chore.id}`, { method: 'DELETE', csrf, signal });
            if (gone) return;
            csrf = next.csrfToken || csrf;
            if (editingId === chore.id) editingId = null;
            paintChores(next.chores || []);
          } catch (err) {
            if (err.csrfToken) csrf = err.csrfToken;
            showToast(err.message || t('extensions.kids-chores.reason.invalid'), 'danger');
            del.disabled = false;
          }
        }, { signal });

        actions.append(edit, del);
        row.append(order, left, actions);

        if (editingId === chore.id) {
          const editor = document.createElement('div');
          editor.className = 'kc-chore-row__editor';
          const titleInput = document.createElement('input');
          titleInput.type = 'text';
          titleInput.maxLength = 80;
          titleInput.value = chore.title;
          const pointsInput = document.createElement('input');
          pointsInput.type = 'number';
          pointsInput.min = '0';
          pointsInput.max = '1000';
          pointsInput.value = String(chore.points);
          const webhookField = choreWebhookField({ value: chore.webhookUrl || '' });
          const webhookInput = webhookField.querySelector('input');
          const resetWebhookField = choreWebhookField({
            value: chore.resetWebhookUrl || '',
            labelKey: 'extensions.kids-chores.settings.choreResetWebhook',
            placeholderKey: 'extensions.kids-chores.settings.choreResetWebhookPlaceholder',
            hintKey: 'extensions.kids-chores.settings.choreResetWebhookHint',
          });
          const resetWebhookInput = resetWebhookField.querySelector('input');
          const days = daysPicker(chore.days);
          const saveEdit = document.createElement('button');
          saveEdit.type = 'button';
          saveEdit.className = 'btn btn--primary';
          saveEdit.textContent = t('extensions.kids-chores.settings.saveChore');
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'btn';
          cancel.textContent = t('extensions.kids-chores.settings.cancel');
          cancel.addEventListener('click', () => {
            editingId = null;
            paintChores(chores);
          }, { signal });
          saveEdit.addEventListener('click', async () => {
            saveEdit.disabled = true;
            try {
              const next = await choresApi(`/chores/${chore.id}`, {
                method: 'PUT',
                body: {
                  title: titleInput.value,
                  points: Number(pointsInput.value),
                  days: readDays(days),
                  webhookUrl: webhookInput.value.trim(),
                  resetWebhookUrl: resetWebhookInput.value.trim(),
                },
                csrf,
                signal,
              });
              if (gone) return;
              csrf = next.csrfToken || csrf;
              editingId = null;
              showToast(t('extensions.kids-chores.settings.savedChore'), 'success');
              paintChores(next.chores || []);
            } catch (err) {
              if (err.csrfToken) csrf = err.csrfToken;
              showToast(err.message || t('extensions.kids-chores.reason.invalid'), 'danger');
              saveEdit.disabled = false;
            }
          }, { signal });
          editor.append(
            formField(t('extensions.kids-chores.settings.choreTitle'), titleInput),
            formField(t('extensions.kids-chores.settings.chorePoints'), pointsInput),
            webhookField,
            resetWebhookField,
            (() => {
              const field = document.createElement('div');
              field.className = 'form-field';
              const lab = document.createElement('span');
              lab.className = 'form-label';
              lab.textContent = t('extensions.kids-chores.settings.choreDays');
              field.append(lab, days);
              return field;
            })(),
            actionsRow(saveEdit, cancel),
          );
          row.append(editor);
        }

        list.append(row);
      });
      choresBox.append(list);
      paintIcons(list);

      if (chores.length > 1) {
        makeSortable(list, {
          handle: '.kc-chore-row__handle',
          draggable: '.kc-chore-row',
          onEnd: async () => {
            await persistOrder(list);
          },
        }).then((instance) => {
          if (gone || !list.isConnected) {
            instance?.destroy?.();
            return;
          }
          sortable = instance;
        }).catch(() => {});
      }
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

    const webhookField = choreWebhookField({});
    const webhookInput = webhookField.querySelector('input');
    const resetWebhookField = choreWebhookField({
      labelKey: 'extensions.kids-chores.settings.choreResetWebhook',
      placeholderKey: 'extensions.kids-chores.settings.choreResetWebhookPlaceholder',
      hintKey: 'extensions.kids-chores.settings.choreResetWebhookHint',
    });
    const resetWebhookInput = resetWebhookField.querySelector('input');

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
            webhookUrl: webhookInput.value.trim(),
            resetWebhookUrl: resetWebhookInput.value.trim(),
          },
          csrf,
          signal,
        });
        if (gone) return;
        csrf = next.csrfToken || csrf;
        name.value = '';
        webhookInput.value = '';
        resetWebhookInput.value = '';
        paintChores(next.chores || []);
        showToast(t('extensions.kids-chores.settings.added'), 'success');
      } catch (err) {
        if (err.csrfToken) csrf = err.csrfToken;
        showToast(err.message || t('extensions.kids-chores.reason.invalid'), 'danger');
        add.disabled = false;
      }
    }, { signal });

    form.append(
      addTitle,
      formField(t('extensions.kids-chores.settings.choreTitle'), name),
      formField(t('extensions.kids-chores.settings.chorePoints'), points),
      webhookField,
      resetWebhookField,
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
