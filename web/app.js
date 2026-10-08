const $ = (id) => document.getElementById(id);
let csrf = '';
let asset = null;
let catalog = null;
let currentRun = null;
let stream = null;
let currentFindings = null;
let selectionGeneration = 0;
let connectedGeneration = 0;
let connectedRunId = null;

async function api(path, options = {}) {
  // Only JSON bodies get a JSON content type: Fastify rejects an empty body declared as JSON (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which silently broke body-less DELETE requests.
  const headers = { ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (csrf) headers['x-csrf-token'] = csrf;
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `Request failed (${response.status})`);
  return payload;
}

function setRuntime(text, online = false) {
  $('runtime-status').textContent = text;
  document.querySelector('.dot').style.background = online ? 'var(--acid)' : 'var(--orange)';
  document.querySelector('.dot').style.boxShadow = online ? '0 0 12px var(--acid)' : '0 0 12px var(--orange)';
}

function showError(message) {
  setRuntime(message, false);
  $('model-note').textContent = message;
  $('model-note').style.color = 'var(--orange)';
}

function resetWorkspace() {
  selectionGeneration++;
  asset = null;
  if (stream) stream.close();
  stream = null; connectedRunId = null; currentRun = null; currentFindings = null;
  $('scan-view').classList.add('hidden'); $('empty-state').classList.remove('hidden');
  $('findings-card').classList.add('hidden'); $('report-card').classList.add('hidden');
  $('events').replaceChildren(); $('preview').removeAttribute('src'); $('dimensions').textContent = '';
  $('run-id').textContent = ''; $('run-state').textContent = 'READY';
  $('dialog-card').classList.add('hidden');
  $('artifacts-list')?.replaceChildren();
  $('artifacts-card')?.classList.add('hidden');
  updateAnalyze();
}

async function bootstrap() {
  const pair = new URLSearchParams(location.search).get('pair');
  const result = await api(pair ? `/api/bootstrap?pair=${encodeURIComponent(pair)}` : '/api/bootstrap');
  csrf = result.csrfToken;
  if (pair) history.replaceState({}, '', '/');
  const runtime = await api('/api/runtime');
  setRuntime(runtime.workerReady ? 'Pi runtime ready' : 'Pi runtime unavailable', runtime.workerReady);
  // Every launch starts as a new analysis. History is rendered below, but only an explicit
  // History selection may hydrate the workspace with an existing run.
  resetWorkspace();
  await Promise.all([loadModels(), loadHistory()]);
}

async function loadModels() {
  catalog = await api('/api/models');
  const select = $('model-select');
  select.replaceChildren();
  const imageModels = catalog.models.filter((model) => model.input.includes('image'));
  for (const model of imageModels) {
    const option = document.createElement('option');
    option.value = `${model.provider}/${model.modelId}`;
    option.textContent = `${model.name} · ${model.provider}`;
    option.dataset.provider = model.provider;
    option.dataset.modelId = model.modelId;
    option.dataset.thinking = model.scopedThinkingLevel || (model.reasoning ? 'medium' : 'off');
    if (model.isCurrent) option.selected = true;
    select.append(option);
  }
  if (!select.value && select.options.length) select.selectedIndex = 0;
  $('model-note').textContent = `${imageModels.length} image-capable models · ${catalog.scopePatterns.length ? 'scoped like Pi CLI' : 'all available models'}`;
  $('model-note').style.color = '';
  updateAnalyze();
}

