import { useEffect, useState } from 'react';
import type { ChatGPTStatus } from '../../shared/chatgpt.js';

export function useChatGPTStatus() {
  const [status, setStatus] = useState<ChatGPTStatus>();
  useEffect(() => {
    let mounted = true;
    void window.hosea.chatGPT.status().then(value => { if (mounted) setStatus(value); }).catch(() => {});
    const remove = window.hosea.chatGPT.onChanged(value => { if (mounted) setStatus(value); });
    return () => { mounted = false; remove(); };
  }, []);
  return { status, setStatus };
}
