const state = {
  userId: 'demo-user',
  meals: [],
  eventStream: []
};

const overviewCards = document.querySelector('#overview-cards');
const experimentName = document.querySelector('#experiment-name');
const variantBars = document.querySelector('#variant-bars');
const evaluationFramework = document.querySelector('#evaluation-framework');
const eventStream = document.querySelector('#event-stream');
const chatLog = document.querySelector('#chat-log');
const mealList = document.querySelector('#meal-list');
const chatUserId = document.querySelector('#chat-user-id');

function renderOverview(overview) {
  const cards = [
    ['Total events', overview.totalEvents],
    ['Users', overview.totalUsers],
    ['Activation rate', `${Math.round(overview.activationRate * 100)}%`],
    ['Meals logged', overview.mealsLogged],
    ['Meals edited', overview.mealsEdited],
    ['Messages sent', overview.outboundMessages]
  ];

  overviewCards.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="metric-card">
          <span>${label}</span>
          <strong>${value}</strong>
        </article>
      `
    )
    .join('');
}

function renderExperiment(experiments) {
  experimentName.textContent = experiments.name;
  const total = experiments.variants.reduce((sum, variant) => sum + variant.users, 0) || 1;
  variantBars.innerHTML = experiments.variants
    .map((variant) => {
      const percent = Math.round((variant.users / total) * 100);
      return `
        <article class="variant-card">
          <div class="panel-head">
            <div>
              <h3>${variant.variant}</h3>
              <span>${variant.name}</span>
            </div>
            <strong>${variant.users} users</strong>
          </div>
          <div class="variant-track">
            <div class="variant-fill" style="width:${percent}%"></div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderEvaluationFramework(payload) {
  evaluationFramework.innerHTML = `
    <article class="eval-card">
      <span>North star</span>
      <p>${payload.northStar}</p>
    </article>
    <article class="eval-card">
      <span>Primary metrics</span>
      <p>${payload.primaryMetrics.join('<br />')}</p>
    </article>
    <article class="eval-card">
      <span>Guardrails</span>
      <p>${payload.guardrailMetrics.join('<br />')}</p>
    </article>
    <article class="eval-card">
      <span>Notes</span>
      <p>${payload.notes.join('<br />')}</p>
    </article>
  `;
}

function pushEventCard(item) {
  state.eventStream = [item, ...state.eventStream].slice(0, 24);
  eventStream.innerHTML = state.eventStream
    .map(
      (event) => `
        <article class="event-card">
          <div class="panel-head">
            <strong>${event.type}</strong>
            <span>${new Date(event.ts).toLocaleTimeString()}</span>
          </div>
          <div class="mono">${JSON.stringify(event, null, 2)}</div>
        </article>
      `
    )
    .join('');
}

function appendBubble(role, text, variant) {
  const node = document.createElement('article');
  node.className = `bubble ${role}`;
  node.innerHTML = variant ? `<strong>${variant}</strong><br />${text}` : text;
  chatLog.appendChild(node);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderMeals() {
  if (!state.meals.length) {
    mealList.innerHTML = '<article class="meal-card">No meals logged yet for this user.</article>';
    return;
  }

  mealList.innerHTML = state.meals
    .map(
      (meal) => `
        <article class="meal-card">
          <div class="panel-head">
            <div>
              <strong>${meal.name}</strong>
              <span>${meal.id} • ${new Date(meal.loggedAt).toLocaleString()}</span>
            </div>
            <strong>${meal.calories} kcal</strong>
          </div>
          <div>P${meal.protein} / C${meal.carbs} / F${meal.fats}</div>
          <div class="meal-actions">
            <button data-action="bump" data-id="${meal.id}">+50 kcal</button>
            <button data-action="delete" data-id="${meal.id}">Delete</button>
          </div>
        </article>
      `
    )
    .join('');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  return response.json();
}

async function loadMetrics() {
  const payload = await api('/api/metrics');
  renderOverview(payload.overview);
  renderExperiment(payload.experiments);
  payload.recentEvents.forEach((event) => pushEventCard(event));
}

async function loadFramework() {
  renderEvaluationFramework(await api('/api/evaluation-framework'));
}

async function loadMeals() {
  state.userId = chatUserId.value.trim() || 'demo-user';
  state.meals = await api(`/api/users/${encodeURIComponent(state.userId)}/meals`);
  renderMeals();
}

async function sendChat(text) {
  appendBubble('user', text);
  const reply = await api('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      userId: state.userId,
      text,
      channel: 'dashboard'
    })
  });
  appendBubble('bot', reply.text, `Variant ${reply.variant.key} • ${reply.variant.name}`);
  await Promise.all([loadMeals(), loadMetrics()]);
}

document.querySelector('#chat-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  state.userId = chatUserId.value.trim() || 'demo-user';
  const input = document.querySelector('#chat-input');
  const value = input.value.trim();
  if (!value) {
    return;
  }
  input.value = '';
  await sendChat(value);
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', async () => {
    state.userId = chatUserId.value.trim() || 'demo-user';
    await sendChat(button.dataset.prompt);
  });
});

document.querySelector('#meal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  state.userId = chatUserId.value.trim() || 'demo-user';
  const form = new FormData(event.currentTarget);
  await api(`/api/users/${encodeURIComponent(state.userId)}/meals`, {
    method: 'POST',
    body: JSON.stringify(Object.fromEntries(form.entries()))
  });
  event.currentTarget.reset();
  await Promise.all([loadMeals(), loadMetrics()]);
});

mealList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }
  state.userId = chatUserId.value.trim() || 'demo-user';
  const mealId = button.dataset.id;

  if (button.dataset.action === 'bump') {
    const meal = state.meals.find((item) => item.id === mealId);
    if (!meal) {
      return;
    }
    await api(`/api/users/${encodeURIComponent(state.userId)}/meals/${mealId}`, {
      method: 'PATCH',
      body: JSON.stringify({ calories: Number(meal.calories) + 50 })
    });
  }

  if (button.dataset.action === 'delete') {
    await api(`/api/users/${encodeURIComponent(state.userId)}/meals/${mealId}`, {
      method: 'DELETE'
    });
  }

  await Promise.all([loadMeals(), loadMetrics()]);
});

document.querySelector('#refresh-metrics').addEventListener('click', loadMetrics);
document.querySelector('#load-meals').addEventListener('click', loadMeals);

function initEventSource() {
  const source = new EventSource('/api/stream');
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    pushEventCard(payload);
  };
}

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  await Promise.all([loadMetrics(), loadFramework(), loadMeals()]);
  initEventSource();
  appendBubble('bot', 'Use the chat box to simulate Telegram messages. The dashboard will update live.');
}

boot();
