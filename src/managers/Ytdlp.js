const { spawn } = require('node:child_process');
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

function parseNumber(value) {
    const number = Number(value);
    return value === 'NA' || !Number.isFinite(number) ? null : number;
}

function parseProgress(line) {
    if (!line.startsWith('PROGRESS ')) return null;
    const [, downloadedRaw, totalRaw, estimateRaw] = line.split(/\s+/);
    const downloaded = parseNumber(downloadedRaw) ?? 0;
    const total = parseNumber(totalRaw) ?? parseNumber(estimateRaw);
    return {
        stage: 'downloading',
        downloaded,
        total,
        percent: total ? Math.min(100, (downloaded / total) * 100) : null,
    };
}

function download(id, videoUrl, emit) {
    const args = [
        '-f', 'bestaudio[ext=webm]/bestaudio',
        '--no-playlist', '--no-warnings',
        '--quiet', '--progress', '--newline',
        '--progress-template', 'download:PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
        '--max-filesize', MAX_FILESIZE,
        '--js-runtimes', JS_RUNTIME,
        '-o', path.join(CACHE_DIR, '%(id)s.%(ext)s'),
    ];
    if (COOKIES) args.push('--cookies', COOKIES);
    args.push('--', videoUrl);

    return new Promise((resolve, reject) => {
        const child = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdoutBuffer = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, TIMEOUT_MS);

        child.stdout.on('data', chunk => {
            stdoutBuffer += chunk;
            let newline;
            while ((newline = stdoutBuffer.indexOf('\n')) >= 0) {
                const progress = parseProgress(stdoutBuffer.slice(0, newline).trim());
                stdoutBuffer = stdoutBuffer.slice(newline + 1);
                if (progress) emit(progress);
            }
        });

        child.stderr.on('data', chunk => {
            stderr = (stderr + chunk).slice(-20000);
        });

        child.on('error', error => {
            clearTimeout(timer);
            if (error.code === 'ENOENT') {
                missing = true;
                console.warn(`[yt-dlp] Binary "${BIN}" not found, YouTube playback stays on the plugin. Set YTDLP_PATH or install yt-dlp.`);
                return reject(new Error('yt-dlp not installed'));
            }
            reject(error);
        });

        child.on('close', code => {
            clearTimeout(timer);
            if (timedOut) return reject(new Error('yt-dlp timed out'));
            if (code !== 0) return reject(new Error(stderr.trim().split('\n').pop() || `yt-dlp exited with code ${code}`));
            const file = findCached(id);
            if (!file) return reject(new Error('yt-dlp finished but no audio file was found'));
            resolve(file);
        });
    });
}

async function getAudioFile(videoUri, identifier, onProgress) {
    if (DISABLED || missing) return null;

    const id = /^[\w-]{11}$/.test(identifier || '') ? identifier : videoIdFrom(videoUri);
    if (!id) throw new Error('could not determine the video id');

    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o755 });

    const cached = findCached(id);
    if (cached) {
        const now = new Date();
        fs.utimesSync(cached, now, now);
        if (onProgress) {
            const size = fs.statSync(cached).size;
            onProgress({ stage: 'done', downloaded: size, total: size, percent: 100 });
        }
        return cached;
    }

    const existing = inflight.get(id);
    if (existing) {
        if (onProgress) {
            existing.listeners.add(onProgress);
            if (existing.last) onProgress(existing.last);
        }
        return existing.promise;
    }

    const entry = { listeners: new Set(onProgress ? [onProgress] : []), last: null, promise: null };
    const emit = progress => {
        entry.last = progress;
        for (const listener of entry.listeners) {
            try {
                listener(progress);
            } catch {}
        }
    };

    entry.promise = (async () => {
        await acquire();
        try {
            emit({ stage: 'preparing' });
            const file = await download(id, videoUri, emit);
            const size = fs.statSync(file).size;
            emit({ stage: 'done', downloaded: size, total: size, percent: 100 });
            return file;
        } finally {
            release();
            inflight.delete(id);
        }
    })();
    inflight.set(id, entry);
    return entry.promise;
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