async function loadHistory() {
  const runs = await api('/api/runs', { cache: 'no-store' });
  const history = $('history');
  history.replaceChildren();
  if (!runs.length) {
    const empty = document.createElement('div'); empty.className = 'muted'; empty.textContent = 'No scans yet.'; history.append(empty); return runs;
  }
  for (const run of runs) {
    const item = document.createElement('div'); item.className = 'history-item';
    const open = document.createElement('button'); open.className = 'history-open'; open.type = 'button';
    const title = document.createElement('strong'); title.textContent = run.id.slice(0, 8);
    const status = document.createElement('span'); status.className = 'history-status'; status.textContent = run.status;
    const meta = document.createElement('small'); meta.textContent = `${run.model.modelId} · ${new Date(run.createdAt).toLocaleString()}`;
    open.append(title, status, meta); open.addEventListener('click', () => openRun(run).catch((error) => addEvent(`OPEN FAILED: ${error.message}`, 'error')));
    const actions = document.createElement('div'); actions.className = 'history-actions';
    const remove = document.createElement('button'); remove.className = 'button ghost history-delete'; remove.type = 'button'; remove.textContent = 'DELETE';
    const terminal = ['completed', 'needs_review', 'failed', 'cancelled', 'interrupted'].includes(run.status);
    remove.disabled = !terminal;
    if (!terminal) remove.title = 'Wait for this session to settle before deleting it';
    remove.addEventListener('click', () => deleteRun(run, remove));
    actions.append(remove); item.append(open, actions); history.append(item);
  }
  return runs;
}

async function deleteRun(run, button) {
  if (!window.confirm(`Delete session ${run.id.slice(0, 8)}? Its report, activity, and uploaded image will be removed. Native Pi session logs are retained.`)) return;
  const item = button.closest('.history-item');
  item?.querySelector('.history-error')?.remove();
  button.disabled = true;
  try {
    await api(`/api/runs/${encodeURIComponent(run.id)}`, { method: 'DELETE' });
  } catch (error) {
    // NOT_FOUND means the session is already gone (e.g. deleted from another tab); anything else is a real failure.
    if (error.message !== 'NOT_FOUND') {
      button.disabled = false;
      // Report on the card itself: the activity log is hidden unless a run is open.
      const message = document.createElement('small'); message.className = 'history-error'; message.textContent = `DELETE FAILED: ${error.message}`;
      item?.append(message);
      return;
    }
  }
  item?.remove();
  if (currentRun?.id === run.id) resetWorkspace();
  await loadHistory().catch((error) => showError(`History refresh failed: ${error.message}`));
}

async function upload(file) {
  if (!file) return;
  resetWorkspace();
  $('file-status').classList.remove('hidden'); $('file-status').textContent = `Normalizing ${file.name}…`;
  const form = new FormData(); form.append('file', file, file.name);
  try {
    asset = await api('/api/assets', { method: 'POST', body: form });
    $('file-status').textContent = `${file.name} · ${asset.width}×${asset.height}`;
    $('file-status').style.color = '';
    $('preview').src = asset.previewUrl; $('dimensions').textContent = `${asset.width} × ${asset.height}`;
    $('empty-state').classList.add('hidden'); $('scan-view').classList.remove('hidden');
    addEvent('Image normalized. Ready for Pi inspection.', '');
    updateAnalyze();
  } catch (error) { asset = null; $('file-status').textContent = error.message; $('file-status').style.color = 'var(--orange)'; updateAnalyze(); }
}

function addEvent(text, kind = '') {
  const row = document.createElement('div'); row.className = `event ${kind}`; row.textContent = text; $('events').append(row); $('events').scrollTop = $('events').scrollHeight;
}

function updateAnalyze() {
  const terminal = currentRun && ['completed', 'needs_review', 'failed', 'cancelled', 'interrupted'].includes(currentRun.status);
  const analyzing = currentRun && ['queued', 'ready', 'running'].includes(currentRun.status);
  if (analyzing) { $('analyze').disabled = true; $('analyze').textContent = 'ANALYSIS RUNNING'; return; }
  if (terminal) { $('analyze').disabled = !asset || !$('model-select').value; $('analyze').textContent = 'ANALYZE WITH PI →'; return; }
  $('analyze').disabled = !asset || !$('model-select').value; $('analyze').textContent = 'ANALYZE WITH PI →';
}

