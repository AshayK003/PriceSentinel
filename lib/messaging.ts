export interface Message {
  type: string;
  [key: string]: unknown;
}

export type MessageHandler = (msg: Message, sender: chrome.runtime.MessageSender) => Promise<unknown> | void;

/**
 * Register a message handler for the given message type.
 * Thin wrapper over chrome.runtime.onMessage, no framework.
 */
export function onMessage(type: string, handler: MessageHandler): void {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== type) return;
    const result = handler(msg, sender);
    if (result instanceof Promise) {
      result.then((res) => sendResponse(res)).catch(() => sendResponse({ ok: false }));
      return true; // keep channel open
    }
    sendResponse(result);
  });
}

/**
 * Send a message to the service worker.
 */
export function sendMessage(msg: Message): Promise<unknown> {
  return chrome.runtime.sendMessage(msg);
}
