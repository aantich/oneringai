import React, { useState, useRef, useEffect } from 'react';
import { Form, Button, Spinner } from 'react-bootstrap';
import { Message } from './Message';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ChatProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSend: (content: string) => void;
  onCancel: () => void;
}

export function Chat({
  messages,
  isLoading,
  onSend,
  onCancel,
}: ChatProps): React.ReactElement {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSend(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-container d-flex flex-column h-100">
      {/* Messages */}
      <div className="messages-container flex-grow-1 overflow-auto p-4">
        {messages.length === 0 ? (
          <div className="text-center text-muted mt-5">
            <h4>Welcome to hosea</h4>
            <p>Start a conversation with your AI agent.</p>
          </div>
        ) : (
          messages.map((message) => (
            <Message key={message.id} message={message} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="input-container border-top p-3 bg-light">
        <Form onSubmit={handleSubmit}>
          <div className="d-flex gap-2">
            <Form.Control
              as="textarea"
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message... (Shift+Enter for new line)"
              disabled={isLoading}
              rows={1}
              className="flex-grow-1"
              style={{ resize: 'none', maxHeight: 200 }}
            />
            {isLoading ? (
              <Button variant="danger" onClick={onCancel} style={{ minWidth: 80 }}>
                <Spinner animation="border" size="sm" className="me-1" />
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                type="submit"
                disabled={!input.trim()}
                style={{ minWidth: 80 }}
              >
                Send
              </Button>
            )}
          </div>
        </Form>
      </div>
    </div>
  );
}
