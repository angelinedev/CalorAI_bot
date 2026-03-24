const state = {
  session: null,
  portalUrl: '',
  admin: null,
  adminUser: null,
  personal: null,
  analysis: null,
  selectedUserId: null,
  credentialsNotice: null,
  notice: null,
  loginError: '',
  eventStream: [],
  coachMessages: [],
  mealEditor: null
};

const app = document.querySelector('#app');
let source = null;
let liveSyncTimer = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDateTime(value) {
  if (!value) {
    return 'No activity yet';
  }
  return new Date(value).toLocaleString();
}

function formatShortDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}

function formatEndpointDisplay(value, fallback = 'Not configured') {
  if (!value) {
    return fallback;
  }

  try {
    const url = new URL(value);
    const trimmedPath = url.pathname.length > 28 ? `${url.pathname.slice(0, 28)}...` : url.pathname;
    return `${url.hostname}${trimmedPath === '/' ? '' : trimmedPath}`;
  } catch {
    return String(value).length > 44 ? `${String(value).slice(0, 44)}...` : String(value);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `Request failed with ${response.status}`);
  }
  return payload;
}

async function loadSession() {
  const payload = await api('/api/auth/session');
  state.session = payload.user || null;
  state.portalUrl = payload.portalUrl || `${window.location.origin}/portal`;
}

async function loadAdminDashboard() {
  const payload = await api('/api/admin/dashboard');
  state.admin = payload;
  state.eventStream = payload.recentEvents || [];

  if (!state.selectedUserId) {
    const firstUser = payload.users.find((user) => user.role !== 'admin') || payload.users[0];
    state.selectedUserId = firstUser?.id || null;
  }

  if (state.selectedUserId) {
    await loadAdminUserDashboard(state.selectedUserId);
  }
}

async function loadAdminUserDashboard(userId) {
  state.selectedUserId = userId;
  state.adminUser = await api(`/api/admin/users/${encodeURIComponent(userId)}/dashboard`);
}

async function loadPersonalDashboard() {
  state.personal = await api('/api/me/dashboard');
  state.eventStream = state.personal.insights?.recentEvents || [];
  state.analysis = null;
  if (!state.coachMessages.length) {
    state.coachMessages = [
      {
        role: 'bot',
        text: 'Your CalorAI coach is ready. Log meals naturally, ask for a summary, or request daily analysis.'
      }
    ];
  }
}

async function loadRoleData() {
  if (!state.session) {
    state.admin = null;
    state.adminUser = null;
    state.personal = null;
    state.analysis = null;
    state.eventStream = [];
    closeStream();
    return;
  }

  openStream();
  if (state.session.role === 'admin') {
    await loadAdminDashboard();
    return;
  }

  await loadPersonalDashboard();
}

function shouldSyncDashboard(event) {
  return ['meal_logged', 'meal_edited', 'meal_deleted', 'profile_updated', 'portal_password_reset'].includes(
    event.type
  );
}

function queueLiveSync(event) {
  if (!shouldSyncDashboard(event)) {
    return;
  }

  window.clearTimeout(liveSyncTimer);
  liveSyncTimer = window.setTimeout(async () => {
    try {
      if (state.session?.role === 'admin') {
        await loadAdminDashboard();
      } else if (state.session) {
        await loadPersonalDashboard();
      }
      render();
    } catch {}
  }, 350);
}

function openStream() {
  if (source) {
    return;
  }

  source = new EventSource('/api/stream');
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    const visibleToUser =
      state.session?.role === 'admin' || String(payload.userId || '') === String(state.session?.id || '');

    if (!visibleToUser) {
      return;
    }

    state.eventStream = [payload, ...state.eventStream].slice(0, 24);
    queueLiveSync(payload);
    render();
  };
}

function closeStream() {
  if (!source) {
    return;
  }
  source.close();
  source = null;
}

function setNotice(message, tone = 'success') {
  state.notice = { message, tone };
  render();
  window.clearTimeout(setNotice.timer);
  setNotice.timer = window.setTimeout(() => {
    state.notice = null;
    render();
  }, 3200);
}

function statCard(label, value, hint = '') {
  return `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <p>${escapeHtml(hint)}</p>
    </article>
  `;
}

