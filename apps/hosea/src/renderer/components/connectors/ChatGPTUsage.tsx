import React, { useEffect, useState } from 'react';
import { useChatGPTStatus } from '../../hooks/useChatGPTStatus.js';

export function ChatGPTUsage({ connector }: { connector: string | null }): React.ReactElement | null {
  const { status } = useChatGPTStatus();
  const [isOpenAI, setIsOpenAI] = useState(false);
  useEffect(() => {
    let mounted = true;
    void window.hosea.connector.list().then(list => {
      if (mounted) setIsOpenAI(list.some(c => c.name === connector && c.vendor === 'openai'));
    }).catch(() => {});
    return () => { mounted = false; };
  }, [connector, status]);
  if (!status?.usePlan || !isOpenAI) return null;
  const account = status.accounts.find(a => a.id === status.activeId);
  return <div className="d-flex flex-wrap align-items-center gap-2 small px-2 pb-2" role="status">
    <span>{account?.connected && account.planEnabled ? 'Using ChatGPT plan' : 'ChatGPT sign-in required'}{account?.email ? ` · ${account.email}` : ''}</span>
    <button className="btn btn-link btn-sm p-0" onClick={() => void window.hosea.chatGPT.manageUsage()}>Manage usage</button>
  </div>;
}
