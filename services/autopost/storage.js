// Stockage des médias auto-post.
// Production : bucket S3-compatible (Cloudflare R2 conseillé), partagé entre le site et le worker.
// Dev / tout-en-un : dossier local (AUTOPOST_LOCAL_DIR), seulement si le worker tourne sur la même machine.
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const S3_BUCKET = process.env.AUTOPOST_S3_BUCKET;
const LOCAL_DIR = process.env.AUTOPOST_LOCAL_DIR || path.join(__dirname, '..', '..', 'data', 'autopost');

let _s3 = null;
function s3() {
  if (_s3) return _s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  _s3 = new S3Client({
    region: process.env.AUTOPOST_S3_REGION || 'auto',
    endpoint: process.env.AUTOPOST_S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.AUTOPOST_S3_KEY,
      secretAccessKey: process.env.AUTOPOST_S3_SECRET,
    },
    forcePathStyle: !!process.env.AUTOPOST_S3_ENDPOINT,
  });
  return _s3;
}

function isRemote() { return !!S3_BUCKET; }

function safeKey(key) {
  const k = String(key).replace(/\\/g, '/');
  if (k.includes('..') || k.startsWith('/')) throw new Error('Clé de stockage invalide');
  return k;
}

function localPath(key) {
  const p = path.join(LOCAL_DIR, safeKey(key));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

async function presignPut(key, mime) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: S3_BUCKET, Key: safeKey(key), ContentType: mime }), { expiresIn: 3600 });
}

async function presignGet(key, seconds = 3600) {
  if (!isRemote()) return null;
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: S3_BUCKET, Key: safeKey(key) }), { expiresIn: seconds });
}

// Écrit un flux (upload navigateur en mode local) ou un buffer/fichier
async function putStream(key, readable) {
  if (isRemote()) {
    const { Upload } = (() => { try { return require('@aws-sdk/lib-storage'); } catch (e) { return {}; } })();
    if (Upload) {
      await new Upload({ client: s3(), params: { Bucket: S3_BUCKET, Key: safeKey(key), Body: readable } }).done();
      return;
    }
    const chunks = [];
    for await (const c of readable) chunks.push(c);
    return putBuffer(key, Buffer.concat(chunks));
  }
  await pipeline(readable, fs.createWriteStream(localPath(key)));
}

async function putBuffer(key, buffer, mime) {
  if (isRemote()) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3().send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: safeKey(key), Body: buffer, ContentType: mime }));
    return;
  }
  fs.writeFileSync(localPath(key), buffer);
}

async function getToFile(key, dest) {
  if (isRemote()) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const r = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: safeKey(key) }));
    await pipeline(r.Body, fs.createWriteStream(dest));
    return dest;
  }
  fs.copyFileSync(localPath(key), dest);
  return dest;
}

async function readStream(key) {
  if (isRemote()) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const r = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: safeKey(key) }));
    return { stream: r.Body, size: r.ContentLength, type: r.ContentType };
  }
  const p = localPath(key);
  if (!fs.existsSync(p)) return null;
  return { stream: fs.createReadStream(p), size: fs.statSync(p).size };
}

async function remove(key) {
  try {
    if (isRemote()) {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      await s3().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: safeKey(key) }));
    } else {
      fs.unlinkSync(localPath(key));
    }
  } catch (e) { /* déjà supprimé */ }
}

module.exports = { isRemote, presignPut, presignGet, putStream, putBuffer, getToFile, readStream, remove, LOCAL_DIR };
