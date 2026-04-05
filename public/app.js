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
const auth = document.getElementById('auth');
const authInput = document.getElementById('auth-input');
const authBtn = document.getElementById('auth-btn');
const authError = document.getElementById('auth-error');

let queue = [];
let accessToken = localStorage.getItem('mediaAccessToken') || '';

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
    localStorage.setItem('mediaAccessToken', accessToken);
    auth.classList.add('hidden');
  } else {
    localStorage.removeItem('mediaAccessToken');
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

function setQueue(files) {
  queue = Array.from(files || []);
  if (queue.length) {
    setStatus(`В очереди: ${queue.length} файл(ов).`);
  } else {
    setStatus('Очередь пуста.');
  }
}

fileInput.addEventListener('change', (event) => {
  setQueue(event.target.files);
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
  setQueue(files);
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
    setQueue([]);
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

function createCard(item) {
  const card = document.createElement('article');
  card.className = 'card';

  const preview = document.createElement('div');
  preview.className = 'preview';

  if (item.type === 'image') {
    const img = document.createElement('img');
    img.src = `${item.viewUrl}?t=${encodeURIComponent(accessToken)}`;
    img.alt = item.originalName;
    img.loading = 'lazy';
    preview.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.src = `${item.viewUrl}?t=${encodeURIComponent(accessToken)}`;
    video.controls = true;
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
  meta.textContent = `${formatBytes(item.size)} • ${new Date(item.uploadedAt).toLocaleString('ru-RU')}`;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = item.type === 'image' ? 'Фото' : 'Видео';

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
    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Пока нет загруженных файлов.';
      gallery.appendChild(empty);
    } else {
      items.forEach((item) => gallery.appendChild(createCard(item)));
    }

    const totalSize = Array.isArray(items) ? items.reduce((sum, item) => sum + (item.size || 0), 0) : 0;
    statCount.textContent = Array.isArray(items) ? items.length : 0;
    statSize.textContent = formatBytes(totalSize);
  } catch (err) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Не удалось загрузить список файлов.';
    gallery.appendChild(empty);
  }
}

updateDumpLink();
if (accessToken) {
  loadGallery();
} else {
  auth.classList.remove('hidden');
}
setStatus('Очередь пуста.');
