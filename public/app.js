const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickBtn = document.getElementById('pick-btn');
const uploadBtn = document.getElementById('upload-btn');
const refreshBtn = document.getElementById('refresh-btn');
const uploadStatus = document.getElementById('upload-status');
const gallery = document.getElementById('gallery');
const statCount = document.getElementById('stat-count');
const statSize = document.getElementById('stat-size');
const dumpBtn = document.getElementById('dump-btn');
const logoutBtn = document.getElementById('logout-btn');
const auth = document.getElementById('auth');
const authInput = document.getElementById('auth-input');
const authBtn = document.getElementById('auth-btn');
const authError = document.getElementById('auth-error');
const queueList = document.getElementById('queue-list');
const queueCount = document.getElementById('queue-count');
const queueClear = document.getElementById('queue-clear');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
const groupSelect = document.getElementById('group-select');
const groupFilter = document.getElementById('group-filter');
const groupsList = document.getElementById('groups-list');
const groupInput = document.getElementById('group-input');
const groupCreate = document.getElementById('group-create');

let queue = [];
let accessToken = sessionStorage.getItem('mediaAccessToken') || '';
let groups = [];
let itemsCache = [];

function formatBytes(bytes) {
  if (!bytes) return '0 МБ';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function isImageByName(name) {
  const ext = (name || '').toLowerCase().split('.').pop();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff'].includes(ext);
}

function isVideoByName(name) {
  const ext = (name || '').toLowerCase().split('.').pop();
  return ['mp4', 'mov', 'webm', 'avi', 'ogv', 'ogg', 'flv', 'm4v'].includes(ext);
}

function openLightbox(src, alt) {
  lightboxImg.src = src;
  lightboxImg.alt = alt || 'Просмотр';
  lightbox.classList.remove('hidden');
}

function closeLightbox() {
  lightboxImg.src = '';
  lightbox.classList.add('hidden');
}

lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (event) => {
  if (event.target.classList.contains('lightbox-backdrop')) {
    closeLightbox();
  }
});

function setStatus(message, tone = 'neutral') {
  uploadStatus.textContent = message;
  uploadStatus.dataset.tone = tone;
}

function setAuthError(message) {
  authError.textContent = message || '';
}

function setAccessToken(token) {
  accessToken = token || '';
  if (accessToken) {
    auth.classList.add('hidden');
  } else {
    auth.classList.remove('hidden');
  }
  updateDumpLink();
}

function updateDumpLink() {
  if (accessToken) {
    dumpBtn.href = `/api/dump?t=${encodeURIComponent(accessToken)}`;
  } else {
    dumpBtn.href = '#';
  }
}

function getOtherGroup() {
  return groups.find((g) => g.name === 'Остальное');
}

function getGroupNameById(id) {
  const found = groups.find((g) => g.id === id);
  return found ? found.name : 'Остальное';
}

function renderGroupSelect() {
  if (!groupSelect) return;
  groupSelect.innerHTML = '';
  groups.forEach((group) => {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = `Группа: ${group.name}`;
    groupSelect.appendChild(option);
  });
  const other = getOtherGroup();
  if (other) {
    groupSelect.value = other.id;
  }
}

function renderGroupFilter() {
  if (!groupFilter) return;
  const current = groupFilter.value || 'all';
  groupFilter.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = 'Все группы';
  groupFilter.appendChild(all);
  groups.forEach((group) => {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.name;
    groupFilter.appendChild(option);
  });
  groupFilter.value = groups.find((g) => g.id === current) ? current : 'all';
}