function connectRun(run) {
  connectedRunId = run.id;
  connectedGeneration = selectionGeneration;
  currentRun = run;
  if (stream) stream.close();
  $('run-id').textContent = run.id.slice(0, 8); $('run-state').textContent = run.status.toUpperCase();
  stream = new EventSource(`/api/runs/${run.id}/events`);
  const eventTypes = ['run.state', 'queue.updated', 'tool.start', 'tool.update', 'tool.end', 'assistant.delta', 'assistant.message', 'artifact.ready', 'dialog.requested', 'runtime.warning', 'run.error', 'run.settled'];
  for (const type of eventTypes) stream.addEventListener(type, (event) => handleEvent(type, event, connectedRunId));
  stream.onerror = () => { if (currentRun && !['completed','needs_review','failed','cancelled','interrupted'].includes(currentRun.status)) addEvent('Connection interrupted; state remains durable.', 'error'); };
}

async function displayFindings(runId, artifactId) {
  const response = await fetch(`/api/runs/${runId}/artifacts/${artifactId}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Could not load findings (${response.status})`);
  const report = await response.json();
  if (report.type !== 'pallet-findings' || !Array.isArray(report.items)) throw new Error('The findings report has an invalid shape');
  // Guard against stale results from a previously selected run.
  if (connectedRunId !== runId || connectedGeneration !== selectionGeneration) return;
  currentFindings = report;
  const routingLink = document.querySelector('.findings-cta a');
  if (routingLink) routingLink.href = `/routing/?run=${encodeURIComponent(runId)}`;
  $('findings-total').textContent = report.totalValue == null ? '—' : `$${Number(report.totalValue).toFixed(2)}`;
  $('findings-count').textContent = `${report.pricedCount} / ${report.items.length}`;
  $('findings-unknown').textContent = String(report.unknownPriceCount);
  $('findings-meta').textContent = `${report.items.length} ITEMS · PRICE ↓`;
  const list = $('findings-list');
  list.replaceChildren();
  report.items.forEach((item, index) => {
    const card = document.createElement('article'); card.className = 'finding';
    const imageBox = document.createElement('div'); imageBox.className = 'finding-image';
    if (typeof item.image_b64 === 'string' && item.image_b64.startsWith('data:image/')) {
      const image = document.createElement('img'); image.src = item.image_b64; image.alt = item.name || 'Finding crop'; imageBox.append(image);
    } else { const empty = document.createElement('span'); empty.className = 'no-crop'; empty.textContent = 'NO CROP AVAILABLE'; imageBox.append(empty); }
    const body = document.createElement('div'); body.className = 'finding-body';
    const rank = document.createElement('div'); rank.className = 'finding-rank'; rank.textContent = `FINDING ${String(index + 1).padStart(2, '0')}`;
    const brand = document.createElement('div'); brand.className = 'finding-brand'; brand.textContent = `${item.brand || 'UNKNOWN BRAND'} · ${item.category || 'GENERAL'}`;
    const name = document.createElement('div'); name.className = 'finding-name'; name.textContent = item.name || 'Unknown item';
    const description = document.createElement('div'); description.className = 'finding-desc'; description.textContent = item.description || 'No description recorded.';
    const foot = document.createElement('div'); foot.className = 'finding-foot';
    const price = document.createElement('strong'); price.className = `finding-price${item.price == null ? ' unknown' : ''}`; price.textContent = item.price == null ? 'UNKNOWN' : `$${Number(item.price).toFixed(2)}`;
    const status = document.createElement('span'); status.className = 'finding-status'; status.textContent = item.price == null ? 'NO PRICE' : (item.status || 'PRICE RECORDED');
    foot.append(price, status); body.append(rank, brand, name, description, foot);
    if (item.source_url) { const source = document.createElement('a'); source.className = 'finding-source'; source.href = item.source_url; source.target = '_blank'; source.rel = 'noreferrer'; source.textContent = `${item.retailer || 'SOURCE'} ↗`; body.append(source); }
    card.append(imageBox, body); list.append(card);
  });
  $('findings-card').classList.remove('hidden');
}

