enum LogType {
    Log,
    Error,
}

export interface ILogger {
    log(...args: string[]): void;
    error(...args: string[]): void;
    flush(): Promise<void>;
}

export class Logger implements ILogger {
    private logs: Array<{ type: LogType; args: Array<string> }> = [];

    log(...args: string[]) {
        this.logs.push({ type: LogType.Log, args });
    }

    error(...args: string[]) {
        this.logs.push({ type: LogType.Error, args });
    }

    async flush() {
        for (const entry of this.logs) {
            if (entry.type === LogType.Log) {
                console.log(...entry.args);
            } else {
                console.error(...entry.args);
            }
        }
        this.logs = [];
    }
}
