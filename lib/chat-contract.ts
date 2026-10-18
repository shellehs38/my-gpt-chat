/** Public limits used by both the browser and the server. No credentials belong here. */
export const MAX_MESSAGE_LENGTH = 10_000;
export const MAX_HISTORY_MESSAGES = 16;
export const MAX_HISTORY_MESSAGE_LENGTH = 20_000;
export const MAX_HISTORY_BYTES = 160 * 1024;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_REPLY_LENGTH = 100_000;

export type ChatMode = "general" | "estimate" | "engineering" | "facade" | "business" | "documents";
export type FacadeOptions = "auto" | "without" | "with" | "both";
export type ChatHistoryMessage = { role: "user" | "assistant"; content: string };
export type ChatRequest = {
  message: string;
  mode: ChatMode;
  history?: ChatHistoryMessage[];
  facadeOptions?: FacadeOptions;
};
