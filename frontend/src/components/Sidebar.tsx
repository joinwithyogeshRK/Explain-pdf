import { motion, AnimatePresence } from "framer-motion"
import { MessageSquare, PanelLeftClose, Plus, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Chat {
  id: string
  title: string
  created_at: string
}

interface Props {
  open: boolean
  mode?: "overlay" | "docked"
  chats: Chat[]
  activeChatId: string | null
  loading: boolean
  onClose: () => void
  onNewChat: () => void
  onSelectChat: (id: string) => void
  onDeleteChat: (id: string, e: React.MouseEvent) => void
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

export const Sidebar = ({
  open,
  mode = "overlay",
  chats,
  activeChatId,
  loading,
  onClose,
  onNewChat,
  onSelectChat,
  onDeleteChat,
}: Props) => {
  const aside = (
    <motion.aside
      className={cn(
        "glass-panel z-20 flex w-[min(320px,88vw)] shrink-0 flex-col border-r border-border",
        mode === "overlay" ? "fixed bottom-0 left-0 top-0" : "relative h-full w-[300px] shadow-none"
      )}
      initial={mode === "overlay" ? { x: -320 } : { opacity: 0, width: 0 }}
      animate={mode === "overlay" ? { x: 0 } : { opacity: 1, width: 300 }}
      exit={mode === "overlay" ? { x: -320 } : { opacity: 0, width: 0 }}
      transition={{ type: "spring", damping: 28, stiffness: 260 }}
    >
      <div className="flex items-center justify-between border-b border-border/80 px-4 py-5">
        <div className="min-w-0">
          <div className="truncate text-sm font-extrabold tracking-wide text-foreground">
            Oracle
          </div>
          <div className="mt-0.5 font-mono text-[9px] font-semibold tracking-[0.2em] text-accent/75">
            CHATS
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border bg-card/70 p-2 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          aria-label={mode === "overlay" ? "Close sidebar" : "Hide chat history"}
          title={mode === "overlay" ? "Close sidebar" : "Hide chat history"}
        >
          {mode === "overlay" ? (
            <X className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

          <button
            type="button"
            onClick={() => {
              onNewChat()
              onClose()
            }}
            className="mx-3 mt-3 flex items-center gap-2 rounded-xl border border-dashed border-accent/25 bg-accent/5 px-3.5 py-2.5 font-mono text-[10px] font-extrabold tracking-wider text-accent/80 transition-colors hover:border-accent/45 hover:bg-accent/10 hover:text-accent"
          >
            <Plus className="h-3 w-3" />
            NEW CHAT
          </button>

          <div className="mx-3 my-3 h-px bg-border" />

          <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-4">
            {loading ? (
              <div className="flex flex-col gap-2 p-2">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="h-14 rounded-xl bg-muted"
                    animate={{ opacity: [0.3, 0.7, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            ) : chats.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                No previous chats
              </p>
            ) : (
              chats.map((chat) => (
                <motion.div
                  key={chat.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectChat(chat.id)}
                  onKeyDown={(e) => e.key === "Enter" && onSelectChat(chat.id)}
                  className={cn(
                    "relative mb-1 cursor-pointer rounded-xl border px-3 py-2.5 transition-colors hover:border-border hover:bg-white/55 dark:hover:bg-muted",
                    activeChatId === chat.id
                      ? "border-accent/25 bg-accent/10 shadow-sm"
                      : "border-transparent"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">{chat.title}</p>
                      <p className="mt-0.5 font-mono text-[10px] font-bold text-muted-foreground/80">
                        {formatDate(chat.created_at)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => onDeleteChat(chat.id, e)}
                      className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive"
                      title="Delete chat"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {activeChatId === chat.id && (
                    <div className="absolute bottom-[20%] left-0 top-[20%] w-0.5 rounded-r bg-accent" />
                  )}
                </motion.div>
              ))
            )}
          </div>
    </motion.aside>
  )

  return (
    <AnimatePresence>
      {open && (
        <>
          {mode === "overlay" && (
            <motion.div
              className="fixed inset-0 z-10 bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
          )}
          {aside}
        </>
      )}
    </AnimatePresence>
  )
}
