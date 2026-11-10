/** IPC-safe account state. Credentials never cross this boundary. */
export interface ChatGPTAccount {
  id: string;
  label: string;
  email?: string;
  connected: boolean;
  planEnabled: boolean;
}
export interface ChatGPTStatus {
  accounts: ChatGPTAccount[];
  activeId: string | null;
  usePlan: boolean;
  signingIn: boolean;
  available: boolean;
  message?: string;
}
export interface ChatGPTResult {
  success: boolean;
  status?: ChatGPTStatus;
  error?: string;
  warning?: string;
}
