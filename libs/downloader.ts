import * as fs from "node:fs";
import * as cliProgress from "cli-progress";
import chalk from "chalk";

interface ProgressPayload {
  title: string;
  speed: string;
  completed: number;
  totalTasks: number;
  finishedPercent: number;
  calcEta: number;
}

interface ExtraData {
  totalSize?: number;
}

export interface DownloadTask {
    url: string;
    filename: string;
    retries?: number;
    extra?: unknown;
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else {
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
}

export class DownloadQueue {
    private maxParallel: number;
    private queue: DownloadTask[];
    private activeDownloads: Map<string, number>;
    private progressBar: cliProgress.SingleBar;
    private totalTasks: number = 0;
    private completedTasks: number = 0;
    private speedUpdateInterval: ReturnType<typeof setInterval>;
    public extra?: ExtraData;
    private downloadedSize = 0;
    public defaultRetries = 20;
    /** Sliding-window speed samples (time, cumulative bytes). Pruned to last 5s. */
    private speedSamples: { time: number; bytes: number }[] = [];
    private static readonly SPEED_WINDOW_MS = 5000;

    constructor(maxParallel: number, extra?: ExtraData) {
        this.extra = extra;
        this.maxParallel = maxParallel;
        this.queue = [];
        this.activeDownloads = new Map();
        this.speedSamples.push({ time: Date.now(), bytes: 0 });
        this.progressBar = new cliProgress.SingleBar({
            format(options: cliProgress.Options, _params: cliProgress.Params, payload: ProgressPayload) {
                const bar = options.barCompleteChar!.repeat(payload.finishedPercent * 20)
                    + options.barIncompleteChar!.repeat((1 - payload.finishedPercent) * 20);
                return `${payload.title} | ${bar} | ${(payload.finishedPercent * 100).toFixed(1)}% | ${payload.completed}/${payload.totalTasks} | ${payload.speed}`
                    + (extra?.totalSize ? ` | tot:${formatSize(extra?.totalSize)} | eta:${payload.calcEta.toFixed(1)}s` : '');
            },
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
        });

        this.speedUpdateInterval = setInterval(() => this.updateProgress(), 100);
    }

    public addTask(task: DownloadTask): void {
        this.queue.push(task);
        this.totalTasks++;
        if (!this.progressBar.isActive) {
            this.progressBar.start(this.totalTasks, 0, {
                title: 'Waiting...',
                speed: '0.00 B/s',
                completed: 0,
                totalTasks: this.totalTasks,
                finishedPercent: 0,
                calcEta: Infinity,
            });
        }
        this.processQueue();
    }

    private processQueue(): void {
        while (this.activeDownloads.size < this.maxParallel && this.queue.length > 0) {
            const task = this.queue.shift()!;
            this.activeDownloads.set(task.filename, 0);
            this.downloadFile(task);
        }
    }

    private formatSpeed(bytesPerSecond: number): string {
        const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        let speed = bytesPerSecond;
        let unitIndex = 0;
        while (speed >= 1024 && unitIndex < units.length - 1) {
            speed /= 1024;
            unitIndex++;
        }
        return `${speed.toFixed(2)} ${units[unitIndex]}`;
    }

    /** Rolling 5-second window: (newest_bytes - oldest_bytes) / window_seconds */
    private calcSpeed(): number {
        const now = Date.now();
        const cutoff = now - DownloadQueue.SPEED_WINDOW_MS;
        // Prune samples outside the window
        this.speedSamples = this.speedSamples.filter(s => s.time >= cutoff);
        this.speedSamples.push({ time: now, bytes: this.downloadedSize });
        if (this.speedSamples.length < 2) return 0;
        const newest = this.speedSamples[this.speedSamples.length - 1];
        const oldest = this.speedSamples[0];
        const elapsedSec = (newest.time - oldest.time) / 1000;
        return elapsedSec > 0 ? (newest.bytes - oldest.bytes) / elapsedSec : 0;
    }

    private updateProgress(finished: boolean = false): void {
        const currentFiles = Array.from(this.activeDownloads.keys());
        const speed = this.calcSpeed();
        this.progressBar.update(this.completedTasks, {
            title: finished ? (chalk.green("Done")) : (currentFiles.length > 0
                ? `Downloading: (${currentFiles.length} active)`
                : 'Preparing...'),
            speed: this.formatSpeed(speed),
            completed: this.completedTasks,
            totalTasks: this.totalTasks,
            finishedPercent: this.extra?.totalSize
                ? (this.downloadedSize / this.extra.totalSize)
                : (this.completedTasks / this.totalTasks),
            calcEta: this.extra?.totalSize && speed > 0
                ? (this.extra.totalSize - this.downloadedSize) / speed
                : 0,
        });
    }

    private async downloadFile(task: DownloadTask): Promise<void> {
        let downloadedThisAttempt = 0;
        try {
            const response = await fetch(task.url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const writer = fs.createWriteStream(task.filename);
            writer.on("error", (err) => { throw err; });
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No readable stream');

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                writer.write(value);
                downloadedThisAttempt += value.length;
                this.downloadedSize += value.length;
            }

            writer.end();
            this.completedTasks++;
        } catch (error) {
            // Retracting partial bytes from the failed attempt so retries don't double-count
            this.downloadedSize -= downloadedThisAttempt;

            if ((task.retries || this.defaultRetries) > 0) {
                console.error(`♻️❌ ${task.filename}(retrying): ${(error as Error).message}`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                this.queue.push({ ...task, retries: (task.retries || this.defaultRetries) - 1 });
            } else {
                console.error(`❌⚙️ ${task.filename}(FAILED!): ${(error as Error).message}`);
                throw error;
            }
        } finally {
            this.activeDownloads.delete(task.filename);
            this.processQueue();
        }
    }

    public async wait(): Promise<void> {
        while (this.activeDownloads.size > 0 || this.queue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        this.updateProgress(true);
        clearInterval(this.speedUpdateInterval);
        this.progressBar.stop();
    }
}
