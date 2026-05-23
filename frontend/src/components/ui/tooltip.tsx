import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

interface TooltipProps {
  content: string
  children: ReactNode
  side?: "top" | "bottom"
  align?: "start" | "center" | "end"
  className?: string
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  className,
}: TooltipProps) {
  const [show, setShow] = useState(false)

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && content && (
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-[120] w-max max-w-[min(220px,calc(100vw-24px))] rounded-lg border border-border bg-card px-2.5 py-1.5 text-center font-mono text-[10px] leading-snug text-foreground shadow-lg",
            side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
            align === "center" && "left-1/2 -translate-x-1/2",
            align === "start" && "left-0",
            align === "end" && "right-0"
          )}
        >
          {content}
        </span>
      )}
    </span>
  )
}
