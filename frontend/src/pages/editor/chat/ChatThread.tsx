import { CornerUpLeft, Download, Link2, Paperclip, Pin, PinOff, Send, X } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ChatAttachment, ChatMessage, ChatThread } from './ChatTypes';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB

interface Peer {
  id: string;
  /** Display name */
  name: string;
  /** Username handle (may be undefined if user hasn't set one yet) */
  username?: string;
  color: string;
}

/** The string used in @mention tokens for a peer — username if set, else display name */
const mentionHandle = (p: Peer) => p.username ?? p.name;

interface ChatThreadViewProps {
  threadId: string;
  messages: ChatMessage[];
  peers: Peer[];
  threads: ChatThread[];
  myId: string;
  /** True when viewing the pinboard — hides the input bar */
  isPinboard: boolean;
  resolveMessage: (id: string) => Promise<ChatMessage | undefined>;
  onSend: (body: string, attachments: ChatAttachment[], mentionedUserIds: string[]) => void;
  onSwitchThread: (threadId: string) => void;
  onJumpToMessage: (msgId: string) => void;
  onPin: (message: ChatMessage) => void;
  onUnpin: (originalMessageId: string) => void;
  scrollToMessageId: string | null;
  onScrollConsumed: () => void;
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
const Lightbox: React.FC<{ src: string; name: string; onClose: () => void }> = ({ src, name, onClose }) => (
  <div
    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3"
      onClick={e => e.stopPropagation()}
    >
      <img
        src={src}
        alt={name}
        className="max-w-[90vw] max-h-[80vh] rounded-xl shadow-2xl object-contain"
      />
      <div className="flex items-center gap-2">
        <a
          href={src}
          download={name}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-semibold transition-colors border border-white/20"
          onClick={e => e.stopPropagation()}
        >
          <Download size={15} />
          Download
        </a>
        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors border border-white/20"
          title="Close"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  </div>
);

// ─── Inline message preview (for !<id> tokens) ────────────────────────────────
const MessagePreviewInline: React.FC<{
  messageId: string;
  isMine: boolean;
  threads: ChatThread[];
  resolveMessage: (id: string) => Promise<ChatMessage | undefined>;
  onJumpToMessage: (msgId: string) => void;
}> = ({ messageId, isMine, threads, resolveMessage, onJumpToMessage }) => {
  // undefined = still loading, null = not found
  const [msg, setMsg] = useState<ChatMessage | undefined | null>(undefined);

  useEffect(() => {
    resolveMessage(messageId).then(m => setMsg(m ?? null));
  }, [messageId, resolveMessage]);

  if (msg === undefined) return null;

  if (msg === null) {
    return (
      <span className={`font-semibold ${isMine ? 'text-white/70' : 'text-slate-500 dark:text-neutral-500'}`}>
        !{messageId}
      </span>
    );
  }

  const thread = threads.find(t => t.id === msg.threadId);
  const preview = msg.body
    ? msg.body.slice(0, 100) + (msg.body.length > 100 ? '…' : '')
    : '[attachment]';

  return (
    <button
      type="button"
      onClick={() => onJumpToMessage(messageId)}
      className={`mt-1.5 block w-full text-left rounded-lg px-2.5 py-2 border-l-2 transition-colors ${
        isMine
          ? 'bg-white/10 border-white/50 hover:bg-white/20'
          : 'bg-slate-200/70 dark:bg-neutral-700/60 border-indigo-400 dark:border-indigo-500 hover:bg-slate-200 dark:hover:bg-neutral-700'
      }`}
    >
      <div
        className="text-[10px] font-semibold mb-0.5 truncate"
        style={isMine ? { color: 'rgba(255,255,255,0.7)' } : { color: msg.authorColor }}
      >
        {msg.authorName}{thread ? ` · #${thread.name}` : ''}
      </div>
      <div className={`text-xs leading-snug line-clamp-2 ${isMine ? 'text-white/75' : 'text-slate-600 dark:text-neutral-400'}`}>
        {preview}
      </div>
    </button>
  );
};

// ─── Body renderer ─────────────────────────────────────────────────────────────
const renderBody = (
  body: string,
  isMine: boolean,
  threads: ChatThread[],
  resolveMessage: (id: string) => Promise<ChatMessage | undefined>,
  onSwitchThread: (threadId: string) => void,
  onJumpToMessage: (msgId: string) => void,
): React.ReactNode[] => {
  const parts = body.split(/([@#!]\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={i} className={`font-semibold ${isMine ? 'text-white underline decoration-white/60' : 'text-indigo-600 dark:text-indigo-400'}`}>
          {part}
        </span>
      );
    }
    if (part.startsWith('#')) {
      const name = part.slice(1).toLowerCase();
      const thread = threads.find(t => t.name.toLowerCase() === name);
      if (thread) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSwitchThread(thread.id)}
            className={`font-semibold underline cursor-pointer ${isMine ? 'text-white decoration-white/60 hover:decoration-white' : 'text-indigo-600 dark:text-indigo-400 decoration-indigo-400/60 hover:decoration-indigo-600'}`}
          >
            {part}
          </button>
        );
      }
      return (
        <span key={i} className={`font-semibold ${isMine ? 'text-white/80' : 'text-slate-600 dark:text-neutral-400'}`}>
          {part}
        </span>
      );
    }
    if (part.startsWith('!') && part.length > 1) {
      const msgId = part.slice(1);
      return (
        <MessagePreviewInline
          key={i}
          messageId={msgId}
          isMine={isMine}
          threads={threads}
          resolveMessage={resolveMessage}
          onJumpToMessage={onJumpToMessage}
        />
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

// ─── Message bubble ───────────────────────────────────────────────────────────
const MessageBubble: React.FC<{
  message: ChatMessage;
  isMine: boolean;
  isPinboard: boolean;
  threads: ChatThread[];
  resolveMessage: (id: string) => Promise<ChatMessage | undefined>;
  onSwitchThread: (threadId: string) => void;
  onJumpToMessage: (msgId: string) => void;
  onReply: (msgId: string) => void;
  onPin: (message: ChatMessage) => void;
  onUnpin: (originalMessageId: string) => void;
}> = ({ message, isMine, isPinboard, threads, resolveMessage, onSwitchThread, onJumpToMessage, onReply, onPin, onUnpin }) => {
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleCopyLink = () => {
    navigator.clipboard.writeText('!' + message.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div data-msgid={message.id} className={`group/msg flex flex-col gap-0.5 ${isMine ? 'items-end' : 'items-start'}`}>
      {lightbox && (
        <Lightbox src={lightbox.src} name={lightbox.name} onClose={() => setLightbox(null)} />
      )}
      {!isMine && (
        <span className="text-xs font-semibold px-1" style={{ color: message.authorColor }}>
          {message.authorName}
        </span>
      )}
      {/* Pinboard origin label */}
      {isPinboard && message.pinnedFromThreadId && (
        <button
          type="button"
          onClick={() => {
            if (message.pinnedFromThreadId) onSwitchThread(message.pinnedFromThreadId);
          }}
          className="flex items-center gap-1 px-1 mb-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 hover:underline"
        >
          <Pin size={9} />
          {(() => {
            const t = threads.find(t => t.id === message.pinnedFromThreadId);
            return `from #${t?.name ?? message.pinnedFromThreadId}`;
          })()}
        </button>
      )}
      <div
        className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm break-words ${
          isPinboard
            ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-slate-900 dark:text-neutral-100 rounded-bl-sm'
            : isMine
              ? 'bg-indigo-600 text-white rounded-br-sm'
              : 'bg-slate-100 dark:bg-neutral-800 text-slate-900 dark:text-neutral-100 rounded-bl-sm'
        }`}
      >
        {message.body && (
          <div className="whitespace-pre-wrap leading-relaxed">
            {renderBody(message.body, isMine && !isPinboard, threads, resolveMessage, onSwitchThread, onJumpToMessage)}
          </div>
        )}
        {message.attachments.map((att, idx) =>
          att.mimeType.startsWith('image/') ? (
            <button
              key={idx}
              type="button"
              onClick={() => setLightbox({ src: att.dataURL, name: att.name })}
              className="mt-1.5 block focus:outline-none group/img"
              title="Click to expand"
            >
              <img
                src={att.dataURL}
                alt={att.name}
                className="max-w-[200px] rounded-lg border border-black/10 group-hover/img:opacity-90 transition-opacity cursor-zoom-in"
              />
            </button>
          ) : (
            <a
              key={idx}
              href={att.dataURL}
              download={att.name}
              className={`mt-1.5 flex items-center gap-1.5 text-xs underline ${isMine && !isPinboard ? 'text-white/80' : 'text-indigo-600 dark:text-indigo-400'}`}
            >
              <Paperclip size={12} />
              {att.name} ({(att.size / 1024).toFixed(1)} KB)
            </a>
          )
        )}
      </div>
      {/* Timestamp + hover actions */}
      <div className={`flex items-center gap-1.5 px-1 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
        <span className="text-xs text-slate-400 dark:text-neutral-500">{time}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={handleCopyLink}
            title="Copy message link"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
          >
            {copied ? (
              <span className="text-sm text-indigo-500 font-bold leading-none">✓</span>
            ) : (
              <Link2 size={16} />
            )}
          </button>
          {isPinboard ? (
            /* Unpin button — only shown in pinboard view */
            <button
              type="button"
              onClick={() => message.pinnedFromMessageId && onUnpin(message.pinnedFromMessageId)}
              title="Unpin"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-amber-500 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            >
              <PinOff size={16} />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onReply(message.id)}
                title="Reply"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
              >
                <CornerUpLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => onPin(message)}
                title="Pin for everyone"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
              >
                <Pin size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
export const ChatThreadView: React.FC<ChatThreadViewProps> = ({
  messages,
  peers,
  threads,
  myId,
  isPinboard,
  resolveMessage,
  onSend,
  onSwitchThread,
  onJumpToMessage,
  onPin,
  onUnpin,
  scrollToMessageId,
  onScrollConsumed,
}) => {
  const [body, setBody] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive (only if no pending scroll target)
  useLayoutEffect(() => {
    if (scrollToMessageId) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, scrollToMessageId]);

  // Scroll to a specific message when requested
  useLayoutEffect(() => {
    if (!scrollToMessageId) return;
    const el = scrollContainerRef.current?.querySelector(`[data-msgid="${scrollToMessageId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onScrollConsumed();
    }
  }, [scrollToMessageId, messages, onScrollConsumed]);

  // Auto-resize textarea to fit content; only enable scrollbar when capped at max-height
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const capped = el.scrollHeight > 200;
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    el.style.overflowY = capped ? 'auto' : 'hidden';
  }, [body]);

  // Reply: prepend !<id>\n to input, focus, and move cursor to end of typed content
  const handleReply = useCallback((msgId: string) => {
    const prefix = `!${msgId}\n`;
    setBody(prev => {
      const next = prefix + prev;
      // Schedule cursor placement after state flushes
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.length, next.length);
      }, 0);
      return next;
    });
  }, []);

  // Detect @mention trigger as user types
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setBody(val);

    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx !== -1 && !before.slice(atIdx + 1).includes(' ')) {
      setMentionQuery(before.slice(atIdx + 1));
      setMentionStart(atIdx);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const selectMention = useCallback((peer: Peer) => {
    const handle = mentionHandle(peer);
    const cursor = inputRef.current?.selectionStart ?? body.length;
    const before = body.slice(0, mentionStart) + `@${handle} `;
    const after = body.slice(cursor);
    setBody(before + after);
    setMentionQuery(null);
    setTimeout(() => {
      inputRef.current?.focus();
      const pos = before.length;
      inputRef.current?.setSelectionRange(pos, pos);
    }, 0);
  }, [body, mentionStart]);

  const extractMentions = useCallback((text: string): string[] => {
    const tokens = text.match(/@(\S+)/g)?.map(t => t.slice(1)) ?? [];
    // Match against both username and display name so old messages and
    // messages composed before a username was set still resolve correctly
    return peers
      .filter(p => tokens.includes(p.username ?? '') || tokens.includes(p.name))
      .map(p => p.id);
  }, [peers]);

  const handleSend = useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    const mentioned = extractMentions(trimmed);
    onSend(trimmed, pendingAttachments, mentioned);
    setBody('');
    setPendingAttachments([]);
    setMentionQuery(null);
  }, [body, pendingAttachments, extractMentions, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const results: ChatAttachment[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        alert(`"${file.name}" is too large (max 5 MB).`);
        continue;
      }
      const dataURL = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      results.push({ name: file.name, mimeType: file.type || 'application/octet-stream', dataURL, size: file.size });
    }
    setPendingAttachments(prev => [...prev, ...results]);
  }, []);

  const filteredPeers = mentionQuery !== null
    ? peers.filter(p => {
        if (p.id === myId) return false;
        const q = mentionQuery.toLowerCase();
        return (
          mentionHandle(p).toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q)
        );
      })
    : [];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-center text-xs text-slate-400 dark:text-neutral-500 pt-6">
            No messages yet. Say hello!
          </p>
        )}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isMine={msg.authorId === myId}
            isPinboard={isPinboard}
            threads={threads}
            resolveMessage={resolveMessage}
            onSwitchThread={onSwitchThread}
            onJumpToMessage={onJumpToMessage}
            onReply={handleReply}
            onPin={onPin}
            onUnpin={onUnpin}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Pending attachments preview */}
      {!isPinboard && pendingAttachments.length > 0 && (
        <div className="px-3 py-2 flex flex-wrap gap-2 border-t border-slate-200 dark:border-neutral-700">
          {pendingAttachments.map((att, idx) => (
            <div key={idx} className="relative group">
              {att.mimeType.startsWith('image/') ? (
                <img
                  src={att.dataURL}
                  alt={att.name}
                  className="w-14 h-14 object-cover rounded-lg border border-slate-200 dark:border-neutral-700"
                />
              ) : (
                <div className="w-14 h-14 flex items-center justify-center bg-slate-100 dark:bg-neutral-800 rounded-lg border border-slate-200 dark:border-neutral-700 text-[9px] text-slate-500 font-semibold text-center px-1 break-all">
                  {att.name.slice(-12)}
                </div>
              )}
              <button
                onClick={() => setPendingAttachments(prev => prev.filter((_, i) => i !== idx))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* @mention dropdown */}
      {!isPinboard && filteredPeers.length > 0 && (
        <div className="mx-3 mb-1 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-lg overflow-hidden">
          {filteredPeers.slice(0, 6).map(peer => (
            <button
              key={peer.id}
              onMouseDown={(e) => { e.preventDefault(); selectMention(peer); }}
              className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors border-b last:border-b-0 border-slate-100 dark:border-neutral-800"
            >
              <div
                className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                style={{ backgroundColor: peer.color }}
              >
                {peer.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-slate-900 dark:text-neutral-100 truncate">
                  @{mentionHandle(peer)}
                </span>
                {peer.username && peer.username !== peer.name && (
                  <span className="text-[10px] text-slate-400 dark:text-neutral-500 truncate">{peer.name}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input bar — hidden on pinboard */}
      {isPinboard ? (
        <div className="px-3 pb-3 pt-2 border-t border-amber-200 dark:border-amber-800 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
            <Pin size={13} className="text-amber-500 flex-shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-300 font-medium">
              Pinboard is read-only. Hover a message to unpin it.
            </span>
          </div>
        </div>
      ) : (
      <div className="px-3 pb-3 pt-2 border-t border-slate-200 dark:border-neutral-700 flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={body}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Message… (Shift+Enter for new line)"
          className="flex-1 resize-none text-sm px-3 py-2 rounded-xl bg-slate-50 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-slate-900 dark:text-neutral-100 placeholder:text-slate-400 outline-none focus:border-indigo-400 transition-colors min-h-[38px] max-h-[200px] leading-relaxed overflow-y-hidden scrollbar-thin scrollbar-thumb-slate-300 hover:scrollbar-thumb-slate-400 dark:scrollbar-thumb-neutral-600 dark:hover:scrollbar-thumb-neutral-500 scrollbar-track-transparent"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.txt,.csv,.md,.json"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800"
          title="Attach file (max 5 MB)"
        >
          <Paperclip size={16} />
        </button>
        <button
          onClick={handleSend}
          disabled={!body.trim() && pendingAttachments.length === 0}
          className="p-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          <Send size={16} />
        </button>
      </div>
      )}
    </div>
  );
};
