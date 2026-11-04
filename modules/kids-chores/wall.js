/**
 * Kids Chores panel for dashboard wall / full-screen mode.
 * Mounted by the overview when the module is enabled; stays empty unless
 * the admin turned on showOnWall and today has scheduled chores.
 */

import { t } from '/i18n.js';
import { ensureStyle } from '/utils/component-style.js';
import { showToast } from '/utils/toast-show.js';
import { choresApi, moduleDisplayTitle, progressMark, shouldShowOnWall } from './browser.js';

const STYLE = '/api/v1/modules/assets/kids-chores/style.css';
const ACCENT = '#EA580C';
const MARK_SIZE = 36;

function paintIcons(root) {
  if (window.lucide) window.lucide.createIcons({ el: root });
}

/**
 * @param {HTMLElement} host
 * @param {{ signal?: AbortSignal }} [ctx]
 */
export async function renderWallPanel(host, { signal } = {}) {
  if (!host) return;
  ensureStyle(STYLE);
  host.replaceChildren();
  host.hidden = true;

  let gone = false;
  let csrf = '';
  signal?.addEventListener('abort', () => { gone = true; }, { once: true });

  async function load() {
    let data;
    try {
      data = await choresApi('/today', { signal, csrf });
    } catch {
      if (!gone) {
        host.replaceChildren();
        host.hidden = true;
      }
      return;
    }
    if (gone) return;
    csrf = data.csrfToken || csrf;
    if (!shouldShowOnWall(data)) {
      host.replaceChildren();
      host.hidden = true;
      return;
    }

    const title = moduleDisplayTitle(data.settings, 'extensions.kids-chores.widgets.today');
    const open = data.open || data.items?.filter((i) => !i.done) || [];

    const section = document.createElement('section');
    section.className = 'wall__kids-chores kc-wall';
    section.setAttribute('aria-labelledby', 'wall-kc-title');
    section.style.setProperty('--seal-accent', ACCENT);
    section.style.setProperty('--widget-accent', ACCENT);

    const heading = document.createElement('h2');
    heading.className = 'wall__section-title';
    heading.id = 'wall-kc-title';
    heading.textContent = title;

    const progress = document.createElement('div');
    progress.className = 'kc-wall__progress';
    const mark = document.createElement('div');
    mark.className = 'kc-wall__mark';
    mark.insertAdjacentHTML('beforeend', progressMark({
      percent: data.percent,
      icon: data.progressIcon || data.settings?.progressIcon || 'sun',
      size: MARK_SIZE,
    }));
    const score = document.createElement('p');
    score.className = 'kc-wall__score';
    score.textContent = t('extensions.kids-chores.wall.score', {
      earned: data.earned,
      goal: data.goal,
    });
    progress.append(mark, score);

    section.append(heading, progress);

    if (data.allDone) {
      const done = document.createElement('p');
      done.className = 'kc-wall__done';
      done.textContent = data.congratsMessage
        || t('extensions.kids-chores.wall.allDone');
      section.append(done);
    } else {
      const list = document.createElement('ul');
      list.className = 'kc-wall__list';
      list.setAttribute('aria-label', t('extensions.kids-chores.wall.openCount', {
        count: open.length,
      }));
      for (const item of open) {
        const li = document.createElement('li');
        li.className = 'kc-wall__chore-wrap';
        if (data.access === 'write') {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'kc-wall__chore kc-wall__chore--action';
          const name = document.createElement('span');
          name.className = 'kc-wall__chore-title';
          name.textContent = item.title;
          const pts = document.createElement('span');
          pts.className = 'kc-wall__chore-points';
          pts.textContent = t('extensions.kids-chores.page.points', { count: item.points });
          btn.append(name, pts);
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
              if (next.goalReached) {
                showToast(t('extensions.kids-chores.page.goalReached'), 'success');
              }
              await load();
            } catch (err) {
              if (err.csrfToken) csrf = err.csrfToken;
              btn.disabled = false;
              showToast(err.message || t('extensions.kids-chores.reason.invalid'), 'danger');
            }
          }, { signal });
          li.append(btn);
        } else {
          const row = document.createElement('div');
          row.className = 'kc-wall__chore';
          const name = document.createElement('span');
          name.className = 'kc-wall__chore-title';
          name.textContent = item.title;
          const pts = document.createElement('span');
          pts.className = 'kc-wall__chore-points';
          pts.textContent = t('extensions.kids-chores.page.points', { count: item.points });
          row.append(name, pts);
          li.append(row);
        }
        list.append(li);
      }
      section.append(list);
    }

    host.replaceChildren(section);
    host.hidden = false;
    paintIcons(host);
  }

  await load();
}