function renderTrend(trend = []) {
  if (!trend.length) {
    return '<div class="empty-state">Trend will appear after a few meal logs.</div>';
  }

  const maxCalories = Math.max(...trend.map((item) => Number(item.calories || 0)), 1);
  return `
    <div class="trend-list">
      ${trend
        .map(
          (item) => `
            <div class="trend-row">
              <div>
                <strong>${escapeHtml(formatShortDate(item.day))}</strong>
                <span>${escapeHtml(`${formatNumber(item.mealCount)} meals`)}</span>
              </div>
              <div class="trend-bar">
                <div class="trend-fill" style="width:${Math.max(12, Math.round((item.calories / maxCalories) * 100))}%"></div>
              </div>
              <strong>${escapeHtml(`${formatNumber(item.calories)} kcal`)}</strong>
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function renderEvents() {
  if (!state.eventStream.length) {
    return '<div class="empty-state">Events will stream here when users interact with the bot or portal.</div>';
  }

  return state.eventStream
    .map(
      (event) => `
        <article class="event-card">
          <div class="row spread">
            <strong>${escapeHtml(event.type)}</strong>
            <span>${escapeHtml(formatDateTime(event.ts))}</span>
          </div>
          <div class="event-meta">
            <span>User: ${escapeHtml(event.userId || 'system')}</span>
            <span>${escapeHtml(event.channel || event.variant || event.eventName || '')}</span>
          </div>
        </article>
      `
    )
    .join('');
}

function renderLogin() {
  const pathLabel = window.location.pathname === '/admin' ? 'Admin Access' : 'Member Access';

  return `
    <div class="shell auth-shell">
      <section class="hero auth-hero">
        <div>
          <p class="eyebrow">CalorAI Portal</p>
          <h1>Nutrition operations, refined.</h1>
          <p class="lede">Secure access to the CalorAI admin console and private member dashboard.</p>
          <div class="hero-badges">
            <span>Admin Console</span>
            <span>Member Portal</span>
            <span>Live Telemetry</span>
          </div>
        </div>
        <div class="panel auth-card">
          <div class="panel-head">
            <div>
              <h2>${escapeHtml(pathLabel)}</h2>
              <p>Sign in to continue.</p>
            </div>
          </div>
          <form id="login-form" class="stack-form">
            <label class="field">
              <span>Username</span>
              <input name="username" autocomplete="username" placeholder="admin or user handle" required />
            </label>
            <label class="field">
              <span>Password</span>
              <input name="password" type="password" autocomplete="current-password" placeholder="Enter password" required />
            </label>
            ${state.loginError ? `<p class="feedback error">${escapeHtml(state.loginError)}</p>` : ''}
            <button type="submit">Enter portal</button>
          </form>
        </div>
      </section>
    </div>
  `;
}

function renderSetupCards(setup = {}) {
  return `
    <div class="setup-grid">
      <article class="setup-card">
        <span>Telegram</span>
        <strong>${setup.telegram?.hasBotToken ? 'Connected' : 'Local only'}</strong>
        <p>${escapeHtml(formatEndpointDisplay(setup.telegram?.webhookUrl))}</p>
      </article>
      <article class="setup-card">
        <span>Statsig</span>
        <strong>${setup.statsig?.initialized ? 'Active' : 'Fallback mode'}</strong>
        <p>${escapeHtml(setup.statsig?.experiment || 'Local assignment')}</p>
      </article>
      <article class="setup-card">
        <span>n8n</span>
        <strong>${setup.n8n?.configured ? 'Relay enabled' : 'Optional'}</strong>
        <p>${escapeHtml(formatEndpointDisplay(setup.n8n?.webhookUrl, 'No webhook set'))}</p>
      </article>
    </div>
  `;
}

function renderAdmin() {
  const dashboard = state.admin || {};
  const selectedUser = state.adminUser;
  const overview = dashboard.overview || {};
  const adminOverview = dashboard.adminOverview || {};
  const users = dashboard.users || [];
  const variants = dashboard.experiments?.variants || [];
  const variantTotal = variants.reduce((sum, item) => sum + Number(item.users || 0), 0) || 1;

  return `
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Admin Control Room</p>
          <h1>CalorAI operations</h1>
        </div>
        <div class="topbar-actions">
          <div class="session-pill">
            <span>${escapeHtml(state.session.displayName || state.session.username)}</span>
            <strong>${escapeHtml(state.session.role)}</strong>
          </div>
          <button class="ghost" data-action="refresh-admin">Refresh</button>
          <button class="ghost" data-action="logout">Log out</button>
        </div>
      </header>

      <section class="hero admin-hero">
        <div class="hero-copy">
          <h2>Track the whole product from one place.</h2>
          <p>Operational visibility across users, telemetry, experiments, and deployment health.</p>
        </div>
        ${renderSetupCards(dashboard.setup)}
      </section>

      <section class="card-grid stat-grid">
        ${statCard('Total users', formatNumber(adminOverview.totalUsers || 0), 'Portal accounts in SQLite')}
        ${statCard('Meals today', formatNumber(adminOverview.mealsToday || 0), 'Daily usage pulse')}
        ${statCard('Active today', formatNumber(adminOverview.activeUsersToday || 0), 'Distinct users with meals')}
        ${statCard('Events', formatNumber(overview.totalEvents || 0), 'Logged in events.jsonl')}
        ${statCard('Activation', `${Math.round(Number(overview.activationRate || 0) * 100)}%`, 'Users who logged at least one meal')}
        ${statCard('Messages sent', formatNumber(overview.outboundMessages || 0), 'Telegram outbound traffic')}
      </section>

      <main class="dashboard-grid admin-grid">
        <section class="panel span-7">
          <div class="panel-head">
            <div>
              <h2>User roster</h2>
              <p>Create portal accounts and jump into any user journey.</p>
            </div>
          </div>
          <div class="user-grid">
            ${users
              .map(
                (user) => `
                  <button class="user-card ${state.selectedUserId === user.id ? 'is-active' : ''}" data-action="select-user" data-user-id="${escapeHtml(user.id)}">
                    <div class="row spread">
                      <strong>${escapeHtml(user.displayName || user.username)}</strong>
                      <span class="role-chip">${escapeHtml(user.role)}</span>
                    </div>
                    <p>@${escapeHtml(user.username)}</p>
                    <div class="user-card-meta">
                      <span>${escapeHtml(`${formatNumber(user.mealCount)} meals`)}</span>
                      <span>${escapeHtml(`${formatNumber(user.caloriesToday)} kcal today`)}</span>
                    </div>
                  </button>
                `
              )
              .join('')}
          </div>
        </section>

        <section class="panel span-5">
          <div class="panel-head">
            <div>
              <h2>Create user</h2>
              <p>Provision credentials for a new portal user.</p>
            </div>
          </div>
          <form id="create-user-form" class="stack-form">
            <label class="field">
              <span>Username</span>
              <input name="username" placeholder="ananya_fit" required />
            </label>
            <label class="field">
              <span>Display name</span>
              <input name="displayName" placeholder="Ananya" required />
            </label>
            <div class="split-fields">
              <label class="field">
                <span>Telegram user ID</span>
                <input name="telegramUserId" placeholder="Optional" />
              </label>
              <label class="field">
                <span>Telegram username</span>
                <input name="telegramUsername" placeholder="Optional" />
              </label>
            </div>
            <div class="split-fields">
              <label class="field">
                <span>Daily calories</span>
                <input name="dailyCalorieTarget" type="number" value="2200" />
              </label>
              <label class="field">
                <span>Daily protein</span>
                <input name="dailyProteinTarget" type="number" value="120" />
              </label>
            </div>
            <label class="field">
              <span>Password</span>
              <input name="password" placeholder="Leave blank to auto-generate" />
            </label>
            <button type="submit">Create portal account</button>
          </form>
          ${
            state.credentialsNotice
              ? `
                <div class="credential-card">
                  <span>Latest credentials</span>
                  <strong>${escapeHtml(state.credentialsNotice.username)}</strong>
                  <p>Password: ${escapeHtml(state.credentialsNotice.password)}</p>
                </div>
              `
              : ''
          }
        </section>

        <section class="panel span-6">
          <div class="panel-head">
            <div>
              <h2>Experiment reach</h2>
              <p>${escapeHtml(dashboard.experiments?.name || 'coach_tone_v1')}</p>
            </div>
          </div>
          <div class="stack-list">
            ${variants
              .map(
                (variant) => `
                  <article class="variant-card">
                    <div class="row spread">
                      <div>
                        <strong>${escapeHtml(variant.variant)}</strong>
                        <p>${escapeHtml(variant.name)}</p>
                      </div>
                      <span>${escapeHtml(`${formatNumber(variant.users)} users`)}</span>
                    </div>
                    <div class="variant-bar">
                      <div class="variant-fill" style="width:${Math.round((variant.users / variantTotal) * 100)}%"></div>
                    </div>
                  </article>
                `
              )
              .join('')}
          </div>
        </section>

        <section class="panel span-6">
          <div class="panel-head">
            <div>
              <h2>Live activity</h2>
              <p>Telemetry, bot events, and provisioning flow.</p>
            </div>
          </div>
          <div class="event-list">${renderEvents()}</div>
        </section>

        <section class="panel span-12">
          <div class="panel-head">
            <div>
              <h2>Selected user</h2>
              <p>${selectedUser ? `Deep dive into ${selectedUser.user.displayName || selectedUser.user.username}` : 'Pick a user from the roster.'}</p>
            </div>
            ${
              selectedUser && selectedUser.user.role !== 'admin'
                ? '<button class="ghost" data-action="reset-password">Reset password</button>'
                : ''
            }
          </div>
          ${
            selectedUser
              ? `
                <div class="detail-grid">
                  <div class="detail-column">
                    <div class="mini-grid">
                      ${statCard('Calories today', formatNumber(selectedUser.summary.totals.calories), 'Current intake')}
                      ${statCard('Protein today', `${formatNumber(selectedUser.summary.totals.protein)} g`, 'Macro progress')}
                      ${statCard('Meals logged', formatNumber(selectedUser.summary.meals.length), 'Entries today')}
                      ${statCard('Last event', selectedUser.insights.lastEventAt ? formatShortDate(selectedUser.insights.lastEventAt) : 'None', 'Recent engagement')}
                    </div>
                    <div class="subpanel">
                      <h3>7-day intake trend</h3>
                      ${renderTrend(selectedUser.trend)}
                    </div>
                  </div>
                  <div class="detail-column">
                    <div class="subpanel">
                      <h3>Recent meals</h3>
                      <div class="stack-list">
                        ${
                          selectedUser.recentMeals.length
                            ? selectedUser.recentMeals
                                .map(
                                  (meal) => `
                                    <article class="meal-row">
                                      <div>
                                        <strong>${escapeHtml(meal.name)}</strong>
                                        <p>${escapeHtml(formatDateTime(meal.loggedAt))}</p>
                                      </div>
                                      <span>${escapeHtml(`${formatNumber(meal.calories)} kcal`)}</span>
                                    </article>
                                  `
                                )
                                .join('')
                            : '<div class="empty-state">No recent meals for this user yet.</div>'
                        }
                      </div>
                    </div>
                    <div class="subpanel">
                      <h3>User activity</h3>
                      <div class="stack-list compact">
                        ${selectedUser.insights.recentEvents
                          .map(
                            (event) => `
                              <article class="event-card compact">
                                <div class="row spread">
                                  <strong>${escapeHtml(event.type)}</strong>
                                  <span>${escapeHtml(formatDateTime(event.ts))}</span>
                                </div>
                              </article>
                            `
                          )
                          .join('')}
                      </div>
                    </div>
                  </div>
                </div>
              `
              : '<div class="empty-state">No user selected.</div>'
          }
        </section>
      </main>
    </div>
  `;
}

function renderMealList() {
  const meals = [...(state.personal?.summary?.meals || [])].sort(
    (left, right) => new Date(right.loggedAt).getTime() - new Date(left.loggedAt).getTime()
  );
  if (!meals.length) {
    return '<div class="empty-state">No meals logged yet today.</div>';
  }

  return meals
    .map(
      (meal) => `
        <article class="meal-entry">
          <div>
            <strong>${escapeHtml(meal.name)}</strong>
            <p>${escapeHtml(`${formatNumber(meal.calories)} kcal | P${formatNumber(meal.protein)} / C${formatNumber(meal.carbs)} / F${formatNumber(meal.fats)}`)}</p>
          </div>
          <div class="row">
            <button class="ghost small" data-action="edit-meal" data-meal-id="${escapeHtml(meal.id)}">Edit</button>
            <button class="ghost small danger" data-action="delete-meal" data-meal-id="${escapeHtml(meal.id)}">Delete</button>
          </div>
        </article>
      `
    )
    .join('');
}

function renderCoachMessages() {
  return state.coachMessages
    .map(
      (message) => `
        <article class="chat-bubble ${message.role}">
          <p>${escapeHtml(message.text)}</p>
        </article>
      `
    )
    .join('');
}

function renderUser() {
  const dashboard = state.personal;
  const user = dashboard.user;
  const summary = dashboard.summary;
  const targets = {
    caloriesLeft: Number(user.dailyCalorieTarget || 0) - Number(summary.totals.calories || 0),
    proteinLeft: Number(user.dailyProteinTarget || 0) - Number(summary.totals.protein || 0)
  };
  const editing = state.mealEditor;

  return `
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Personal Dashboard</p>
          <h1>${escapeHtml(user.displayName || user.username)}</h1>
        </div>
        <div class="topbar-actions">
          <div class="session-pill">
            <span>${escapeHtml(user.username)}</span>
            <strong>${escapeHtml(user.role)}</strong>
          </div>
          <button class="ghost" data-action="refresh-user">Refresh</button>
          <button class="ghost" data-action="logout">Log out</button>
        </div>
      </header>

      <section class="hero user-hero">
        <div class="hero-copy">
          <h2>See your intake, analysis, and coaching in one place.</h2>
          <p>
            This dashboard is private to your account. The same credentials can be issued by the admin or by
            sending <code>/portal</code> to the CalorAI bot.
          </p>
        </div>
        <div class="mini-grid">
          ${statCard('Calories today', formatNumber(summary.totals.calories), `${formatNumber(targets.caloriesLeft)} remaining to target`)}
          ${statCard('Protein today', `${formatNumber(summary.totals.protein)} g`, `${formatNumber(targets.proteinLeft)} g remaining`)}
          ${statCard('Meals today', formatNumber(summary.meals.length), 'Tracked entries')}
          ${statCard('Events', formatNumber(dashboard.insights.totalEvents || 0), 'Portal + bot activity')}
        </div>
      </section>

      <main class="dashboard-grid user-grid-layout">
        <section class="panel span-7">
          <div class="panel-head">
            <div>
              <h2>Daily analysis</h2>
              <p>Generate a current-day review based on your meal log.</p>
            </div>
            <button data-action="load-analysis">Refresh analysis</button>
          </div>
          ${
            state.analysis
              ? `
                <div class="analysis-card">
                  <span class="role-chip">Variant ${escapeHtml(state.analysis.variant.key)} | ${escapeHtml(state.analysis.variant.name)}</span>
                  <h3>${escapeHtml(state.analysis.analysis.headline)}</h3>
                  <p>${escapeHtml(state.analysis.analysis.advice)}</p>
                </div>
              `
              : '<div class="empty-state">Run analysis to get a fresh read on today&apos;s nutrition balance.</div>'
          }
          <div class="subpanel">
            <h3>7-day trend</h3>
            ${renderTrend(dashboard.trend)}
          </div>
        </section>

        <section class="panel span-5">
          <div class="panel-head">
            <div>
              <h2>Profile</h2>
              <p>Update your display and daily goals.</p>
            </div>
          </div>
          <form id="profile-form" class="stack-form">
            <label class="field">
              <span>Display name</span>
              <input name="displayName" value="${escapeHtml(user.displayName || '')}" required />
            </label>
            <div class="split-fields">
              <label class="field">
                <span>Daily calorie target</span>
                <input name="dailyCalorieTarget" type="number" value="${escapeHtml(user.dailyCalorieTarget)}" required />
              </label>
              <label class="field">
                <span>Daily protein target</span>
                <input name="dailyProteinTarget" type="number" value="${escapeHtml(user.dailyProteinTarget)}" required />
              </label>
            </div>
            <button type="submit">Save profile</button>
          </form>
          <form id="password-form" class="stack-form inset-form">
            <label class="field">
              <span>Current password</span>
              <input name="currentPassword" type="password" required />
            </label>
            <label class="field">
              <span>New password</span>
              <input name="nextPassword" type="password" minlength="8" required />
            </label>
            <button type="submit" class="ghost">Change password</button>
          </form>
        </section>

        <section class="panel span-7">
          <div class="panel-head">
            <div>
              <h2>${editing ? 'Edit meal' : 'Meal journal'}</h2>
              <p>${editing ? 'Update the selected meal entry.' : 'Log meals manually when needed.'}</p>
            </div>
            ${editing ? '<button class="ghost" data-action="cancel-edit">Cancel</button>' : ''}
          </div>
          <form id="meal-form" class="stack-form">
            <label class="field">
              <span>Meal name</span>
              <input name="name" value="${escapeHtml(editing?.name || '')}" placeholder="Paneer wrap" required />
            </label>
            <div class="quad-fields">
              <label class="field">
                <span>Calories</span>
                <input name="calories" type="number" value="${escapeHtml(editing?.calories || '')}" required />
              </label>
              <label class="field">
                <span>Protein</span>
                <input name="protein" type="number" value="${escapeHtml(editing?.protein || 0)}" />
              </label>
              <label class="field">
                <span>Carbs</span>
                <input name="carbs" type="number" value="${escapeHtml(editing?.carbs || 0)}" />
              </label>
              <label class="field">
                <span>Fats</span>
                <input name="fats" type="number" value="${escapeHtml(editing?.fats || 0)}" />
              </label>
            </div>
            <button type="submit">${editing ? 'Save meal' : 'Add meal'}</button>
          </form>
          <div class="stack-list">${renderMealList()}</div>
        </section>

        <section class="panel span-5">
          <div class="panel-head">
            <div>
              <h2>Coach chat</h2>
              <p>Message the same assistant logic that powers the bot.</p>
            </div>
          </div>
          <div class="chat-log">${renderCoachMessages()}</div>
          <form id="coach-form" class="chat-form">
            <input name="text" placeholder="Try: I just ate chicken biryani" required />
            <button type="submit">Send</button>
          </form>
        </section>

        <section class="panel span-12">
          <div class="panel-head">
            <div>
              <h2>Recent activity</h2>
              <p>Your latest portal and bot events.</p>
            </div>
          </div>
          <div class="event-list">${renderEvents()}</div>
        </section>
      </main>
    </div>
  `;
}

function renderFrame(content) {
  return `
    ${state.notice ? `<div class="banner ${state.notice.tone}">${escapeHtml(state.notice.message)}</div>` : ''}
    ${content}
  `;
}

function render() {
  if (!state.session) {
    app.innerHTML = renderFrame(renderLogin());
    bindEvents();
    return;
  }

  app.innerHTML = renderFrame(state.session.role === 'admin' ? renderAdmin() : renderUser());
  bindEvents();
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    state.loginError = '';
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    await loadSession();
    await loadRoleData();
    render();
  } catch (error) {
    state.loginError = error.message;
    render();
  }
}

