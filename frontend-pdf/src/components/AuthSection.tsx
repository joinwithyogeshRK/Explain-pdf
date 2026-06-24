import { useState } from "react"
import { Show, SignInButton, SignUpButton, useSignIn, useSignUp } from "@clerk/react"
import { Loader2 } from "lucide-react"
import { getClerkAppearance } from "@/lib/clerk-appearance"
import { useTheme } from "@/context/theme"
import { cn } from "@/lib/utils"

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 shrink-0", className)} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

function ContinueWithGoogleButton() {
  const { signIn, fetchStatus: signInStatus } = useSignIn()
  const { signUp, fetchStatus: signUpStatus } = useSignUp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loading = signInStatus === "fetching" || signUpStatus === "fetching"

  const handleGoogle = async () => {
    setError(null)
    setBusy(true)
    try {
      const origin = window.location.origin
      const params = {
        strategy: "oauth_google" as const,
        redirectUrl: `${origin}/`,
        redirectCallbackUrl: `${origin}/sso-callback`,
      }

      if (signIn) {
        const { error: signInError } = await signIn.sso(params)
        if (!signInError) return
      }

      if (signUp) {
        const { error: signUpError } = await signUp.sso(params)
        if (!signUpError) return
        setError(signUpError.message ?? "Could not start Google sign-in")
        return
      }

      setError("Sign-in is not ready yet. Try again in a moment.")
    } catch {
      setError("Could not start Google sign-in")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={() => void handleGoogle()}
        disabled={busy || loading}
        className={cn(
          "flex h-8 items-center justify-center gap-1.5 rounded-full border border-border bg-card/80 px-2.5 font-mono text-[9px] font-semibold tracking-wider text-foreground shadow-sm transition-colors hover:border-accent/40 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-muted sm:h-8 sm:gap-2 sm:px-3"
        )}
      >
        {busy || loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <GoogleMark />
        )}
        <span className="hidden sm:inline">Continue with Google</span>
        <span className="sm:hidden">Google</span>
      </button>
      {error && (
        <span className="max-w-[180px] text-center font-mono text-[8px] leading-tight text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}

const authBtnClass =
  "h-8 rounded-full border border-border bg-card/80 px-2.5 font-mono text-[9px] font-semibold tracking-wider shadow-sm transition-colors hover:border-accent/50 hover:bg-white dark:hover:bg-muted sm:px-3"

export function AuthSection() {
  const { theme } = useTheme()
  const appearance = getClerkAppearance(theme)

  return (
    <Show when="signed-out">
      <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-1.5">
        <ContinueWithGoogleButton />
        <SignInButton mode="modal" appearance={appearance}>
          <button type="button" className={cn(authBtnClass, "text-accent")}>
            <span>Sign in</span>
          </button>
        </SignInButton>
        <SignUpButton mode="modal" appearance={appearance}>
          <button
            type="button"
            className={cn(authBtnClass, "text-muted-foreground hover:text-foreground")}
          >
            <span>Sign up</span>
          </button>
        </SignUpButton>
      </div>
    </Show>
  )
}
