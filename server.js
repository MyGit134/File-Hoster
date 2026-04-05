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
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'cooluser';

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'self'"],
      'object-src': ["'none'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https:'],
      'font-src': ["'self'", 'https:', 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'media-src': ["'self'", 'blob:'],
      'connect-src': ["'self'"]
    }
  }
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200
}));

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
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

function mimeFromExt(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.avi':
      return 'video/x-msvideo';
    case '.ogv':
    case '.ogg':
      return 'video/ogg';
    case '.flv':
      return 'video/x-flv';
    default:
      return '';
  }
}

function extFromName(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return ext ? ext.slice(1) : '';
}

function extInfoFromName(filename) {
  const mime = mimeFromExt(filename);
  const ext = extFromName(filename);
  return mime && ext ? { mime, ext } : null;
}

async function resolveMimeForItem(item) {
  const full = path.join(UPLOAD_DIR, item.storedName);
  let detected = null;
  try {
    detected = await detectFromFile(full);
  } catch (err) {
    console.error('Detect error (list):', err);
  }

  let mime = detected?.mime || '';
  if (!isAllowedMime(mime)) {
    mime = mimeFromExt(item.storedName) || mimeFromExt(item.originalName) || item.mime || '';
  }
  if (!isAllowedMime(mime)) {
    mime = item.mime || '';
  }

  const type = mime && mime.startsWith('image/') ? 'image' : 'video';
  return { mime, type };
}

function isTokenValid(token) {
  if (!token) return false;
  const left = Buffer.from(String(token));
  const right = Buffer.from(String(ACCESS_PASSWORD));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getToken(req) {
  return req.get('x-access-token') || req.query.t || '';
}

function requireAuth(req, res, next) {
  if (!isTokenValid(getToken(req))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function detectFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // Images
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }

  const head6 = buffer.toString('ascii', 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return { mime: 'image/gif', ext: 'gif' };
  }

  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return { mime: 'image/bmp', ext: 'bmp' };
  }

  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return { mime: 'image/tiff', ext: 'tiff' };
  }

  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }

  // Video
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'AVI ') {
    return { mime: 'video/x-msvideo', ext: 'avi' };
  }

  if (buffer.toString('ascii', 0, 4) === 'OggS') {
    return { mime: 'video/ogg', ext: 'ogv' };
  }

  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { mime: 'video/webm', ext: 'webm' };
  }

  const searchLimit = Math.min(buffer.length - 8, 4096);
  for (let i = 0; i <= searchLimit; i += 1) {
    if (
      buffer[i] === 0x66 &&
      buffer[i + 1] === 0x74 &&
      buffer[i + 2] === 0x79 &&
      buffer[i + 3] === 0x70
    ) {
      const brand = buffer.toString('ascii', i + 4, i + 8);
      if (brand === 'qt  ') {
        return { mime: 'video/quicktime', ext: 'mov' };
      }
      return { mime: 'video/mp4', ext: 'mp4' };
    }
  }

  if (buffer.toString('ascii', 0, 3) === 'FLV') {
    return { mime: 'video/x-flv', ext: 'flv' };
  }

  return null;
}

async function detectFromFile(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4100), 0, 4100, 0);
    return detectFromBuffer(buffer.slice(0, bytesRead));
  } finally {
    await handle.close();
  }
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(req, file, cb) {
    const id = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
    file.__id = id;
    cb(null, `${id}.upload`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_UPLOAD }
});

app.get('/api/list', requireAuth, async (req, res, next) => {
  try {
    const files = meta.files.filter((item) => {
      const full = path.join(UPLOAD_DIR, item.storedName);
      return fs.existsSync(full);
    });

    const resolved = await Promise.all(files.map(async (item) => {
      const resolvedMime = await resolveMimeForItem(item);
      return {
        id: item.id,
        originalName: item.originalName,
        storedName: item.storedName,
        size: item.size,
        mime: resolvedMime.mime || item.mime,
        uploadedAt: item.uploadedAt,
        viewUrl: `/api/file/${item.id}`,
        downloadUrl: `/api/download/${item.id}`,
        type: resolvedMime.type
      };
    }));

    res.json(resolved);
  } catch (err) {
    next(err);
  }
});

app.post('/api/upload', requireAuth, upload.array('files', MAX_FILES_PER_UPLOAD), async (req, res, next) => {
  try {
    const files = req.files || [];
    const accepted = [];
    const rejected = [];

    for (const file of files) {
      const filePath = file.path;
      let detected = null;
      try {
        detected = await detectFromFile(filePath);
      } catch (err) {
        console.error('Detect error:', err);
      }

      if (!detected || !isAllowedMime(detected.mime)) {
        const fallback = extInfoFromName(file.originalname);
        if (fallback && isAllowedMime(fallback.mime)) {
          detected = fallback;
        } else {
          await fsp.unlink(filePath).catch(() => {});
          rejected.push({
            name: file.originalname,
            reason: 'Unsupported file type'
          });
          continue;
        }
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

app.get('/api/file/:id', requireAuth, async (req, res, next) => {
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

  try {
    const resolved = await resolveMimeForItem(item);
    const mime = resolved.mime || item.mime || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${item.originalName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(full);
  } catch (err) {
    next(err);
  }
});

app.get('/api/download/:id', requireAuth, (req, res) => {
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

app.get('/api/dump', requireAuth, (req, res) => {
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

app.delete('/api/file/:id', requireAuth, async (req, res, next) => {
  try {
    const index = meta.files.findIndex((f) => f.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const [item] = meta.files.splice(index, 1);
    const full = path.join(UPLOAD_DIR, item.storedName);
    if (fs.existsSync(full)) {
      await fsp.unlink(full);
    }
    await persistMeta();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`File hoster running on http://localhost:${PORT}`);
});