async function handleLogout() {
  await api('/api/auth/logout', { method: 'POST', body: '{}' });
  state.session = null;
  state.admin = null;
  state.adminUser = null;
  state.personal = null;
  state.analysis = null;
  state.selectedUserId = null;
  state.credentialsNotice = null;
  state.eventStream = [];
  state.coachMessages = [];
  state.mealEditor = null;
  closeStream();
  render();
}

async function handleCreateUser(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget).entries());
  const payload = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''));
  const created = await api('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  state.credentialsNotice = created;
  await loadAdminDashboard();
  render();
  setNotice('Portal user created and credentials issued.');
}

async function handleResetPassword() {
  if (!state.selectedUserId) {
    return;
  }
  const reset = await api(`/api/admin/users/${encodeURIComponent(state.selectedUserId)}/reset-password`, {
    method: 'POST',
    body: '{}'
  });
  state.credentialsNotice = reset;
  render();
  setNotice('Password reset complete.');
}

async function handleMealSubmit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  const mealId = state.mealEditor?.id;
  const path = mealId ? `/api/me/meals/${encodeURIComponent(mealId)}` : '/api/me/meals';
  const method = mealId ? 'PATCH' : 'POST';
  await api(path, {
    method,
    body: JSON.stringify(payload)
  });
  state.mealEditor = null;
  await loadPersonalDashboard();
  render();
  setNotice(mealId ? 'Meal updated.' : 'Meal logged.');
}

