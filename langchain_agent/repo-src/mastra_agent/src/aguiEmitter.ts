export type AGUIEvent = Record<string, unknown>;

export type EmitFn = (event: AGUIEvent) => Promise<void>;

export class AGUIEmitter {
  private runId: string;
  private threadId: string;
  private emit: EmitFn;

  constructor(runId: string, threadId: string, emit: EmitFn) {
    this.runId = runId;
    this.threadId = threadId;
    this.emit = emit;
  }

  async onRunStart(): Promise<void> {
    await this.emit({ type: 'RUN_STARTED', runId: this.runId, threadId: this.threadId });
  }

  async onRunEnd(): Promise<void> {
    await this.emit({ type: 'RUN_FINISHED', runId: this.runId, threadId: this.threadId });
  }

  async onLlmStart(): Promise<void> {
    await this.emit({ type: 'TEXT_MESSAGE_START', runId: this.runId, threadId: this.threadId, messageId: this.runId, role: 'assistant' });
  }

  async onLlmToken(delta: string): Promise<void> {
    await this.emit({ type: 'TEXT_MESSAGE_CONTENT', runId: this.runId, threadId: this.threadId, messageId: this.runId, delta });
  }

  async onLlmEnd(): Promise<void> {
    await this.emit({ type: 'TEXT_MESSAGE_END', runId: this.runId, threadId: this.threadId, messageId: this.runId });
  }

  async onToolStart(toolCallId: string, toolName: string, args: unknown): Promise<void> {
    await this.emit({ type: 'TOOL_CALL_START', runId: this.runId, threadId: this.threadId, toolCallId, toolName, args });
  }

  async onToolEnd(toolCallId: string, result: unknown): Promise<void> {
    await this.emit({ type: 'TOOL_CALL_END', runId: this.runId, threadId: this.threadId, toolCallId, result });
  }

  async onError(err: Error): Promise<void> {
    await this.emit({ type: 'RUN_ERROR', runId: this.runId, threadId: this.threadId, message: err.message });
  }
}
