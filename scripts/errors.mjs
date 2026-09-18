export class CheckError extends Error {
  constructor(code, message) { super(message); this.name = 'CheckError'; this.code = code; }
}

// Protocol errors can contain URLs, credentials or excerpts from the parent task.
// Expose a bounded local error category, never an arbitrary server error string.
export function rpcError(method, error) {
  const message = String(error?.message || '');
  if (/in.progress|inprogress|busy/i.test(message))
    return new CheckError('THREAD_BUSY', '当前任务尚无可供检测的已完成轮次，请在这一轮完成后再检测。');
  if (/not found|no.*thread|unknown thread/i.test(message))
    return new CheckError('THREAD_NOT_FOUND', '此 Codex 运行时无法读取当前任务，请核对客户端及 CODEX_HOME。');
  if (/unauthori|authentic|401|login/i.test(message))
    return new CheckError('AUTH_REQUIRED', '当前 Codex 渠道需要重新登录；检测工具不会收集账号或密钥。');
  return new CheckError('PROTOCOL_ERROR', `Codex 未完成 ${method}（错误码 ${Number(error?.code) || '未知'}），当前版本或配置可能不兼容。`);
}
