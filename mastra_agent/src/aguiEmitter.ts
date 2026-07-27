export type AGUIEvent = Record<string, unknown>;

export type EmitFn = (event: AGUIEvent) => Promise<void>;

export class AGUIEmitter {
  private runId: string;
  private threadId: string;
  private emit: EmitFn;
  // A well-formed stream with no text and no tool call renders as a silent
  // blank bubble — same bug class as the Node reason-loop and langchain_agent
  // empty-answer guards.
  private anyVisibleOutput = false;

  constructor(runId: string, threadId: string, emit: EmitFn) {
    this.runId = runId;
    this.threadId = threadId;
    this.emit = emit;
  }

  async onRunStart(): Promise<void> {
    await this.emit({ type: 'RUN_STARTED', runId: this.runId, threadId: this.threadId });
  }

  async onRunEnd(): Promise<void> {
    if (!this.anyVisibleOutput) {
      await this.onError(new Error(
        "The model didn't return a usable response. Try rephrasing your request or sending it again."
      ));
      return;
    }
    await this.emit({ type: 'RUN_FINISHED', runId: this.runId, threadId: this.threadId });
  }

  async onLlmStart(): Promise<void> {
    await this.emit({ type: 'TEXT_MESSAGE_START', runId: this.runId, threadId: this.threadId, messageId: this.runId, role: 'assistant' });
  }

  async onLlmToken(delta: string): Promise<void> {
    if (delta) this.anyVisibleOutput = true;
    await this.emit({ type: 'TEXT_MESSAGE_CONTENT', runId: this.runId, threadId: this.threadId, messageId: this.runId, delta });
  }

  async onLlmEnd(): Promise<void> {
    await this.emit({ type: 'TEXT_MESSAGE_END', runId: this.runId, threadId: this.threadId, messageId: this.runId });
  }

  async onToolStart(toolCallId: string, toolName: string, args: unknown): Promise<void> {
    this.anyVisibleOutput = true;
    await this.emit({ type: 'TOOL_CALL_START', runId: this.runId, threadId: this.threadId, toolCallId, toolName, args });
  }

  async onToolEnd(toolCallId: string, result: unknown): Promise<void> {
    await this.emit({ type: 'TOOL_CALL_END', runId: this.runId, threadId: this.threadId, toolCallId, result });
  }

  async onError(err: Error): Promise<void> {
    // Every failure path (mid-stream provider error, a thrown exception, and
    // the empty-output guard in onRunEnd) funnels through here — logging once
    // at this choke point means a run that fails leaves a trace in `docker
    // logs` instead of only a RUN_ERROR event the client may not have kept.
    console.error(`[mastra] run ${this.runId} failed:`, err.message);
    await this.emit({ type: 'RUN_ERROR', runId: this.runId, threadId: this.threadId, message: err.message });
  }
}
