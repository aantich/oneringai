import React from 'react';
import { ArrowUp, Brain, Bot, Wrench, LockKeyhole, PenLine, Lightbulb, Code2 } from 'lucide-react';
import { HoseaMark } from './Brand';
import { ActionCard } from './Primitives';
import { useNavigation } from '../hooks/useNavigation';

export function Welcome({ agentName, onPrompt }: { agentName?: string; onPrompt?: (text: string) => void }): React.ReactElement {
  const { navigate } = useNavigation();
  return <div className="h-welcome">
    <div className="h-welcome__eyebrow"><HoseaMark size={30} /><span>A space for possibility</span></div>
    <h1>Where should we begin?</h1>
    <p className="h-welcome__subtitle">{agentName ? `You’re working with ${agentName}. Bring a question, a project, or the beginning of an idea.` : 'A quiet place to think, create, and get things done. Connect your favorite models and make it your own.'}</p>
    {!agentName && <button type="button" className="h-welcome__start" onClick={() => navigate('llm-connectors')}>
      <span>Connect a model to start a conversation</span><span className="h-welcome__start-icon"><ArrowUp size={17} /></span>
    </button>}
    <div className="h-action-grid">
      {agentName && onPrompt ? <>
        <ActionCard icon={<PenLine size={19} />} title="Make something" description="Find the words. Shape an idea." onClick={() => onPrompt('Help me turn an idea into a clear first draft.')} />
        <ActionCard icon={<Lightbulb size={19} />} title="Think it through" description="Untangle a question together." onClick={() => onPrompt('Help me think through a decision. Ask me about the context first.')} />
        <ActionCard icon={<Code2 size={19} />} title="Build a little further" description="A fresh perspective on a project." onClick={() => onPrompt('Help me plan the next step in my project. Ask me what I am building.')} />
      </> : <>
        <ActionCard icon={<Brain size={19} />} title="Bring your models" description="Cloud providers or local AI." onClick={() => navigate('llm-connectors')} />
        <ActionCard icon={<Bot size={19} />} title="Meet your agents" description="Give your assistant a purpose." onClick={() => navigate('agents')} />
        <ActionCard icon={<Wrench size={19} />} title="Connect your tools" description="Let your workspace do more." onClick={() => navigate('tool-catalog')} />
      </>}
    </div>
    <p className="h-welcome__footnote"><LockKeyhole size={11} />Local workspace. Your keys. Open source.</p>
  </div>;
}
