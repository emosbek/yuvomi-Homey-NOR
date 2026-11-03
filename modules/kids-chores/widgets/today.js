import { t } from '/i18n.js';
import { ensureStyle } from '/utils/component-style.js';
import { mountEmptyState } from '/utils/empty-state.js';
import { showToast } from '/utils/toast-show.js';
import { choresApi, moduleDisplayTitle, progressMark } from '../browser.js';

const STYLE = '/api/v1/modules/assets/kids-chores/style.css';
const PATH = '/m/kids-chores';
const ACCENT = '#EA580C';
/** Match `.module-seal--sm` / `--target-sm` used by other overview widgets. */
const MARK_SIZE = 28;

function applyAccent(root) {
  root.style.setProperty('--seal-accent', ACCENT);
  root.style.setProperty('--widget-accent', ACCENT);
  root.style.setProperty('--active-module-accent', ACCENT);
}

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
  const fallbackTitle = t('extensions.kids-chores.widgets.today');
  let csrf = '';
  let gone = false;
  signal?.addEventListener('abort', () => { gone = true; }, { once: true });

  async function load() {
    const data = await choresApi('/today', { signal, csrf });
    if (gone) return;
    csrf = data.csrfToken || csrf;

    const title = moduleDisplayTitle(data.settings, 'extensions.kids-chores.widgets.today');
    const open = data.open || [];
    container.replaceChildren();
    applyAccent(container);
    container.append(header(title, open.length));

    const body = document.createElement('div');
    body.className = 'widget__body kc-widget';

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

    const progress = document.createElement('div');
    progress.className = 'kc-widget__progress';
    const mark = document.createElement('div');
    mark.className = 'kc-widget__mark';
    mark.insertAdjacentHTML('beforeend', progressMark({
      percent: data.percent,
      icon: data.progressIcon || 'sun',
      size: MARK_SIZE,
    }));
    const score = document.createElement('p');
    score.className = 'kc-widget__score';
    score.textContent = t('extensions.kids-chores.page.score', {
      earned: data.earned,
      goal: data.goal,
    });
    progress.append(mark, score);
    body.append(progress);

    if (data.allDone) {
      const congrats = document.createElement('p');
      congrats.className = 'kc-widget__congrats';
      congrats.textContent = data.congratsMessage
        || t('extensions.kids-chores.page.defaultCongrats');
      body.append(congrats);
    } else {
      const list = document.createElement('div');
      list.className = 'kc-widget__list';
      for (const item of open) {
        if (data.access === 'write') {
          const btn = document.createElement('button');
          btn.type = 'button';
          /* Inset well inside the overview card — not a nested .card (Kasten-in-Kasten). */
          btn.className = 'kc-widget__chore';
          const label = document.createElement('span');
          label.className = 'kc-widget__chore-title';
          label.textContent = item.title;
          const pts = document.createElement('span');
          pts.className = 'kc-widget__chore-points';
          pts.textContent = t('extensions.kids-chores.page.points', { count: item.points });
          btn.append(label, pts);
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
                showToast(t('extensions.kids-chores.page.goalReached'), 'success');
              }
            } catch (err) {
              if (err.csrfToken) csrf = err.csrfToken;
              btn.disabled = false;
              showToast(err.message || t('extensions.kids-chores.reason.invalid'), 'danger');
            }
          }, { signal });
          list.append(btn);
        } else {
          const row = document.createElement('div');
          row.className = 'kc-widget__chore kc-widget__chore--static';
          row.textContent = item.title;
          list.append(row);
        }
      }
      body.append(list);
    }

    container.append(body);
    paintIcons(container);
  }

  try {
    await load();
  } catch (err) {
    if (gone) return;
    container.replaceChildren();
    container.append(header(fallbackTitle, 0));
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
