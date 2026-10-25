const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const BIN = process.env.YTDLP_PATH || 'yt-dlp';
const COOKIES = process.env.YTDLP_COOKIES;
const JS_RUNTIME = process.env.YTDLP_JS_RUNTIME || `node:${process.execPath}`;
const DISABLED = process.env.YTDLP_DISABLED === 'true';
const CACHE_DIR = process.env.YTDLP_CACHE_DIR || path.join(os.tmpdir(), 'reze-audio');
const MAX_FILESIZE = process.env.YTDLP_MAX_FILESIZE || '200M';
const TIMEOUT_MS = (Number(process.env.YTDLP_TIMEOUT_SECONDS) || 600) * 1000;
const MAX_AGE_MS = (Number(process.env.YTDLP_CACHE_HOURS) || 12) * 60 * 60 * 1000;
const MAX_PARALLEL = 2;

const inflight = new Map();
const waiting = [];
let running = 0;
let missing = false;

function acquire() {
    return new Promise(resolve => {
        if (running < MAX_PARALLEL) {
            running++;
            resolve();
        } else {
            waiting.push(resolve);
        }
    });
}

function release() {
    const next = waiting.shift();
    if (next) next();
    else running--;
}

function videoIdFrom(uri) {
    try {
        const url = new URL(uri);
        if (url.hostname === 'youtu.be') return url.pathname.slice(1);
        return url.searchParams.get('v');
    } catch {
        return null;
    }
}

function findCached(id) {
    if (!fs.existsSync(CACHE_DIR)) return null;
    const name = fs.readdirSync(CACHE_DIR).find(file => file.startsWith(`${id}.`) && !/\.(part|ytdl|temp)$/.test(file));
    if (!name) return null;
    const file = path.join(CACHE_DIR, name);
    if (fs.statSync(file).size === 0) return null;
    return file;
}

function download(id, videoUrl) {
    const args = [
        '-f', 'bestaudio[ext=webm]/bestaudio',
        '--no-playlist', '--no-warnings', '--no-progress',
        '--max-filesize', MAX_FILESIZE,
        '--js-runtimes', JS_RUNTIME,
        '-o', path.join(CACHE_DIR, '%(id)s.%(ext)s'),
    ];
    if (COOKIES) args.push('--cookies', COOKIES);
    args.push('--', videoUrl);

    return new Promise((resolve, reject) => {
        execFile(BIN, args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    missing = true;
                    console.warn(`[yt-dlp] Binary "${BIN}" not found, YouTube playback stays on the plugin. Set YTDLP_PATH or install yt-dlp.`);
                    return reject(new Error('yt-dlp not installed'));
                }
                const lastLine = String(stderr || error.message).trim().split('\n').pop();
                return reject(new Error(error.killed ? 'yt-dlp timed out' : lastLine));
            }
            const file = findCached(id);
            if (!file) return reject(new Error('yt-dlp finished but no audio file was found'));
            resolve(file);
        });
    });
}

async function getAudioFile(videoUri, identifier) {
    if (DISABLED || missing) return null;

    const id = /^[\w-]{11}$/.test(identifier || '') ? identifier : videoIdFrom(videoUri);
    if (!id) throw new Error('could not determine the video id');

    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o755 });

    const cached = findCached(id);
    if (cached) {
        const now = new Date();
        fs.utimesSync(cached, now, now);
        return cached;
    }
    if (inflight.has(id)) return inflight.get(id);

    const promise = (async () => {
        await acquire();
        try {
            return await download(id, videoUri);
        } finally {
            release();
            inflight.delete(id);
        }
    })();
    inflight.set(id, promise);
    return promise;
}

function prefetch(videoUri, identifier) {
    getAudioFile(videoUri, identifier).catch(() => {});
}

function cleanup() {
    if (!fs.existsSync(CACHE_DIR)) return;
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const name of fs.readdirSync(CACHE_DIR)) {
        const file = path.join(CACHE_DIR, name);
        try {
            if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
        } catch {}
    }
}

cleanup();
setInterval(cleanup, 30 * 60 * 1000).unref();

module.exports = { getAudioFile, prefetch, cleanup };