function renderGroupsList() {
  if (!groupsList) return;
  groupsList.innerHTML = '';
  groups.forEach((group) => {
    const row = document.createElement('div');
    row.className = 'group-row';

    const name = document.createElement('div');
    name.className = 'group-name';
    name.textContent = group.name;

    const actions = document.createElement('div');
    actions.className = 'group-actions';

    const rename = document.createElement('button');
    rename.className = 'btn ghost';
    rename.type = 'button';
    rename.textContent = 'Переименовать';
    rename.addEventListener('click', async () => {
      const nextName = prompt('Новое название группы:', group.name);
      if (!nextName || nextName.trim() === group.name) return;
      try {
        const response = await fetch(`/api/groups/${group.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-access-token': accessToken
          },
          body: JSON.stringify({ name: nextName.trim() })
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || 'Ошибка переименования');
        }
        await loadGroups();
        await loadGallery();
      } catch (err) {
        setStatus(err.message || 'Ошибка переименования');
      }
    });

    const remove = document.createElement('button');
    remove.className = 'btn danger';
    remove.type = 'button';
    remove.textContent = 'Удалить';
    remove.disabled = group.name === 'Остальное';
    remove.addEventListener('click', async () => {
      if (group.name === 'Остальное') return;
      if (!confirm(`Удалить группу "${group.name}"? Файлы перейдут в "Остальное".`)) return;
      try {
        const response = await fetch(`/api/groups/${group.id}`, {
          method: 'DELETE',
          headers: { 'x-access-token': accessToken }
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || 'Ошибка удаления');
        }
        await loadGroups();
        await loadGallery();
      } catch (err) {
        setStatus(err.message || 'Ошибка удаления');
      }
    });

    actions.appendChild(rename);
    actions.appendChild(remove);
    row.appendChild(name);
    row.appendChild(actions);
    groupsList.appendChild(row);
  });
}

function logout() {
  sessionStorage.removeItem('mediaAccessToken');
  localStorage.removeItem('mediaAccessTokenHint');
  window.location.href = '/';
}

function addToQueue(files) {
  const incoming = Array.from(files || []);
  if (!incoming.length) return;
  for (let i = incoming.length - 1; i >= 0; i -= 1) {
    queue.unshift(incoming[i]);
  }
  renderQueue();
  setStatus(`В очереди: ${queue.length} файл(ов).`);
}

function removeFromQueue(index) {
  if (index < 0 || index >= queue.length) return;
  queue.splice(index, 1);
  renderQueue();
  setStatus(queue.length ? `В очереди: ${queue.length} файл(ов).` : 'Очередь пуста.');
}

function renderQueue() {
  if (!queueList || !queueCount || !queueClear) return;
  queueList.innerHTML = '';
  const countLabel = queue.length === 1 ? 'файл' : queue.length < 5 ? 'файла' : 'файлов';
  queueCount.textContent = `${queue.length} ${countLabel}`;
  queueClear.disabled = queue.length === 0;
  if (!queue.length) {
    const empty = document.createElement('div');
    empty.className = 'queue-meta';
    empty.textContent = 'Очередь пуста.';
    queueList.appendChild(empty);
    return;
  }

  queue.forEach((file, index) => {
    const row = document.createElement('div');
    row.className = 'queue-item';

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'queue-name';
    name.textContent = file.name;
    name.title = file.name;
    const meta = document.createElement('div');
    meta.className = 'queue-meta';
    meta.textContent = formatBytes(file.size);
    info.appendChild(name);
    info.appendChild(meta);

    const remove = document.createElement('button');
    remove.className = 'btn ghost queue-remove';
    remove.type = 'button';
    remove.textContent = 'Убрать';
    remove.addEventListener('click', () => removeFromQueue(index));

    row.appendChild(info);
    row.appendChild(remove);
    queueList.appendChild(row);
  });
}

fileInput.addEventListener('change', (event) => {
  addToQueue(event.target.files);
  fileInput.value = '';
});

pickBtn.addEventListener('click', () => {
  fileInput.click();
});

queueClear.addEventListener('click', () => {
  if (!queue.length) return;
  queue = [];
  renderQueue();
  setStatus('Очередь пуста.');
});

authBtn.addEventListener('click', async () => {
  const token = authInput.value.trim();
  if (!token) {
    setAuthError('Введите пароль.');
    return;
  }

  setAuthError('');
  authBtn.disabled = true;
  try {
    const response = await fetch('/api/list', {
      headers: { 'x-access-token': token }
    });
    if (!response.ok) {
      throw new Error('Неверный пароль.');
    }
    setAccessToken(token);
    await loadGroups();
    await loadGallery();
  } catch (err) {
    setAccessToken('');
    setAuthError(err.message);
  } finally {
    authBtn.disabled = false;
  }
});

authInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    authBtn.click();
  }
});

pickBtn.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (event) => {
  const files = event.dataTransfer.files;
  addToQueue(files);
});

uploadBtn.addEventListener('click', async () => {
  if (!accessToken) {
    setAuthError('Введите пароль.');
    auth.classList.remove('hidden');
    return;
  }
  if (!queue.length) {
    setStatus('Выберите файлы для загрузки.');
    return;
  }

  const formData = new FormData();
  queue.forEach((file) => formData.append('files', file));
  if (groupSelect && groupSelect.value) {
    formData.append('groupId', groupSelect.value);
  }

  setStatus('Загрузка файлов...');
  uploadBtn.disabled = true;
  pickBtn.setAttribute('aria-disabled', 'true');
  pickBtn.classList.add('disabled');

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'x-access-token': accessToken },
      body: formData
    });

    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        setAccessToken('');
        setAuthError('Введите пароль.');
      }
      throw new Error(result.error || 'Ошибка загрузки');
    }

    const accepted = result.accepted?.length || 0;
    const rejected = result.rejected?.length || 0;
    let message = `Загружено: ${accepted}.`;
    if (rejected) {
      message += ` Отклонено: ${rejected}.`;
    }
    setStatus(message);
    fileInput.value = '';
    queue = [];
    renderQueue();
    await loadGallery();
  } catch (err) {
    setStatus(`Ошибка: ${err.message}`);
  } finally {
    uploadBtn.disabled = false;
    pickBtn.removeAttribute('aria-disabled');
    pickBtn.classList.remove('disabled');
  }
});

refreshBtn.addEventListener('click', () => {
  loadGallery();
});

logoutBtn.addEventListener('click', logout);

if (groupFilter) {
  groupFilter.addEventListener('change', () => {
    renderGallery(itemsCache);
  });
}

if (groupCreate) {
  groupCreate.addEventListener('click', async () => {
    const name = (groupInput.value || '').trim();
    if (!name) {
      setStatus('Введите название группы.');
      return;
    }
    try {
      const response = await fetch('/api/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': accessToken
        },
        body: JSON.stringify({ name })
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Ошибка создания');
      }
      groupInput.value = '';
      await loadGroups();
    } catch (err) {
      setStatus(err.message || 'Ошибка создания');
    }
  });
}

function createCard(item) {
  const card = document.createElement('article');
  card.className = 'card';

  const preview = document.createElement('div');
  preview.className = 'preview';

  const nameSaysImage = isImageByName(item.originalName);
  const nameSaysVideo = isVideoByName(item.originalName);
  const uiType = nameSaysImage ? 'image' : nameSaysVideo ? 'video' : item.type;

  if (uiType === 'image') {
    const img = document.createElement('img');
    img.src = `${item.viewUrl}?t=${encodeURIComponent(accessToken)}`;
    img.alt = item.originalName;
    img.loading = 'lazy';
    img.addEventListener('click', () => {
      openLightbox(img.src, item.originalName);
    });
    preview.appendChild(img);
  } else {
    preview.classList.add('is-video');
    const video = document.createElement('video');
    video.src = `${item.viewUrl}?t=${encodeURIComponent(accessToken)}`;
    video.controls = true;
    video.setAttribute('controls', '');
    video.preload = 'metadata';
    preview.appendChild(video);
  }

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('div');
  title.className = 'card-title';
  const baseName = item.originalName.replace(/\.[^/.]+$/, '');
  const trimmed = baseName.length > 20 ? `${baseName.slice(0, 20)}...` : baseName;
  title.textContent = trimmed;
  title.title = baseName;

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const groupLabel = item.groupName ? ` • ${item.groupName}` : '';
  meta.textContent = `${formatBytes(item.size)} • ${new Date(item.uploadedAt).toLocaleString('ru-RU')}${groupLabel}`;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = uiType === 'image' ? 'Фото' : 'Видео';

  const download = document.createElement('a');
  download.className = 'btn';
  download.textContent = 'Скачать';
  download.href = `${item.downloadUrl}?t=${encodeURIComponent(accessToken)}`;

  const remove = document.createElement('button');
  remove.className = 'btn danger';
  remove.textContent = 'Удалить';
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    if (!confirm('Удалить файл?')) return;
    remove.disabled = true;
    try {
      const response = await fetch(`/api/file/${item.id}`, {
        method: 'DELETE',
        headers: { 'x-access-token': accessToken }
      });
      if (!response.ok) {
        throw new Error('Ошибка удаления');
      }
      await loadGallery();
    } catch (err) {
      setStatus(err.message || 'Ошибка удаления');
    } finally {
      remove.disabled = false;
    }
  });

  actions.appendChild(badge);
  actions.appendChild(download);
  actions.appendChild(remove);

  body.appendChild(title);
  body.appendChild(meta);
  body.appendChild(actions);

  card.appendChild(preview);
  card.appendChild(body);

  return card;
}

async function loadGallery() {
  gallery.innerHTML = '';
  if (!accessToken) return;
  try {
    const response = await fetch('/api/list', {
      headers: { 'x-access-token': accessToken }
    });
    if (response.status === 401) {
      setAccessToken('');
      setAuthError('Введите пароль.');
      return;
    }
    const items = await response.json();
    itemsCache = Array.isArray(items) ? items : [];
    renderGallery(itemsCache);

    const totalSize = itemsCache.reduce((sum, item) => sum + (item.size || 0), 0);
    statCount.textContent = itemsCache.length;
    statSize.textContent = formatBytes(totalSize);
  } catch (err) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Не удалось загрузить список файлов.';
    gallery.appendChild(empty);
  }
}

function renderGallery(items) {
  gallery.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Пока нет загруженных файлов.';
    gallery.appendChild(empty);
    return;
  }

  const filterId = groupFilter ? groupFilter.value : 'all';
  const grouped = new Map();
  items.forEach((item) => {
    const groupId = item.groupId || (getOtherGroup() ? getOtherGroup().id : 'other');
    if (!grouped.has(groupId)) {
      grouped.set(groupId, []);
    }
    grouped.get(groupId).push(item);
  });

  const orderedGroups = groups.length ? groups : [{ id: 'other', name: 'Остальное' }];
  orderedGroups.forEach((group) => {
    if (filterId !== 'all' && filterId !== group.id) return;
    const itemsInGroup = grouped.get(group.id) || [];
    if (!itemsInGroup.length) return;

    const header = document.createElement('div');
    header.className = 'group-title';
    header.textContent = group.name;
    gallery.appendChild(header);

    const block = document.createElement('div');
    block.className = 'group-grid';
    itemsInGroup.forEach((item) => block.appendChild(createCard(item)));
    gallery.appendChild(block);
  });
}

async function loadGroups() {
  if (!accessToken) return;
  try {
    const response = await fetch('/api/groups', {
      headers: { 'x-access-token': accessToken }
    });
    if (!response.ok) {
      throw new Error('Ошибка загрузки групп');
    }
    const data = await response.json();
    groups = Array.isArray(data) ? data : [];
    renderGroupSelect();
    renderGroupFilter();
    renderGroupsList();
    if (itemsCache.length) {
      renderGallery(itemsCache);
    }
  } catch (err) {
    setStatus(err.message || 'Ошибка загрузки групп');
  }
}

renderQueue();
if (!accessToken) {
  window.location.href = '/';
} else {
  setAccessToken(accessToken);
  loadGroups();
  loadGallery();
}
setStatus('Очередь пуста.');
