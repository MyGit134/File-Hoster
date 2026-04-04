const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const META_PATH = path.join(UPLOAD_DIR, 'meta.json');
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const MAX_FILES_PER_UPLOAD = 20;

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' }
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200
}));

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

let meta = { files: [] };
if (fs.existsSync(META_PATH)) {
  try {
    const raw = fs.readFileSync(META_PATH, 'utf8');
    meta = JSON.parse(raw);
    if (!meta || !Array.isArray(meta.files)) {
      meta = { files: [] };
    }
  } catch {
    meta = { files: [] };
  }
}

function persistMeta() {
  return fsp.writeFile(META_PATH, JSON.stringify(meta, null, 2));
}

function safeName(input) {
  const base = path.basename(input || 'file');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length ? cleaned : 'file';
}

function isAllowedMime(mime) {
  return mime && (mime.startsWith('image/') || mime.startsWith('video/'));
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    const id = crypto.randomUUID();
    file.__id = id;
    cb(null, `${id}.upload`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_UPLOAD }
});

app.get('/api/list', (req, res) => {
  const files = meta.files.filter((item) => {
    const full = path.join(UPLOAD_DIR, item.storedName);
    return fs.existsSync(full);
  });
  res.json(files.map((item) => ({
    id: item.id,
    originalName: item.originalName,
    storedName: item.storedName,
    size: item.size,
    mime: item.mime,
    uploadedAt: item.uploadedAt,
    viewUrl: `/api/file/${item.id}`,
    downloadUrl: `/api/download/${item.id}`,
    type: item.mime.startsWith('image/') ? 'image' : 'video'
  })));
});

app.post('/api/upload', upload.array('files', MAX_FILES_PER_UPLOAD), async (req, res, next) => {
  try {
    const { fileTypeFromFile } = await import('file-type');
    const files = req.files || [];
    const accepted = [];
    const rejected = [];

    for (const file of files) {
      const filePath = file.path;
      let detected;
      try {
        detected = await fileTypeFromFile(filePath);
      } catch {
        detected = null;
      }

      if (!detected || !isAllowedMime(detected.mime)) {
        await fsp.unlink(filePath).catch(() => {});
        rejected.push({
          name: file.originalname,
          reason: 'Unsupported file type'
        });
        continue;
      }

      const finalName = `${file.__id}.${detected.ext}`;
      const finalPath = path.join(UPLOAD_DIR, finalName);
      await fsp.rename(filePath, finalPath);

      const item = {
        id: file.__id,
        originalName: safeName(file.originalname),
        storedName: finalName,
        size: file.size,
        mime: detected.mime,
        uploadedAt: new Date().toISOString()
      };

      meta.files.push(item);
      accepted.push({
        id: item.id,
        originalName: item.originalName,
        size: item.size,
        mime: item.mime,
        uploadedAt: item.uploadedAt,
        viewUrl: `/api/file/${item.id}`,
        downloadUrl: `/api/download/${item.id}`,
        type: item.mime.startsWith('image/') ? 'image' : 'video'
      });
    }

    if (accepted.length) {
      await persistMeta();
    }

    res.json({
      accepted,
      rejected
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/file/:id', (req, res) => {
  const item = meta.files.find((f) => f.id === req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const full = path.join(UPLOAD_DIR, item.storedName);
  if (!fs.existsSync(full)) {
    res.status(404).json({ error: 'Missing file' });
    return;
  }

  res.setHeader('Content-Type', item.mime);
  res.setHeader('Content-Disposition', `inline; filename="${item.originalName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(full);
});

app.get('/api/download/:id', (req, res) => {
  const item = meta.files.find((f) => f.id === req.params.id);
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const full = path.join(UPLOAD_DIR, item.storedName);
  if (!fs.existsSync(full)) {
    res.status(404).json({ error: 'Missing file' });
    return;
  }

  res.download(full, item.originalName);
});

app.get('/api/dump', (req, res) => {
  const files = meta.files.filter((item) => fs.existsSync(path.join(UPLOAD_DIR, item.storedName)));
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="media-dump.zip"');

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    res.status(500).json({ error: 'Archive error' });
    console.error(err);
  });

  archive.pipe(res);

  for (const item of files) {
    const full = path.join(UPLOAD_DIR, item.storedName);
    const name = `${item.id}_${safeName(item.originalName)}`;
    archive.file(full, { name });
  }

  archive.finalize();
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'File too large' });
    return;
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') {
    res.status(400).json({ error: 'Too many files in one upload' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`File hoster running on http://localhost:${PORT}`);
});