function showArtifact(runId, artifactId, title, kind) {
  if (connectedRunId !== runId || connectedGeneration !== selectionGeneration) return;
  const list = $('artifacts-list');
  if (!list) return;
  $('artifacts-card').classList.remove('hidden');
  if (list.querySelector(`[data-artifact-id="${artifactId}"]`)) return;
  const row = document.createElement('div'); row.className = 'artifact-row'; row.dataset.artifactId = artifactId;
  const label = document.createElement('span'); label.className = 'artifact-kind'; label.textContent = kind.toUpperCase();
  const link = document.createElement('a'); link.className = 'artifact-link'; link.href = `/api/runs/${runId}/artifacts/${artifactId}`; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = title || artifactId.slice(0, 8);
  row.append(label, link); list.append(row);
}

function showDialog(runId, dialogId, question, choices) {
  if (connectedRunId !== runId || connectedGeneration !== selectionGeneration) return;
  const card = $('dialog-card'); card.classList.remove('hidden');
  $('dialog-question').textContent = question || 'Pi needs a decision.';
  const container = $('dialog-choices'); container.replaceChildren();
  const input = document.createElement('input'); input.className = 'dialog-input'; input.type = 'text'; input.placeholder = 'Type your answer…';
  container.append(input);
  for (const choice of choices ?? []) {
    const button = document.createElement('button'); button.className = 'button ghost dialog-choice'; button.type = 'button'; button.textContent = choice;
    button.addEventListener('click', () => answerDialog(runId, dialogId, choice));
    container.append(button);
  }
  const submit = document.createElement('button'); submit.className = 'button primary dialog-submit'; submit.type = 'button'; submit.textContent = 'SEND ANSWER';
  submit.addEventListener('click', () => answerDialog(runId, dialogId, input.value));
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') answerDialog(runId, dialogId, input.value); });
  container.append(submit);
  const cancel = document.createElement('button'); cancel.className = 'button ghost dialog-cancel'; cancel.type = 'button'; cancel.textContent = 'CANCEL';
  cancel.addEventListener('click', () => answerDialog(runId, dialogId, undefined, true));
  container.append(cancel);
  input.focus();
}

async function answerDialog(runId, dialogId, answer, cancelled = false) {
  try {
    await api(`/api/runs/${encodeURIComponent(runId)}/dialogs/${encodeURIComponent(dialogId)}`, { method: 'POST', body: JSON.stringify({ answer: cancelled ? undefined : answer, cancelled }) });
    $('dialog-card').classList.add('hidden');
  } catch (error) {
    addEvent(`DIALOG FAILED: ${error.message}`, 'error');
  }
}

function handleEvent(type, event, runId) {
  if (connectedRunId !== runId || connectedGeneration !== selectionGeneration) return;
  let payload = {}; try { payload = JSON.parse(event.data); } catch { payload = { text: event.data }; }
  if (type === 'run.state') {
    currentRun.status = payload.status || currentRun.status; $('run-state').textContent = currentRun.status.toUpperCase();
    addEvent(`state → ${currentRun.status}${payload.activeStage ? ` · ${payload.activeStage}` : ''}`);
    updateAnalyze();
  } else if (type === 'tool.start') addEvent(`→ ${payload.toolName}`, 'tool');
  else if (type === 'tool.end') addEvent(`← ${payload.toolName}${payload.isError ? ' · error' : ' · done'}`, payload.isError ? 'error' : 'tool');
  else if (type === 'tool.update') addEvent(`${payload.toolName}: ${payload.partialResult || ''}`, 'tool');
  else if (type === 'assistant.delta') { $('report-card').classList.remove('hidden'); $('report-text').textContent += payload.text || ''; }
  else if (type === 'assistant.message') { if (payload.text) { $('report-card').classList.remove('hidden'); $('report-text').textContent = payload.text; } }
  else if (type === 'runtime.warning') addEvent(payload.message || 'Pi needed a report retry.', 'error');
  else if (type === 'artifact.ready') {
    addEvent(`Artifact published: ${payload.title || payload.artifactId}`, 'tool');
    if (payload.sortedBy === 'price_descending') void displayFindings(runId, payload.artifactId).catch((error) => addEvent(`REPORT DISPLAY ERROR: ${error.message}`, 'error'));
    else showArtifact(runId, payload.artifactId, payload.title, payload.kind || 'artifact');
  }
  else if (type === 'dialog.requested') { addEvent('Pi asked a question →', 'tool'); showDialog(runId, payload.dialogId, payload.question, payload.choices); }
  else if (type === 'run.error') addEvent(`${payload.code}: ${payload.message}`, 'error');
  else if (type === 'run.settled') addEvent('Pi session settled.', 'tool');
  if (type === 'run.error' || type === 'run.settled' || (type === 'run.state' && ['completed', 'needs_review', 'failed', 'interrupted'].includes(payload.status))) void loadHistory();
}