async function handleDeleteMeal(mealId) {
  await api(`/api/me/meals/${encodeURIComponent(mealId)}`, {
    method: 'DELETE',
    body: '{}'
  });
  state.mealEditor = null;
  await loadPersonalDashboard();
  render();
  setNotice('Meal removed.');
}

async function handleLoadAnalysis() {
  state.analysis = await api('/api/me/analysis');
  render();
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  await api('/api/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
  await loadPersonalDashboard();
  render();
  setNotice('Profile updated.');
}

async function handlePasswordSubmit(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  await api('/api/me/password', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  event.currentTarget.reset();
  setNotice('Password changed.');
}

async function handleCoachSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const text = String(form.get('text') || '').trim();
  if (!text) {
    return;
  }

  state.coachMessages.push({ role: 'user', text });
  render();

  const reply = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      text,
      channel: 'portal'
    })
  });

  state.coachMessages.push({ role: 'bot', text: reply.text });
  event.currentTarget.reset();
  await loadPersonalDashboard();
  render();
}

function bindEvents() {
  document.querySelector('#login-form')?.addEventListener('submit', handleLogin);
  document.querySelector('#create-user-form')?.addEventListener('submit', (event) => {
    handleCreateUser(event).catch((error) => setNotice(error.message, 'error'));
  });
  document.querySelector('#meal-form')?.addEventListener('submit', (event) => {
    handleMealSubmit(event).catch((error) => setNotice(error.message, 'error'));
  });
  document.querySelector('#profile-form')?.addEventListener('submit', (event) => {
    handleProfileSubmit(event).catch((error) => setNotice(error.message, 'error'));
  });
  document.querySelector('#password-form')?.addEventListener('submit', (event) => {
    handlePasswordSubmit(event).catch((error) => setNotice(error.message, 'error'));
  });
  document.querySelector('#coach-form')?.addEventListener('submit', (event) => {
    handleCoachSubmit(event).catch((error) => setNotice(error.message, 'error'));
  });

  document.querySelectorAll('[data-action="logout"]').forEach((button) => {
    button.addEventListener('click', () => handleLogout().catch((error) => setNotice(error.message, 'error')));
  });

  document.querySelectorAll('[data-action="refresh-admin"]').forEach((button) => {
    button.addEventListener('click', () => {
      loadAdminDashboard().then(render).catch((error) => setNotice(error.message, 'error'));
    });
  });

  document.querySelectorAll('[data-action="refresh-user"]').forEach((button) => {
    button.addEventListener('click', () => {
      loadPersonalDashboard().then(render).catch((error) => setNotice(error.message, 'error'));
    });
  });

  document.querySelectorAll('[data-action="select-user"]').forEach((button) => {
    button.addEventListener('click', () => {
      loadAdminUserDashboard(button.dataset.userId).then(render).catch((error) => setNotice(error.message, 'error'));
    });
  });

  document.querySelectorAll('[data-action="reset-password"]').forEach((button) => {
    button.addEventListener('click', () => handleResetPassword().catch((error) => setNotice(error.message, 'error')));
  });

  document.querySelectorAll('[data-action="load-analysis"]').forEach((button) => {
    button.addEventListener('click', () => handleLoadAnalysis().catch((error) => setNotice(error.message, 'error')));
  });

  document.querySelectorAll('[data-action="edit-meal"]').forEach((button) => {
    button.addEventListener('click', () => {
      const meal = state.personal.summary.meals.find((item) => item.id === button.dataset.mealId);
      state.mealEditor = meal || null;
      render();
    });
  });

  document.querySelectorAll('[data-action="delete-meal"]').forEach((button) => {
    button.addEventListener('click', () => {
      handleDeleteMeal(button.dataset.mealId).catch((error) => setNotice(error.message, 'error'));
    });
  });

  document.querySelectorAll('[data-action="cancel-edit"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.mealEditor = null;
      render();
    });
  });
}

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  await loadSession();
  await loadRoleData();
  render();
}

boot().catch((error) => {
  app.innerHTML = `<div class="shell"><div class="panel"><h1>App failed to load</h1><p>${escapeHtml(error.message)}</p></div></div>`;
});
