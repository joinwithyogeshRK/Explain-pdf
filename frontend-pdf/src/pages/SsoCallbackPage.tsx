import { AuthenticateWithRedirectCallback } from "@clerk/react"

/** Completes Clerk OAuth (Google, etc.) after redirect from the provider. */
export default function SsoCallbackPage() {
  return <AuthenticateWithRedirectCallback />
}