async function analyze() {
  if (!asset) return;
  const option = $('model-select').selectedOptions[0];
  $('analyze').disabled = true; $('analyze').textContent = 'QUEUING…';
  $('report-text').textContent = '';
  $('report-card').classList.add('hidden');
  $('findings-card').classList.add('hidden');
  try {
    const run = await api('/api/runs', { method: 'POST', body: JSON.stringify({ assetId: asset.id, provider: option.dataset.provider, modelId: option.dataset.modelId, thinkingLevel: option.dataset.thinking || 'medium' }) });
    connectRun(run); await loadHistory();
  } catch (error) { addEvent(error.message, 'error'); updateAnalyze(); }
}

$('use-demo-photo').addEventListener('click', async () => {
  try {
    const response = await fetch('/demo/pallet-demo.jpg');
    if (!response.ok) throw new Error('Demo photo unavailable on this deployment');
    const blob = await response.blob();
    await upload(new File([blob], 'demo-pallet.jpg', { type: 'image/jpeg' }));
  } catch (error) {
    $('file-status').classList.remove('hidden');
    $('file-status').textContent = error.message;
    $('file-status').style.color = 'var(--orange)';
  }
});
$('image-input').addEventListener('change', (event) => upload(event.target.files[0]));
$('dropzone').addEventListener('dragover', (event) => { event.preventDefault(); $('dropzone').classList.add('drag'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('drag'));
$('dropzone').addEventListener('drop', (event) => { event.preventDefault(); $('dropzone').classList.remove('drag'); upload(event.dataTransfer.files[0]); });
$('model-select').addEventListener('change', updateAnalyze);
$('analyze').addEventListener('click', analyze);
$('refresh').addEventListener('click', () => loadModels().catch((error) => showError(error.message)));

async function openRun(run) {
  resetWorkspace();
  // resetWorkspace starts a new selection. Compare against it, not connectedGeneration, which only
  // connectRun updates: that comparison was always unequal here, so every History click stopped
  // after fetching the run and left an empty scan view.
  const generation = selectionGeneration;
  $('empty-state').classList.add('hidden'); $('scan-view').classList.remove('hidden');
  const full = await api(`/api/runs/${run.id}`);
  // Check if the user selected another run while loading.
  if (generation !== selectionGeneration) return;
  const assetData = await api(`/api/assets/${full.assetId}/preview`).then(() => ({ id: full.assetId, previewUrl: `/api/assets/${full.assetId}/preview` })).catch(() => null);
  if (generation !== selectionGeneration) return;
  if (assetData) { $('preview').src = assetData.previewUrl; }
  connectRun(full); addEvent(`Loaded durable run ${run.id.slice(0, 8)} · ${full.status}`);
  updateAnalyze();
}

bootstrap().catch((error) => showError(error.message === 'AUTH_REQUIRED' ? 'Session expired. Reopen the latest launch URL from the server.' : error.message));
