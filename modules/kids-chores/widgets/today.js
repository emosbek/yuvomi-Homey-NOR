import { t } from '/i18n.js';
import { ensureStyle } from '/utils/component-style.js';
import { mountEmptyState } from '/utils/empty-state.js';
import { showToast } from '/utils/toast-show.js';
import { choresApi, progressMark } from '../browser.js';

const STYLE = '/api/v1/modules/assets/kids-chores/style.css';
const PATH = '/m/kids-chores';
const ACCENT = '#EA580C';

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
  sealIcon.dataset.lucide = 'sparkles';
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
  const link = document.createElement('a');
  link.href = PATH;
  link.dataset.route = PATH;
  link.className = 'widget__link';
  link.setAttribute('aria-label', t('dashboard.allLinkFor', { module: title }));
  link.textContent = t('dashboard.allLink');
  head.append(link);
  return head;
}

export async function renderWidget(container, { signal } = {}) {
  ensureStyle(STYLE);
  container.replaceChildren();
  const title = t('extensions.kids-chores.widgets.today');
  let csrf = '';
  let gone = false;
  signal?.addEventListener('abort', () => { gone = true; }, { once: true });

  async function load() {
    const data = await choresApi('/today', { signal, csrf });
    if (gone) return;
    csrf = data.csrfToken || csrf;

    const open = data.open || [];
    container.replaceChildren();
    container.append(header(title, open.length));

    const body = document.createElement('div');
    body.className = 'kc-widget';

    if (!data.items?.length) {
      const empty = document.createElement('div');
      mountEmptyState(empty, {
        icon: 'sparkles',
        title: t('extensions.kids-chores.page.emptyTitle'),
        body: t('extensions.kids-chores.widget.empty'),
      });
      body.append(empty);
      container.append(body);
      paintIcons(container);
      return;
    }

    const row = document.createElement('div');
    row.className = 'kc-widget__body';
    const mark = document.createElement('div');
    mark.insertAdjacentHTML('beforeend', progressMark({
      percent: data.percent,
      icon: data.progressIcon || 'sun',
      size: 64,
    }));
    row.append(mark);

    if (data.allDone) {
      const congrats = document.createElement('p');
      congrats.className = 'kc-widget__congrats';
      congrats.textContent = data.congratsMessage
        || t('extensions.kids-chores.page.defaultCongrats');
      row.append(congrats);
    } else {
      const list = document.createElement('ul');
      list.className = 'kc-widget__list';
      for (const item of open) {
        const li = document.createElement('li');
        li.className = 'kc-widget__item';
        if (data.access === 'write') {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = item.title;
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
              const next = await choresApi('/complete', {
                method: 'POST',
                body: { id: item.id },
                csrf,
                signal,
              });
              if (gone) return;
              csrf = next.csrfToken || csrf;
              await load();
              if (next.goalReached) {
                showToast({
                  message: t('extensions.kids-chores.page.goalReached'),
                  variant: 'success',
                });
              }
            } catch (err) {
              if (err.csrfToken) csrf = err.csrfToken;
              btn.disabled = false;
              showToast({ message: err.message, variant: 'danger' });
            }
          }, { signal });
          li.append(btn);
        } else {
          li.textContent = item.title;
        }
        list.append(li);
      }
      row.append(list);
    }

    const score = document.createElement('p');
    score.className = 'kc-progress__label';
    score.textContent = t('extensions.kids-chores.page.score', {
      earned: data.earned,
      goal: data.goal,
    });
    body.append(row, score);
    container.append(body);
    paintIcons(container);
  }

  try {
    await load();
  } catch (err) {
    if (gone) return;
    container.replaceChildren();
    container.append(header(title, 0));
    const empty = document.createElement('div');
    mountEmptyState(empty, {
      icon: 'triangle-alert',
      title: t('extensions.kids-chores.page.loadError'),
      body: err.message,
    });
    container.append(empty);
    paintIcons(container);
  }
}
