import { t } from '/i18n.js';
import { esc } from '/utils/html.js';
import { mountEmptyState } from '/utils/empty-state.js';
import { renderPageBody, renderPageHeader, renderPageSection, renderPageTitle } from '/utils/page-layout.js';
import { showToast } from '/utils/toast-show.js';
import { choresApi, progressMark } from './browser.js';

function paintIcons(root) {
  if (window.lucide) window.lucide.createIcons({ el: root });
}

function shell() {
  return renderPageHeader({
    title: renderPageTitle(esc(t('extensions.kids-chores.page.title'))),
  }) + renderPageBody({
    content: renderPageSection({
      id: 'kc-main',
      content: '<div id="kc-notices"></div>'
        + '<div id="kc-progress" class="kc-progress"></div>'
        + '<div id="kc-empty"></div>'
        + '<ul id="kc-list" class="kc-list"></ul>'
        + '<p id="kc-congrats" class="kc-congrats" hidden></p>',
    }),
  });
}

export async function render(container, context) {
  const signal = context?.signal;
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', shell());
  paintIcons(container);

  const noticesEl = container.querySelector('#kc-notices');
  const progressEl = container.querySelector('#kc-progress');
  const emptyEl = container.querySelector('#kc-empty');
  const listEl = container.querySelector('#kc-list');
  const congratsEl = container.querySelector('#kc-congrats');
  let csrf = '';
  let gone = false;
  signal?.addEventListener('abort', () => { gone = true; }, { once: true });

  function renderProgress(data) {
    progressEl.replaceChildren();
    progressEl.insertAdjacentHTML('beforeend', progressMark({
      percent: data.percent,
      icon: data.progressIcon || 'sun',
      size: 88,
    }));
    const score = document.createElement('p');
    score.className = 'kc-progress__score';
    score.textContent = t('extensions.kids-chores.page.score', {
      earned: data.earned,
      goal: data.goal,
    });
    const label = document.createElement('p');
    label.className = 'kc-progress__label';
    label.textContent = data.goalReached
      ? t('extensions.kids-chores.page.goalReached')
      : t('extensions.kids-chores.page.progressHint');
    progressEl.append(score, label);
  }

  function renderNotices(data) {
    noticesEl.replaceChildren();
    if (data.role !== 'admin' || !data.notices?.length) return;
    const box = document.createElement('div');
    box.className = 'kc-notices';
    box.setAttribute('role', 'status');
    const title = document.createElement('strong');
    title.textContent = t('extensions.kids-chores.page.adminNotices');
    box.append(title);
    for (const notice of data.notices.slice(0, 3)) {
      const p = document.createElement('p');
      p.textContent = notice.message || '';
      box.append(p);
    }
    noticesEl.append(box);
  }

  function renderList(data) {
    listEl.replaceChildren();
    emptyEl.replaceChildren();
    congratsEl.hidden = true;

    const open = data.open || data.items?.filter((i) => !i.done) || [];
    if (!data.items?.length) {
      mountEmptyState(emptyEl, {
        icon: 'sparkles',
        title: t('extensions.kids-chores.page.emptyTitle'),
        body: t('extensions.kids-chores.page.emptyBody'),
      });
      paintIcons(emptyEl);
      return;
    }

    if (data.allDone) {
      congratsEl.hidden = false;
      congratsEl.textContent = data.congratsMessage
        || t('extensions.kids-chores.page.defaultCongrats');
    }

    for (const item of data.items) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `kc-chore${item.done ? ' kc-chore--done' : ''}`;
      btn.disabled = item.done || data.access !== 'write';
      const title = document.createElement('span');
      title.textContent = item.title;
      const pts = document.createElement('span');
      pts.className = 'kc-chore__points';
      pts.textContent = t('extensions.kids-chores.page.points', { count: item.points });
      btn.append(title, pts);
      if (!item.done && data.access === 'write') {
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
            paint(next);
            if (next.goalReached) {
              showToast({
                message: t('extensions.kids-chores.page.goalReached'),
                variant: 'success',
              });
            }
          } catch (err) {
            if (gone) return;
            if (err.csrfToken) csrf = err.csrfToken;
            btn.disabled = false;
            showToast({ message: err.message, variant: 'danger' });
          }
        }, { signal });
      }
      li.append(btn);
      listEl.append(li);
      if (item.done && open.length) {
        /* still show done faintly so kids see what they finished */
      }
    }
  }

  function paint(data) {
    renderNotices(data);
    renderProgress(data);
    renderList(data);
  }

  try {
    const data = await choresApi('/today', { signal, csrf });
    if (gone) return;
    csrf = data.csrfToken || csrf;
    paint(data);
  } catch (err) {
    if (gone) return;
    mountEmptyState(emptyEl, {
      icon: 'triangle-alert',
      title: t('extensions.kids-chores.page.loadError'),
      body: err.message || t('extensions.kids-chores.reason.invalid'),
    });
    paintIcons(emptyEl);
  }
}
