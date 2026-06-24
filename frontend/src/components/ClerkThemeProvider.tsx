import type { ReactNode } from "react"
import { ClerkProvider } from "@clerk/react"
import { useTheme } from "@/context/theme"
import { getClerkAppearance } from "@/lib/clerk-appearance"

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
if (!publishableKey) {
  throw new Error("Add VITE_CLERK_PUBLISHABLE_KEY to .env or .env.local")
}

export function ClerkThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme()

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/"
      appearance={getClerkAppearance(theme)}
    >
      {children}
    </ClerkProvider>
  )
}
