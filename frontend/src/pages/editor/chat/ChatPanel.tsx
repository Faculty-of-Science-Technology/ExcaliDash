import { AlertTriangle, Info, MoreVertical, Plus, Trash2, X } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';import { Socket } from 'socket.io-client';
import type { ChatAttachment, ChatMessage, ChatMessagePayload, ChatThread } from './ChatTypes';
import { ChatThreadView } from './ChatThread';
import { useChatStorage } from './useChatStorage';

interface Peer {
  id: string;
  name: string;
  color: string;
}

interface ChatPanelProps {
  drawingId: string;
  socket: Socket | null;
  peers: Peer[];
  myId: string;
  myName: string;
  myColor: string;
  onClose: () => void;
}

export interface ChatPanelHandle {
  /** Called by Editor when a chat-message socket event arrives */
  receiveMessage: (payload: ChatMessagePayload) => void;
}

const generateId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// ─── Panel ────────────────────────────────────────────────────────────────────
export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(({
  drawingId,
  socket,
  peers,
  myId,
  myName,
  myColor,
  onClose,
}, ref) => {
  const storage = useChatStorage(drawingId);
  const storageRef = useRef(storage);
  storageRef.current = storage;

  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('main');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [newThreadName, setNewThreadName] = useState('');
  const newThreadInputRef = useRef<HTMLInputElement>(null);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState<string | null>(null);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      await storageRef.current.ensureMainThread();
      const ts = await storageRef.current.getThreads();
      setThreads(ts);
    };
    void init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load messages when thread changes ────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const msgs = await storageRef.current.getMessages(activeThreadId);
      setMessages(msgs);
    };
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  // ── Incoming socket message ───────────────────────────────────────────────────
  const receiveMessage = useCallback(async (payload: ChatMessagePayload) => {
    const { threadId, message } = payload;

    const known = threads.find(t => t.id === threadId);
    if (!known) {
      const newThread: ChatThread = {
        id: threadId,
        name: message.threadName ?? 'Thread',
        createdAt: message.timestamp,
        isDefault: false,
      };
      await storageRef.current.addThread(newThread);
      setThreads(prev => {
        if (prev.find(t => t.id === threadId)) return prev;
        return [...prev, newThread].sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          return a.createdAt - b.createdAt;
        });
      });
    }

    await storageRef.current.addMessage(message);
    if (activeThreadId === threadId) {
      setMessages(prev => [...prev, message]);
    }
  }, [threads, activeThreadId]);

  useImperativeHandle(ref, () => ({ receiveMessage }), [receiveMessage]);

  // ── Send message ──────────────────────────────────────────────────────────────
  const handleSend = useCallback(async (
    body: string,
    attachments: ChatAttachment[],
    mentionedUserIds: string[],
  ) => {
    const thread = threads.find(t => t.id === activeThreadId);
    const message: ChatMessage = {
      id: generateId(),
      threadId: activeThreadId,
      authorId: myId,
      authorName: myName,
      authorColor: myColor,
      body,
      attachments,
      mentionedUserIds,
      timestamp: Date.now(),
      threadName: thread?.name,
    };

    await storageRef.current.addMessage(message);
    setMessages(prev => [...prev, message]);

    if (socket) {
      const payload: ChatMessagePayload = {
        drawingId,
        threadId: activeThreadId,
        message,
      };
      socket.emit('chat-message', payload);
    }
  }, [threads, activeThreadId, myId, myName, myColor, socket, drawingId]);

  // ── Create thread ─────────────────────────────────────────────────────────────
  const handleCreateThread = useCallback(async () => {
    const raw = (newThreadInputRef.current?.value ?? '').trim();
    if (!raw) return;
    const name = raw.replace(/\s+/g, '_');
    setIsCreatingThread(false);
    setNewThreadName('');
    const newThread: ChatThread = {
      id: generateId(),
      name,
      createdAt: Date.now(),
      isDefault: false,
    };
    await storageRef.current.addThread(newThread);
    setThreads(prev => [...prev, newThread]);
    setActiveThreadId(newThread.id);
  }, []);

  // ── Delete thread ─────────────────────────────────────────────────────────────
  const handleDeleteThread = useCallback(async (threadId: string) => {
    await storageRef.current.deleteThread(threadId);
    setThreads(prev => prev.filter(t => t.id !== threadId));
    if (activeThreadId === threadId) setActiveThreadId('main');
    setThreadMenuId(null);
  }, [activeThreadId]);

  // ── Clear thread ──────────────────────────────────────────────────────────────
  const handleClearThread = useCallback(async (threadId: string) => {
    await storageRef.current.clearThread(threadId);
    if (activeThreadId === threadId) setMessages([]);
    setConfirmClear(null);
    setThreadMenuId(null);
  }, [activeThreadId]);

  const activeThread = threads.find(t => t.id === activeThreadId);

  // ── Resolve a message by id from IDB (for !<id> previews) ────────────────────
  const resolveMessage = useCallback(async (id: string): Promise<ChatMessage | undefined> => {
    return storageRef.current.getMessage(id);
  }, []);

  // ── Jump to a message: switch thread then signal scroll ───────────────────────
  const handleJumpToMessage = useCallback(async (msgId: string) => {
    const msg = await storageRef.current.getMessage(msgId);
    if (!msg) return;
    if (msg.threadId !== activeThreadId) {
      setActiveThreadId(msg.threadId);
      // Wait for messages to load before signalling scroll
      setScrollToMessageId(msgId);
    } else {
      setScrollToMessageId(msgId);
    }
  }, [activeThreadId]);

  return (
    <div className="fixed right-0 top-0 h-full w-80 z-[60] flex flex-col bg-white dark:bg-neutral-900 border-l border-slate-200 dark:border-neutral-700 shadow-2xl">

      {/* New thread dialog */}
      {isCreatingThread && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { setIsCreatingThread(false); setNewThreadName(''); }}>
          <div
            className="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 rounded-2xl shadow-2xl p-5 w-72 flex flex-col gap-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900 dark:text-neutral-100">New thread</span>
              <button
                onClick={() => { setIsCreatingThread(false); setNewThreadName(''); }}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-400 transition-colors"
              >
                <X size={15} />
              </button>
            </div>
            <input
              ref={newThreadInputRef}
              autoFocus
              value={newThreadName}
              onChange={e => setNewThreadName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); void handleCreateThread(); }
                if (e.key === 'Escape') { setIsCreatingThread(false); setNewThreadName(''); }
              }}
              placeholder="Thread name…"
              maxLength={40}
              className="text-sm px-3 py-2 rounded-xl bg-slate-50 dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 text-slate-900 dark:text-neutral-100 placeholder:text-slate-400 outline-none focus:border-indigo-400 transition-colors"
            />
            {/\s/.test(newThreadName) && (
              <div className="flex items-start gap-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-2.5 py-2">
                <span className="text-amber-500 text-xs mt-px flex-shrink-0">⚠</span>
                <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                  Spaces aren't allowed in thread names. It will be created as{' '}
                  <span className="font-semibold">"{newThreadName.replace(/\s+/g, '_')}"</span>.
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => void handleCreateThread()}
                disabled={!newThreadName.trim()}
                className="flex-1 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => { setIsCreatingThread(false); setNewThreadName(''); }}
                className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-neutral-300 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 dark:border-neutral-700 flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-semibold text-slate-900 dark:text-neutral-100 flex-1 truncate">
          Chat {activeThread ? `· ${activeThread.name}` : ''}
        </span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-500 dark:text-neutral-400 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Limitations banner */}
      <div className="mx-3 mt-3 flex-shrink-0 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-2.5 flex gap-2">
        <Info size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300 leading-relaxed">
          Chat is stored <strong>locally in your browser</strong> and relayed peer-to-peer.
          New participants won't see past messages. Clearing browser data erases your chat history.
        </p>
      </div>

      {/* Thread tabs */}
      <div className="px-3 pt-2.5 pb-1.5 flex-shrink-0 flex items-center gap-1.5 flex-wrap">
        {threads.map(t => (
          <div key={t.id} className="relative group/tab flex items-center">
            <button
              onClick={() => setActiveThreadId(t.id)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                t.id === activeThreadId
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400 hover:bg-slate-200 dark:hover:bg-neutral-700'
              }`}
            >
              {t.name}
            </button>

            {/* Thread kebab menu trigger */}
            <button
              onClick={(e) => { e.stopPropagation(); setThreadMenuId(threadMenuId === t.id ? null : t.id); }}
              className={`ml-0.5 p-0.5 rounded-md transition-colors ${
                t.id === activeThreadId
                  ? 'text-white/70 hover:text-white hover:bg-white/10'
                  : 'text-slate-400 opacity-0 group-hover/tab:opacity-100 hover:text-slate-700 dark:hover:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-700'
              }`}
            >
              <MoreVertical size={12} />
            </button>

            {/* Thread context menu */}
            {threadMenuId === t.id && (
              <div
                className="absolute top-full left-0 mt-1 z-[100] bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 rounded-xl shadow-lg overflow-hidden min-w-[140px] animate-in fade-in zoom-in-95 duration-100"
                onClick={e => e.stopPropagation()}
              >
                <button
                  onClick={() => { setConfirmClear(t.id); setThreadMenuId(null); }}
                  className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-800 flex items-center gap-2 border-b border-slate-100 dark:border-neutral-800"
                >
                  <Trash2 size={12} className="text-amber-500" />
                  Clear chat
                </button>
                {!t.isDefault && (
                  <button
                    onClick={() => handleDeleteThread(t.id)}
                    className="w-full text-left px-3 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-2"
                  >
                    <X size={12} />
                    Delete thread
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {/* New thread */}
        <button
          onClick={() => { setNewThreadName(''); setIsCreatingThread(true); }}
          className="p-1 rounded-lg text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-neutral-800 transition-colors"
          title="New thread"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Confirm clear dialog */}
      {confirmClear && (
        <div className="mx-3 mb-2 flex-shrink-0 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-700 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <p className="text-xs font-semibold">Clear your local chat history for this thread?</p>
          </div>
          <p className="text-[10px] text-rose-600 dark:text-rose-400">This only clears messages on your device — others won't be affected.</p>
          <div className="flex gap-2">
            <button
              onClick={() => void handleClearThread(confirmClear)}
              className="flex-1 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors"
            >
              Clear
            </button>
            <button
              onClick={() => setConfirmClear(null)}
              className="flex-1 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-rose-200 dark:border-rose-700 text-rose-600 dark:text-rose-400 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Messages area — flex-1, min-h-0 to allow shrinking */}
      <div
        className="flex-1 min-h-0 flex flex-col"
        onClick={() => setThreadMenuId(null)}
      >
        <ChatThreadView
          key={activeThreadId}
          threadId={activeThreadId}
          messages={messages}
          peers={peers}
          threads={threads}
          myId={myId}
          resolveMessage={resolveMessage}
          onSend={handleSend}
          onSwitchThread={setActiveThreadId}
          onJumpToMessage={handleJumpToMessage}
          scrollToMessageId={scrollToMessageId}
          onScrollConsumed={() => setScrollToMessageId(null)}
        />
      </div>
    </div>
  );
});

ChatPanel.displayName = 'ChatPanel';
